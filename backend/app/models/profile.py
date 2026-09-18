"""Candidate profile - the ground truth for Mode A (Grounded) generation."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import WorkMode, pg_enum

WORK_MODE_ENUM = pg_enum(WorkMode, "work_mode")


class CandidateProfile(PrimaryKey, Timestamps, Base):
    __tablename__ = "candidate_profiles"
    __table_args__ = (
        # One default profile per user, enforced by a partial unique index.
        Index(
            "uq_candidate_profiles_user_default",
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
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    full_name: Mapped[str | None] = mapped_column(Text)
    headline: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    links: Mapped[list | None] = mapped_column(JSONB, server_default="[]")

    # Nothing computes over these, so JSONB is the right shape.
    geography: Mapped[dict | None] = mapped_column(JSONB, server_default="{}")
    education: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    certifications: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    languages: Mapped[list | None] = mapped_column(JSONB, server_default="[]")

    total_experience_months: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(Text)
    raw_profile_markdown: Mapped[str | None] = mapped_column(Text)

    employments: Mapped[list[ProfileEmployment]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="ProfileEmployment.start_date.desc()",
    )


class ProfileEmployment(PrimaryKey, Timestamps, Base):
    """Normalised, not JSONB.

    The tenure / gap / promotion validators do arithmetic over these rows, so
    they need to be queryable columns rather than blobs.
    """

    __tablename__ = "profile_employments"

    profile_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    company_domain: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    work_mode: Mapped[WorkMode | None] = mapped_column(WORK_MODE_ENUM)
    city: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(Text)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    promotion_from_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("profile_employments.id", ondelete="SET NULL")
    )
    stack: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    highlights: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    context: Mapped[str | None] = mapped_column(Text)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    profile: Mapped[CandidateProfile] = relationship(back_populates="employments")


class AutofillProfile(Timestamps, Base):
    """Answers a resume cannot supply.

    Without this, the form filler invents answers to questions like notice
    period and salary expectation.
    """

    __tablename__ = "autofill_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    extra_notes_markdown: Mapped[str | None] = mapped_column(Text)


class ApplicationFormAnswer(PrimaryKey, Timestamps, Base):
    """Cache of answers keyed by form shape, so a repeat ATS form is free."""

    __tablename__ = "application_form_answers"
    __table_args__ = (UniqueConstraint("user_id", "form_fingerprint"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    form_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    ats: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    answers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
