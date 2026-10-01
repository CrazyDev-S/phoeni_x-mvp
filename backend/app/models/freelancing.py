"""The Freelancing category: Upwork connection, job snapshots, focus, proposals, tracking.

A job is stored as a **snapshot** of the Upwork posting the moment it was
seen. Upwork's own search is paged by cursor and re-ranked on every call, so
nothing in the product refers to a posting by its position in a result set -
focus, proposals and tracking all hang off the snapshot row. The snapshot is
refreshed whenever the posting turns up again or is opened.
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
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import (
    CredentialStatus,
    FreelanceJobType,
    FreelanceTrackStage,
    ProposalStatus,
    UpworkConnectionStatus,
    pg_enum,
)

UPWORK_CONNECTION_STATUS_ENUM = pg_enum(UpworkConnectionStatus, "upwork_connection_status")
FREELANCE_JOB_TYPE_ENUM = pg_enum(FreelanceJobType, "freelance_job_type")
FREELANCE_TRACK_STAGE_ENUM = pg_enum(FreelanceTrackStage, "freelance_track_stage")
PROPOSAL_STATUS_ENUM = pg_enum(ProposalStatus, "proposal_status")
# The same native type the LLM credentials use; create_all makes it once.
APIFY_CREDENTIAL_STATUS_ENUM = pg_enum(CredentialStatus, "credential_status")


class UpworkConnection(Timestamps, Base):
    """One Upwork link per user.

    The API key pair (client id + secret) and the OAuth tokens are all sealed
    with the same envelope encryption as LLM keys. The client id itself is
    not secret, so it is stored in the clear for display.
    """

    __tablename__ = "upwork_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    client_id: Mapped[str | None] = mapped_column(Text)
    client_secret_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    client_secret_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    client_secret_last4: Mapped[str | None] = mapped_column(String(8))

    access_token_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    access_token_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    refresh_token_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    encryption_key_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="1"
    )

    # The organisation the API acts for. Upwork accounts can belong to several;
    # the header X-Upwork-API-TenantId picks one.
    tenant_id: Mapped[str | None] = mapped_column(Text)
    upwork_user_id: Mapped[str | None] = mapped_column(Text)
    upwork_user_name: Mapped[str | None] = mapped_column(Text)

    status: Mapped[UpworkConnectionStatus] = mapped_column(
        UPWORK_CONNECTION_STATUS_ENUM,
        nullable=False,
        server_default=UpworkConnectionStatus.NOT_CONFIGURED.value,
    )
    last_error: Mapped[str | None] = mapped_column(Text)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApifyConnection(Timestamps, Base):
    """A user's Apify API token, for the Apify job source.

    Sealed with the same envelope as LLM keys. A deployment-wide token in
    ``APIFY_TOKEN`` is the fallback when a user has not stored their own.
    """

    __tablename__ = "apify_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    token_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    token_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    token_last4: Mapped[str | None] = mapped_column(String(8))
    encryption_key_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="1"
    )
    status: Mapped[CredentialStatus] = mapped_column(
        APIFY_CREDENTIAL_STATUS_ENUM,
        nullable=False,
        server_default=CredentialStatus.UNVERIFIED.value,
    )
    apify_username: Mapped[str | None] = mapped_column(Text)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    last_run_id: Mapped[str | None] = mapped_column(Text)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FreelanceJob(PrimaryKey, Timestamps, Base):
    """A snapshot of one posting, as one user saw it, from whichever job source."""

    __tablename__ = "freelance_jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "upwork_id"),
        Index("ix_freelance_jobs_user_seen", "user_id", text("last_seen_at DESC")),
        Index(
            "ix_freelance_jobs_user_focused",
            "user_id",
            text("focused_at DESC"),
            postgresql_where=text("focused_at IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Upwork's posting id, and the "~01..." ciphertext its public URL uses.
    upwork_id: Mapped[str] = mapped_column(Text, nullable=False)
    ciphertext: Mapped[str | None] = mapped_column(Text)
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
    # right shape. Keys: company_name, country, city, payment_verified,
    # total_spent, total_hires, total_posted_jobs, feedback, reviews.
    client: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    total_applicants: Mapped[int | None] = mapped_column(Integer)
    freelancers_to_hire: Mapped[int | None] = mapped_column(Integer)
    is_premium: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_enterprise: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    preferred_freelancer_location: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    renewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The whole node as Upwork returned it, so a field the columns do not
    # carry is still there for the proposal engine.
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    detail_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Focus is a timestamp, not a flag, so the focused list has an order.
    focused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    track: Mapped[FreelanceJobTrack | None] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
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

    job: Mapped[FreelanceJob] = relationship(back_populates="track")


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
