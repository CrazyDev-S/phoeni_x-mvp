"""Resume storage.

The canonical form is Resume Markdown, stored in
``content_markdown``. ``content_text`` is a derived flattening used for full-text
search and ATS keyword scanning; it is never the source of truth.

``base_resumes`` and ``tailored_resumes`` are deliberately separate tables.
The ``all_resumes`` view (see the migration) gives list endpoints a single
place to read from, so there is still exactly one parser, one validator and
one exporter.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    Computed,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import ResumeMode, ResumeSource, ResumeStatus, pg_enum

RESUME_SOURCE_ENUM = pg_enum(ResumeSource, "resume_source")
RESUME_MODE_ENUM = pg_enum(ResumeMode, "resume_mode")
RESUME_STATUS_ENUM = pg_enum(ResumeStatus, "resume_status")

CURRENT_MARKDOWN_VERSION = 1

SEARCH_VECTOR_EXPRESSION = (
    "to_tsvector('english', "
    "coalesce(display_name,'') || ' ' || coalesce(content_text,''))"
)


class BaseResume(PrimaryKey, Timestamps, Base):
    __tablename__ = "base_resumes"
    __table_args__ = (
        Index("ix_base_resumes_user_created", "user_id", text("created_at DESC")),
        Index("ix_base_resumes_tsv", "search_vector", postgresql_using="gin"),
        Index(
            "uq_base_resumes_user_display_name",
            "user_id",
            text("lower(display_name)"),
            unique=True,
            postgresql_where=text("NOT is_archived"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Display name carries the stack, e.g. "Senior AI Fullstack - Python/FastAPI".
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    target_title: Mapped[str] = mapped_column(Text, nullable=False)
    stack_label: Mapped[str | None] = mapped_column(Text)
    stack_tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )

    source: Mapped[ResumeSource] = mapped_column(RESUME_SOURCE_ENUM, nullable=False)
    mode: Mapped[ResumeMode] = mapped_column(
        RESUME_MODE_ENUM, nullable=False, server_default=ResumeMode.GROUNDED.value
    )

    # Canonical.
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_text: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    markdown_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=str(CURRENT_MARKDOWN_VERSION)
    )

    # BLOCK 1 / BLOCK 3 / BLOCK 4 of the generator prompt's output contract.
    ledger: Mapped[dict | None] = mapped_column(JSONB)
    ats_report: Mapped[dict | None] = mapped_column(JSONB)
    flags: Mapped[dict | None] = mapped_column(JSONB)
    validation: Mapped[dict | None] = mapped_column(JSONB)

    job_description_text: Mapped[str | None] = mapped_column(Text)
    generation_meta: Mapped[dict | None] = mapped_column(JSONB, server_default="{}")
    source_generation_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    status: Mapped[ResumeStatus] = mapped_column(
        RESUME_STATUS_ENUM, nullable=False, server_default=ResumeStatus.FINAL.value
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    search_vector: Mapped[str | None] = mapped_column(TSVECTOR, Computed(SEARCH_VECTOR_EXPRESSION, persisted=True))


class TailoredResume(PrimaryKey, Timestamps, Base):
    __tablename__ = "tailored_resumes"
    __table_args__ = (
        Index("ix_tailored_resumes_user_created", "user_id", text("created_at DESC")),
        Index("ix_tailored_resumes_tsv", "search_vector", postgresql_using="gin"),
        # The instant path: an identical (base, JD) pair returns the saved copy
        # instead of re-spending 90 seconds and real money.
        Index(
            "uq_tailored_resumes_base_jd",
            "base_resume_id",
            "job_description_hash",
            unique=True,
            postgresql_where=text("status <> 'draft'"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # RESTRICT, not CASCADE: deleting a base resume must not vaporise the
    # tailored versions somebody actually applied with. Archive instead.
    base_resume_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("base_resumes.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    job_application_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("job_applications.id", ondelete="SET NULL"),
        index=True,
    )

    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    company_name: Mapped[str | None] = mapped_column(Text)
    job_title: Mapped[str | None] = mapped_column(Text)
    job_url: Mapped[str | None] = mapped_column(Text)
    job_source: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="manual"
    )  # manual | web | extension

    job_description_text: Mapped[str] = mapped_column(Text, nullable=False)
    job_description_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    job_description_parsed: Mapped[dict | None] = mapped_column(JSONB)

    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_text: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    markdown_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=str(CURRENT_MARKDOWN_VERSION)
    )

    ledger: Mapped[dict | None] = mapped_column(JSONB)
    ats_report: Mapped[dict | None] = mapped_column(JSONB)
    flags: Mapped[dict | None] = mapped_column(JSONB)
    validation: Mapped[dict | None] = mapped_column(JSONB)

    # Materialised from ats_report because the pipeline table sorts on them.
    must_have_covered: Mapped[int | None] = mapped_column(Integer)
    must_have_total: Mapped[int | None] = mapped_column(Integer)
    must_have_coverage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    nice_to_have_coverage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    years_required: Mapped[int | None] = mapped_column(Integer)
    years_shown: Mapped[float | None] = mapped_column(Numeric(4, 1))

    status: Mapped[ResumeStatus] = mapped_column(
        RESUME_STATUS_ENUM, nullable=False, server_default=ResumeStatus.DRAFT.value
    )
    generation_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    generation_meta: Mapped[dict | None] = mapped_column(JSONB, server_default="{}")

    search_vector: Mapped[str | None] = mapped_column(TSVECTOR, Computed(SEARCH_VECTOR_EXPRESSION, persisted=True))
