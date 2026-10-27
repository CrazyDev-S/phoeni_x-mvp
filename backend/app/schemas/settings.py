from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import CredentialStatus, LLMProvider


class CredentialOut(BaseModel):
    provider: LLMProvider
    configured: bool
    masked_key: str
    status: CredentialStatus
    last_error: str | None = None


class SettingsOut(BaseModel):
    default_provider: LLMProvider
    heavy_model: str
    mid_model: str
    fast_model: str
    base_country: str
    research_dossiers: bool
    strict_dossier: bool
    allow_real_company_names: bool
    display_timezone: str
    credentials: list[CredentialOut] = Field(default_factory=list)


class SettingsPatch(BaseModel):
    default_provider: LLMProvider | None = None
    heavy_model: str | None = None
    mid_model: str | None = None
    fast_model: str | None = None
    base_country: str | None = None
    research_dossiers: bool | None = None
    strict_dossier: bool | None = None
    allow_real_company_names: bool | None = None
    display_timezone: str | None = None


class ApiKeyIn(BaseModel):
    provider: LLMProvider
    api_key: str = Field(min_length=12, max_length=400)
    label: str = "default"


class ConnectionTest(BaseModel):
    ok: bool
    provider: LLMProvider
    model: str
    detail: str


class ModelOut(BaseModel):
    provider: LLMProvider
    model_id: str
    display_name: str
    tier: str
    context_window: int
    max_output_tokens: int


class AutofillProfileOut(BaseModel):
    """The answers a resume cannot supply.

    Without these the form filler has nothing to answer a phone number or a
    notice period with, and the prompt correctly refuses to invent one - so
    every such field comes back as "not present in your profile".
    """

    fields: dict[str, str] = Field(default_factory=dict)
    extra_notes_markdown: str | None = None


class AutofillProfileIn(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict, max_length=80)
    extra_notes_markdown: str | None = Field(default=None, max_length=4000)


class ResumeProfileIn(BaseModel):
    """Who a generated resume is for. Every field is optional."""

    full_name: str | None = Field(default=None, max_length=160)
    headline: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=160)
    links: list[str] = Field(default_factory=list, max_length=10)
    education: list[str] = Field(default_factory=list, max_length=10)
    # Employers, titles, dates and stack. Given, generation keeps them (Grounded).
    summary: str | None = Field(default=None, max_length=20_000)


class ResumeProfileOut(ResumeProfileIn):
    # What generating a resume runs in with this profile.
    mode: Literal["grounded", "constructed"] = "constructed"
    # False until something is saved: the model then invents a name and contacts.
    configured: bool = False
