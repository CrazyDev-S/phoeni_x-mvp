"""The Freelancing category: shared Upwork jobs, focus, proposals, tracking.

A job is **one Upwork posting, shared by every user**, keyed by Upwork's own
job id. The browser extension registers postings as people browse Upwork
(``app.freelancing.capture``); whoever sees a posting first creates the row and
everyone after them refreshes it. What one user thinks of a posting - starred
into their tracker, or hidden - is theirs alone and lives in
``freelance_job_marks``; proposals and tracks were per user already.

While a posting is open in someone's browser, their extension *watches* its
client (``freelance_job_watches``) and the team is told when the client comes
back or starts interviewing (``freelance_job_alerts``); see
``app.freelancing.services.watch``.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import (
    FreelanceAlertKind,
    FreelanceJobType,
    FreelanceTrackStage,
    ProposalStatus,
    pg_enum,
)

FREELANCE_ALERT_KIND_ENUM = pg_enum(FreelanceAlertKind, "freelance_alert_kind")
FREELANCE_JOB_TYPE_ENUM = pg_enum(FreelanceJobType, "freelance_job_type")
FREELANCE_TRACK_STAGE_ENUM = pg_enum(FreelanceTrackStage, "freelance_track_stage")
PROPOSAL_STATUS_ENUM = pg_enum(ProposalStatus, "proposal_status")


class FreelanceJob(PrimaryKey, Timestamps, Base):
    """One Upwork posting, as the extension last captured it. Shared by everyone.

    The columns are derived from ``raw`` by ``capture.normalize``: ``raw`` keeps
    the last capture of each view ("tile" from a search list, "detail" from the
    posting's own page), so a better parser can re-derive every column without
    anyone visiting Upwork again.
    """

    __tablename__ = "freelance_jobs"
    __table_args__ = (
        Index("ix_freelance_jobs_published", text("published_at DESC NULLS LAST")),
        Index("ix_freelance_jobs_created", text("created_at DESC")),
    )

    # Upwork's job key, as every job URL carries it: "~021858964253717283346".
    upwork_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    url: Mapped[str | None] = mapped_column(Text)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    job_type: Mapped[FreelanceJobType | None] = mapped_column(FREELANCE_JOB_TYPE_ENUM)
    budget_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    budget_currency: Mapped[str | None] = mapped_column(String(3))
    hourly_min: Mapped[float | None] = mapped_column(Numeric(8, 2))
    hourly_max: Mapped[float | None] = mapped_column(Numeric(8, 2))
    duration_label: Mapped[str | None] = mapped_column(Text)
    workload: Mapped[str | None] = mapped_column(Text)
    experience_level: Mapped[str | None] = mapped_column(Text)

    category: Mapped[str | None] = mapped_column(Text)
    subcategory: Mapped[str | None] = mapped_column(Text)
    skills: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")

    # Client facts are read, never computed over, so one document is the
    # right shape. Keys: see ``schemas.freelancing.JobClient``.
    client: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # Upwork shows a tier ("10 to 15"); this is its upper end, so "at most N
    # proposals" never lets a busier posting through.
    total_applicants: Mapped[int | None] = mapped_column(Integer)
    freelancers_to_hire: Mapped[int | None] = mapped_column(Integer)
    preferred_freelancer_location: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # {"tile": {...}, "detail": {...}, "extras": {...}} - see ``capture``.
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    # The last time anyone's browser saw the posting, and saw its own page.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    detail_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Who registered it first. Kept when that account goes; the job is everyone's.
    captured_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class FreelanceJobMark(Timestamps, Base):
    """What one user has said about a shared posting: focused (starred) or hidden.

    A row exists only while one of the two is set.
    """

    __tablename__ = "freelance_job_marks"
    __table_args__ = (
        Index(
            "ix_freelance_job_marks_user_focused",
            "user_id",
            text("focused_at DESC"),
            postgresql_where=text("focused_at IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("freelance_jobs.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    # Focus is a timestamp, not a flag, so the focused list has an order.
    focused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FreelanceJobWatch(Timestamps, Base):
    """One user's extension watching a posting's client while it is open on Upwork.

    A watch is live while its heartbeats are (``last_seen_at``) and it has not
    been left (``ended_at``). The row outlives a session so the user's own
    baseline - the last client visit and interview count *they* saw - carries
    over, and reopening a posting never re-announces a visit already told.
    """

    __tablename__ = "freelance_job_watches"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("freelance_jobs.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    # Whether this user's extension checks the posting and alerts them. Off by
    # default when someone else is already relaying it to the team.
    notify: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # When this run of heartbeats began: the earliest live, alerting watch relays.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seen_client_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seen_interviewing: Mapped[int | None] = mapped_column(Integer)


class FreelanceJobAlert(Base):
    """Something a posting's client did, as the relaying watcher reported it to everyone.

    Append-only; ``id`` is the feed's cursor. ``local_user_ids`` are the people
    whose own watch alerted them already, so the team feed does not tell them twice.
    """

    __tablename__ = "freelance_job_alerts"
    __table_args__ = (Index("ix_freelance_job_alerts_job_kind", "job_id", "kind", text("id DESC")),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("freelance_jobs.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[FreelanceAlertKind] = mapped_column(FREELANCE_ALERT_KIND_ENUM, nullable=False)
    client_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    interviewing: Mapped[int | None] = mapped_column(Integer)
    previous_interviewing: Mapped[int | None] = mapped_column(Integer)
    relay_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    local_user_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)), nullable=False, server_default="{}"
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class FreelanceSavedSearch(PrimaryKey, Timestamps, Base):
    """A named set of search parameters, so a daily sweep is one click."""

    __tablename__ = "freelance_saved_searches"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FreelancerProfile(PrimaryKey, Timestamps, Base):
    """The freelancer as presented on Upwork: what a proposal is written from.

    Distinct from the Remote category's candidate profile and resumes: a
    proposal argues fit for one contract, from a title, an overview, a rate and
    portfolio evidence, not from an employment history.
    """

    __tablename__ = "freelancer_profiles"
    __table_args__ = (
        Index(
            "uq_freelancer_profiles_user_default",
            "user_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    title: Mapped[str | None] = mapped_column(Text)
    overview: Mapped[str | None] = mapped_column(Text)
    hourly_rate: Mapped[float | None] = mapped_column(Numeric(8, 2))
    skills: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    # [{title, url, summary}] - nothing computes over these.
    portfolio: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # Upwork specialised profiles: [{name, title, overview}].
    specialized_profiles: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    upwork_profile_url: Mapped[str | None] = mapped_column(Text)
    # Free-form material the proposal engine may draw on, in the user's words.
    raw_profile_markdown: Mapped[str | None] = mapped_column(Text)


class FreelancerProfileVersion(PrimaryKey, Timestamps, Base):
    """One version of a profile's written content: a draft or a save.

    Drafts are what the profile writer produces, one per instruction, and are
    numbered toward the next save: 1.1, 1.2, ... Saving the profile records a
    whole version, 1, and the drafts after it are 2.1, 2.2, ... (``minor`` 0 is
    a save). A profile not created yet keeps its drafts with no ``profile_id``;
    creating it adopts them.

    ``document`` is the whole written profile - the fields the form holds
    (title, summary, skills, hourly_rate) and what it does not (title options,
    work history, education, portfolio direction, the intelligence brief).
    """

    __tablename__ = "freelancer_profile_versions"
    __table_args__ = (Index("ix_freelancer_profile_versions_thread", "user_id", "profile_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("freelancer_profiles.id", ondelete="CASCADE"), index=True
    )
    major: Mapped[int] = mapped_column(Integer, nullable=False)
    minor: Mapped[int] = mapped_column(Integer, nullable=False)
    # What the user asked for; empty on a save.
    instruction: Mapped[str | None] = mapped_column(Text)
    document: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    based_on_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("freelancer_profile_versions.id", ondelete="SET NULL")
    )
    generation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("generations.id", ondelete="SET NULL")
    )


class Proposal(PrimaryKey, Timestamps, Base):
    __tablename__ = "proposals"
    __table_args__ = (
        Index("ix_proposals_user_created", "user_id", text("created_at DESC")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("freelance_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("freelancer_profiles.id", ondelete="SET NULL")
    )

    status: Mapped[ProposalStatus] = mapped_column(
        PROPOSAL_STATUS_ENUM, nullable=False, server_default=ProposalStatus.DRAFT.value
    )
    bid_type: Mapped[FreelanceJobType | None] = mapped_column(FREELANCE_JOB_TYPE_ENUM)
    bid_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    bid_currency: Mapped[str | None] = mapped_column(String(3))
    connects_estimate: Mapped[int | None] = mapped_column(Integer)

    cover_letter_markdown: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # Answers to the posting's screening questions: [{question, answer}].
    answers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # Which engine wrote the draft. "manual" for one typed in by hand.
    engine_version: Mapped[str | None] = mapped_column(Text)
    generation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("generations.id", ondelete="SET NULL")
    )
    generation_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The version the letter and answers were last set from: the writer's
    # latest draft, or the save that recorded them. A new instruction revises it.
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("proposal_versions.id", ondelete="SET NULL", use_alter=True),
    )


class ProposalVersion(PrimaryKey, Timestamps, Base):
    """One version of a proposal's writing: a draft or a save.

    Numbered like the profile writer's: each instruction writes a draft toward
    the next save (1.1, 1.2, ...), saving records the whole version (1), and
    the drafts after it are 2.1, 2.2, ... (``minor`` 0 is a save).

    ``document`` is the letter and the screening answers, plus what the writer
    worked out to write them: its read of the posting, where the experience
    spike came from, questions for the freelancer and a change note.
    """

    __tablename__ = "proposal_versions"
    __table_args__ = (Index("ix_proposal_versions_thread", "proposal_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    proposal_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False
    )
    major: Mapped[int] = mapped_column(Integer, nullable=False)
    minor: Mapped[int] = mapped_column(Integer, nullable=False)
    # What the user asked for; empty on a save.
    instruction: Mapped[str | None] = mapped_column(Text)
    document: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    based_on_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("proposal_versions.id", ondelete="SET NULL")
    )
    generation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("generations.id", ondelete="SET NULL")
    )


class FreelanceJobTrack(PrimaryKey, Timestamps, Base):
    """Where a focused job is in the bidding pipeline. One per (user, job)."""

    __tablename__ = "freelance_job_tracks"
    __table_args__ = (
        UniqueConstraint("user_id", "job_id"),
        Index("ix_freelance_job_tracks_user_stage", "user_id", "stage", text("updated_at DESC")),
        Index(
            "ix_freelance_job_tracks_next_action",
            "user_id",
            "next_action_at",
            postgresql_where=text("next_action_at IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("freelance_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    proposal_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("proposals.id", ondelete="SET NULL")
    )

    stage: Mapped[FreelanceTrackStage] = mapped_column(
        FREELANCE_TRACK_STAGE_ENUM,
        nullable=False,
        server_default=FreelanceTrackStage.FOCUSED.value,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bid_type: Mapped[FreelanceJobType | None] = mapped_column(FREELANCE_JOB_TYPE_ENUM)
    bid_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    connects_spent: Mapped[int | None] = mapped_column(Integer)
    client_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes_markdown: Mapped[str | None] = mapped_column(Text)
    outcome_notes: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))



class FreelanceJobTrackEvent(Base):
    """Append-only stage history, the same shape as interview stage events."""

    __tablename__ = "freelance_job_track_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    track_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("freelance_job_tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_stage: Mapped[FreelanceTrackStage | None] = mapped_column(FREELANCE_TRACK_STAGE_ENUM)
    to_stage: Mapped[FreelanceTrackStage] = mapped_column(
        FREELANCE_TRACK_STAGE_ENUM, nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
