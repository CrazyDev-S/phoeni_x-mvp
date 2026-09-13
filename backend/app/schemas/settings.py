from __future__ import annotations

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
