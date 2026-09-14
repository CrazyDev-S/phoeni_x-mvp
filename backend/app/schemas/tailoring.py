from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Mode = Literal["grounded", "constructed"]
# existing: reframe the resume - employers, titles and dates stay.
# full: build a new resume from the job description, the old one as the profile.
Strategy = Literal["existing", "full"]


class GenerateFromStory(BaseModel):
    target_title: str = Field(min_length=2, max_length=160)
    skill_count: int | None = Field(default=None, ge=4, le=40)
    extra_instructions: str | None = Field(default=None, max_length=8000)
    mode: Mode | None = None
    display_name: str | None = Field(default=None, max_length=160)
    stack_label: str | None = Field(default=None, max_length=120)


class GenerateFromJob(BaseModel):
    target_title: str = Field(min_length=2, max_length=160)
    job_description: str = Field(min_length=40, max_length=60_000)
    candidate_info: str | None = Field(default=None, max_length=40_000)
    extra_instructions: str | None = Field(default=None, max_length=8000)
    mode: Mode | None = None
    display_name: str | None = Field(default=None, max_length=160)


class TailorToJob(BaseModel):
    base_resume_id: uuid.UUID
    job_description: str = Field(min_length=40, max_length=60_000)
    job_url: str | None = Field(default=None, max_length=2000)
    company_name: str | None = Field(default=None, max_length=160)
    job_title: str | None = Field(default=None, max_length=160)
    display_name: str | None = Field(default=None, max_length=160)
    source: Literal["web", "extension", "manual"] = "web"
    # Skip the instant path and force a fresh generation.
    force: bool = False
    strategy: Strategy = "existing"
    # Tailored for a tracked application: the result is linked to it.
    application_id: uuid.UUID | None = None


class TailorApplication(BaseModel):
    base_resume_id: uuid.UUID
    strategy: Strategy = "existing"


class UpgradeTailored(BaseModel):
    strategy: Strategy = "existing"


class TailorByInstruction(BaseModel):
    base_resume_id: uuid.UUID
    instructions: str = Field(min_length=3, max_length=8000)
    display_name: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def _not_blank(self):
        if not self.instructions.strip():
            raise ValueError("instructions cannot be blank")
        return self
