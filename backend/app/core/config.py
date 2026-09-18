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
    app_name: str = "Phoenix Eye"

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
