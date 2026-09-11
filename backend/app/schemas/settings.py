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
