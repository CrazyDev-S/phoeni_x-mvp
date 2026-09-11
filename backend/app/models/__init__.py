"""All ORM models. Importing this module registers every table on Base.metadata."""

from app.db.base import Base
from app.models.application import (
    ApplicationStage,
    ApplicationStageEvent,
    JobApplication,
    StageTemplate,
    StageTemplateItem,
)
from app.models.calendar import Meeting, MeetingSeries
from app.models.generation import Generation, GenerationEvent, LLMCall
from app.models.maintenance import MaintainedJob
from app.models.profile import (
    ApplicationFormAnswer,
    AutofillProfile,
    CandidateProfile,
    ProfileEmployment,
)
from app.models.resume import BaseResume, TailoredResume
from app.models.user import ApiToken, LLMCredential, ModelCatalog, User, UserSettings

__all__ = [
    "ApiToken",
    "ApplicationFormAnswer",
    "ApplicationStage",
    "ApplicationStageEvent",
    "AutofillProfile",
    "Base",
    "BaseResume",
    "CandidateProfile",
    "Generation",
    "GenerationEvent",
    "JobApplication",
    "LLMCall",
    "LLMCredential",
    "MaintainedJob",
    "Meeting",
    "MeetingSeries",
    "ModelCatalog",
    "ProfileEmployment",
    "StageTemplate",
    "StageTemplateItem",
    "TailoredResume",
    "User",
    "UserSettings",
]
