"""Meetings and recurring series.

Every instant is ``timestamptz``. The display zone is a per-row IANA name,
never the string "EST" - see app/core/timezone.py for the full rationale.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    Time,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import MeetingStatus, pg_enum

MEETING_STATUS_ENUM = pg_enum(MeetingStatus, "meeting_status")


class MeetingSeries(PrimaryKey, Timestamps, Base):
    """A recurring meeting rule.

    The RRULE is the rule of record; occurrences are materialised into
    ``meetings`` over a rolling horizon. Pure RRULE-on-read cannot be indexed,
    sorted, or joined to per-occurrence preparation notes - and per-occurrence
    notes are an explicit product requirement.

    The source of truth is LOCAL wall-clock plus an IANA zone. Expanding a
    weekly 10:00 ET standup in UTC turns it into 09:00 or 11:00 across a DST
    boundary.
    """

    __tablename__ = "meeting_series"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    maintained_job_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("maintained_jobs.id", ondelete="CASCADE"), index=True
    )

    title: Mapped[str] = mapped_column(Text, nullable=False)
    meeting_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="team_sync"
    )
    recurrence_rule: Mapped[str] = mapped_column(Text, nullable=False)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time_local: Mapped[time] = mapped_column(Time, nullable=False)
    timezone_name: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False, server_default="30")

    excluded_dates: Mapped[list[date]] = mapped_column(
        ARRAY(Date), nullable=False, server_default="{}"
    )
    until_date: Mapped[date | None] = mapped_column(Date)

    agenda_template: Mapped[str | None] = mapped_column(Text)
    preparation_template: Mapped[str | None] = mapped_column(Text)
    conferencing_url: Mapped[str | None] = mapped_column(Text)

    materialized_through: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )


class Meeting(PrimaryKey, Timestamps, Base):
    __tablename__ = "meetings"
    __table_args__ = (
        # Exactly one owner: an interview stage, or a maintained job.
        CheckConstraint(
            "num_nonnulls(stage_id, maintained_job_id) = 1",
            name="exactly_one_owner",
        ),
        Index("ix_meetings_user_starts", "user_id", "starts_at"),
        Index(
            "ix_meetings_user_upcoming",
            "user_id",
            "starts_at",
            postgresql_where=text("status = 'scheduled'"),
        ),
        # Makes series materialisation idempotent and safely re-runnable.
        Index(
            "uq_meetings_series_occurrence",
            "series_id",
            "occurrence_local_date",
            unique=True,
            postgresql_where=text("series_id IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stage_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("application_stages.id", ondelete="CASCADE")
    )
    maintained_job_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("maintained_jobs.id", ondelete="CASCADE")
    )
    series_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("meeting_series.id", ondelete="SET NULL")
    )
    occurrence_local_date: Mapped[date | None] = mapped_column(Date)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    meeting_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="interview"
    )

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    display_timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )

    status: Mapped[MeetingStatus] = mapped_column(
        MEETING_STATUS_ENUM, nullable=False, server_default=MeetingStatus.SCHEDULED.value
    )
    location: Mapped[str | None] = mapped_column(Text)
    conferencing_url: Mapped[str | None] = mapped_column(Text)
    attendees: Mapped[list | None] = mapped_column(JSONB, server_default="[]")

    agenda: Mapped[str | None] = mapped_column(Text)
    preparation_notes: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    follow_ups: Mapped[str | None] = mapped_column(Text)

    reminder_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="30"
    )
    # Set when a user edits one occurrence of a series; regeneration skips these.
    is_exception: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
