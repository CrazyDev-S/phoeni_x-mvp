"""Enumerations.

Native PostgreSQL enums are used only for genuinely closed sets. Anything a
user can configure - most importantly interview stage names - is ``text``
plus a lookup table, because ``ALTER TYPE ... ADD VALUE`` cannot run inside a
transaction on every path and values can never be removed. Modelling a
user-editable pipeline as an enum guarantees a migration crisis the first
time somebody adds "Take-home review".
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def pg_enum[E: StrEnum](enum_cls: type[E], name: str) -> SAEnum:
    """Native PostgreSQL enum whose labels are the enum VALUES.

    Without ``values_callable`` SQLAlchemy emits member NAMES ("GROUNDED"),
    which then disagree with every server_default and every value the API
    serialises.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda c: [m.value for m in c],
    )


class LLMProvider(StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"


class CredentialStatus(StrEnum):
    UNVERIFIED = "unverified"
    VALID = "valid"
    INVALID = "invalid"
    REVOKED = "revoked"


class ResumeSource(StrEnum):
    UPLOAD = "upload"
    GENERATED_STORY = "generated_story"
    GENERATED_JOB = "generated_job"
    TAILORED_JOB = "tailored_job"
    TAILORED_INSTRUCTION = "tailored_instruction"


class ResumeMode(StrEnum):
    """Mode A / Mode B from the generator prompt."""

    GROUNDED = "grounded"
    CONSTRUCTED = "constructed"


class WorkMode(StrEnum):
    ONSITE = "onsite"
    HYBRID = "hybrid"
    REMOTE = "remote"


class GenerationKind(StrEnum):
    RESUME_STORY = "resume_story"
    RESUME_JOB = "resume_job"
    TAILOR_JOB = "tailor_job"
    TAILOR_INSTRUCTION = "tailor_instruction"
    RESUME_REPAIR = "resume_repair"
    FORM_ANSWER = "form_answer"
    JD_PARSE = "jd_parse"


class GenerationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    NEEDS_REVIEW = "needs_review"


class ApplicationStatus(StrEnum):
    SAVED = "saved"
    APPLIED = "applied"
    IN_PROCESS = "in_process"
    OFFER = "offer"
    HIRED = "hired"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    GHOSTED = "ghosted"


class StageStatus(StrEnum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    # A resting state for display only. The truth for "rescheduled twice, then
    # passed" lives in application_stage_events.
    RESCHEDULED = "rescheduled"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    WAITING_FEEDBACK = "waiting_feedback"
    SKIPPED = "skipped"


class MeetingStatus(StrEnum):
    SCHEDULED = "scheduled"
    HELD = "held"
    CANCELLED = "cancelled"
    RESCHEDULED = "rescheduled"
    NO_SHOW = "no_show"


class ResumeStatus(StrEnum):
    DRAFT = "draft"
    NEEDS_REVIEW = "needs_review"
    FINAL = "final"


class MaintainedJobStatus(StrEnum):
    ACTIVE = "active"
    ENDED = "ended"


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"
