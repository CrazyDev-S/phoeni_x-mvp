"""Imports every model so the tables register themselves on Base.metadata.

SQLAlchemy only knows about a table once its class has been imported, so
anything that reads the metadata - schema creation, most obviously - has to
import this module first. It exists to make that dependency explicit and
greppable rather than a side effect of importing a package.
"""

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
from app.models.job_link import JobLink
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
    "JobLink",
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
