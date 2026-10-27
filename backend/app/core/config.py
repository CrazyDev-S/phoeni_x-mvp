"""Application configuration, loaded once from the environment."""

from __future__ import annotations

import base64
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_env: str = "development"
    app_name: str = "PhoeniX"

    # Secrets
    app_secret_key: str = Field(min_length=32)
    app_kek: str = Field(description="base64-encoded 32-byte key-encryption key")

    # Database
    database_url: str

    # Auth
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30
    jwt_algorithm: str = "HS256"

    # CORS. Extension origins are derived from EXTENSION_IDS.
    cors_origins: str = "http://localhost:3000"
    extension_ids: str = ""

    display_timezone: str = "America/New_York"

    # PDF export converts the .docx with LibreOffice. Empty finds soffice on PATH.
    soffice_path: str = ""

    # Where the two surfaces live, as the BROWSER reaches them. The Upwork
    # OAuth callback lands on the API and then sends the browser back to the
    # portal, so both have to be public URLs, not 127.0.0.1 on a remote box.
    api_public_url: str = "http://127.0.0.1:8000"
    portal_url: str = "http://localhost:3000"

    # Which provider answers job searches: a key in
    # app.freelancing.sources.registry.SOURCES. "apify" runs the Apify actor
    # below; "upwork" calls Upwork's own GraphQL API with the user's OAuth token.
    freelancing_job_source: str = "apify"

    # The Apify job source. A user's own token (Settings -> Integrations) wins
    # over APIFY_TOKEN. Every run is billed by the actor, per job returned.
    apify_token: str = ""
    # The actor that scrapes Upwork. Each one supported has an input mapping in
    # app/freelancing/apify/: "upwork-vibe~upwork-job-scraper" (default) or
    # "neatrat~upwork-job-scraper".
    apify_upwork_actor_id: str = "upwork-vibe~upwork-job-scraper"
    # upwork-vibe only: per-job add-ons, each billed per job returned. Client
    # activity supplies the proposal count; client details the company name.
    apify_client_activity_addon: bool = False
    apify_client_details_addon: bool = False
    # Pages of results fetched per run. More per run means fewer, larger (and
    # pricier) runs.
    apify_pages_per_run: int = Field(default=1, ge=1, le=10)
    # How long one search request waits on a run before answering "still
    # running" and letting the portal ask again. Apify caps a wait at 60s.
    apify_wait_seconds: int = Field(default=25, ge=0, le=60)
    # A run that has not finished by then is stopped by Apify.
    apify_run_timeout_seconds: int = Field(default=300, ge=30, le=3600)
    # Optional ceiling on what one run may charge, in USD.
    apify_max_charge_usd: float | None = None
    # An identical search inside this window reuses the run it started,
    # rather than paying for the same scrape twice.
    apify_reuse_minutes: int = Field(default=30, ge=0, le=1440)

    # Upwork API key pair for the whole deployment. A user can store their own
    # pair in Settings instead; that takes precedence. Empty means "not set".
    upwork_client_id: str = ""
    upwork_client_secret: str = ""
    # Must match the redirect URI registered on the Upwork key exactly. Left
    # empty, it is derived from API_PUBLIC_URL.
    upwork_redirect_uri: str = ""

    # Run the generation worker inside the API process.
    worker_in_process: bool = True
    # Generations run at once. The side panel tailors every open tab together;
    # with one at a time, the fifth tab waited out four full runs.
    worker_concurrency: int = Field(default=3, ge=1, le=16)

    @field_validator("app_kek")
    @classmethod
    def _kek_is_32_bytes(cls, v: str) -> str:
        try:
            raw = base64.b64decode(v, validate=True)
        except Exception as exc:  # pragma: no cover - config error path
            raise ValueError("APP_KEK must be valid base64") from exc
        if len(raw) != 32:
            raise ValueError("APP_KEK must decode to exactly 32 bytes (AES-256)")
        return v

    @property
    def encryption_key_bytes(self) -> bytes:
        return base64.b64decode(self.app_kek)

    @property
    def allowed_origins(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        for ext_id in (e.strip() for e in self.extension_ids.split(",")):
            if ext_id:
                origins.append(f"chrome-extension://{ext_id}")
        return origins

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def upwork_callback_url(self) -> str:
        return (
            self.upwork_redirect_uri
            or f"{self.api_public_url.rstrip('/')}/api/v1/freelancing/upwork/callback"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
