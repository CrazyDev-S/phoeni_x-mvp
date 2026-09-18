"""Which resume goes with which job posting, keyed by the posting's URL.

The side panel works tab by tab, and to the panel a tab is only a URL.
Tailoring five open postings at once, closing the panel, and coming back later
has to find each posting's resume again - including from its application form,
whose URL is often the posting's plus ``/application``. So a link is stored
against a normalised key (``services.job_links.job_key``), not the raw URL.

A link is not an application. Saving one stays an explicit step.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps


class JobLink(PrimaryKey, Timestamps, Base):
    __tablename__ = "job_links"
    __table_args__ = (UniqueConstraint("user_id", "job_key"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_key: Mapped[str] = mapped_column(Text, nullable=False)
    # The first URL seen for the posting, for opening it again.
    job_url: Mapped[str] = mapped_column(Text, nullable=False)
    company_name: Mapped[str | None] = mapped_column(Text)
    job_title: Mapped[str | None] = mapped_column(Text)
    ats: Mapped[str | None] = mapped_column(Text)
    # Read off the posting when it was tailored or linked. The application
    # form's own page is mostly the form, which is poor context for "why us".
    job_description_text: Mapped[str | None] = mapped_column(Text)

    # "base" or "tailored": which of the two ids below is the posting's resume.
    # A base resume id is also kept while tailoring, as the one tailored from.
    resume_kind: Mapped[str | None] = mapped_column(Text)
    base_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("base_resumes.id", ondelete="SET NULL")
    )
    tailored_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tailored_resumes.id", ondelete="SET NULL")
    )
    # The latest tailoring run, so its progress survives the panel closing.
    generation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("generations.id", ondelete="SET NULL")
    )
