"""Job applications and the configurable interview pipeline."""

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
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import ApplicationStatus, StageStatus, WorkMode, pg_enum
from app.models.profile import WORK_MODE_ENUM

APPLICATION_STATUS_ENUM = pg_enum(ApplicationStatus, "application_status")
STAGE_STATUS_ENUM = pg_enum(StageStatus, "stage_status")


class JobApplication(PrimaryKey, Timestamps, Base):
    __tablename__ = "job_applications"
    __table_args__ = (
        Index("ix_job_applications_user_status", "user_id", "status", text("created_at DESC")),
        Index(
            "ix_job_applications_next_action",
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
    tailored_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tailored_resumes.id", ondelete="SET NULL", use_alter=True),
    )

    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    company_domain: Mapped[str | None] = mapped_column(Text)
    role_title: Mapped[str] = mapped_column(Text, nullable=False)
    job_url: Mapped[str | None] = mapped_column(Text)
    job_description_text: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    work_mode: Mapped[WorkMode | None] = mapped_column(WORK_MODE_ENUM)

    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_currency: Mapped[str | None] = mapped_column(String(3))

    status: Mapped[ApplicationStatus] = mapped_column(
        APPLICATION_STATUS_ENUM,
        nullable=False,
        server_default=ApplicationStatus.SAVED.value,
    )
    origin: Mapped[str] = mapped_column(Text, nullable=False, server_default="web")
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes_markdown: Mapped[str | None] = mapped_column(Text)

    stages: Mapped[list[ApplicationStage]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApplicationStage.seq",
    )


class StageTemplate(PrimaryKey, Timestamps, Base):
    """A reusable interview pipeline. ``user_id`` NULL means a system default."""

    __tablename__ = "stage_templates"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    items: Mapped[list[StageTemplateItem]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="StageTemplateItem.seq",
    )


class StageTemplateItem(PrimaryKey, Base):
    __tablename__ = "stage_template_items"
    __table_args__ = (UniqueConstraint("template_id", "seq"),)

    template_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stage_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    # Stage names are user-configurable text, never a native enum.
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    default_duration_min: Mapped[int | None] = mapped_column(Integer)

    template: Mapped[StageTemplate] = relationship(back_populates="items")


class ApplicationStage(PrimaryKey, Timestamps, Base):
    __tablename__ = "application_stages"
    __table_args__ = (UniqueConstraint("application_id", "seq"),)

    application_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("job_applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default="other")
    status: Mapped[StageStatus] = mapped_column(
        STAGE_STATUS_ENUM, nullable=False, server_default=StageStatus.PENDING.value
    )
    # Denormalised from the stage's primary meeting so the tracking table can
    # sort without a join.
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    interviewers: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    outcome_notes: Mapped[str | None] = mapped_column(Text)
    preparation_markdown: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    application: Mapped[JobApplication] = relationship(back_populates="stages")


class ApplicationStageEvent(Base):
    """Append-only stage history.

    ``rescheduled`` is an event, not a resting state - without this table,
    "rescheduled twice, now passed" is unrepresentable.
    """

    __tablename__ = "application_stage_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("application_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[StageStatus | None] = mapped_column(STAGE_STATUS_ENUM)
    to_status: Mapped[StageStatus] = mapped_column(STAGE_STATUS_ENUM, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
