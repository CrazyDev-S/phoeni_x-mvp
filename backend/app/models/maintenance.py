"""Post-hire job maintenance."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import MaintainedJobStatus, pg_enum

MAINTAINED_STATUS_ENUM = pg_enum(MaintainedJobStatus, "maintained_job_status")


class MaintainedJob(PrimaryKey, Timestamps, Base):
    __tablename__ = "maintained_jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_application_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("job_applications.id", ondelete="SET NULL"),
        unique=True,
    )

    employer_name: Mapped[str] = mapped_column(Text, nullable=False)
    role_title: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    manager_name: Mapped[str | None] = mapped_column(Text)
    team: Mapped[str | None] = mapped_column(Text)
    employment_type: Mapped[str | None] = mapped_column(Text)

    status: Mapped[MaintainedJobStatus] = mapped_column(
        MAINTAINED_STATUS_ENUM,
        nullable=False,
        server_default=MaintainedJobStatus.ACTIVE.value,
    )
    onboarding_notes: Mapped[str | None] = mapped_column(Text)
    notes_markdown: Mapped[str | None] = mapped_column(Text)
