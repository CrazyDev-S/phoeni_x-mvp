"""Identity, settings, credentials, and the model catalog."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import CredentialStatus, LLMProvider, pg_enum

PROVIDER_ENUM = pg_enum(LLMProvider, "llm_provider")
CRED_STATUS_ENUM = pg_enum(CredentialStatus, "credential_status")


class User(PrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text)
    # IANA zone, never the string "EST".
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    settings: Mapped[UserSettings] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class UserSettings(Timestamps, Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_provider: Mapped[LLMProvider] = mapped_column(
        PROVIDER_ENUM, nullable=False, server_default=LLMProvider.ANTHROPIC.value
    )
    heavy_model: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="claude-opus-5"
    )
    mid_model: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="claude-sonnet-5"
    )
    fast_model: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="claude-haiku-4-5"
    )
    # Generator-prompt behaviour. The prompt hardcodes China; this overrides it
    # through the CONSTRAINTS channel the prompt already supports.
    base_country: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="Thailand"
    )
    research_dossiers: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    strict_dossier: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # The generator prompt requires real, searched employers: a company may not
    # be named until its dossier is filled and verified. Turning this off
    # substitutes archetype descriptions instead, which is a weaker document.
    allow_real_company_names: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    monthly_budget_usd_micros: Mapped[int | None] = mapped_column(BigInteger)
    display_timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )

    user: Mapped[User] = relationship(back_populates="settings")


class LLMCredential(PrimaryKey, Timestamps, Base):
    __tablename__ = "llm_credentials"
    __table_args__ = (UniqueConstraint("user_id", "provider", "label"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[LLMProvider] = mapped_column(PROVIDER_ENUM, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False, server_default="default")

    key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encryption_key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    key_last4: Mapped[str] = mapped_column(String(8), nullable=False)
    key_fingerprint: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    status: Mapped[CredentialStatus] = mapped_column(
        CRED_STATUS_ENUM, nullable=False, server_default=CredentialStatus.UNVERIFIED.value
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class ApiToken(PrimaryKey, Timestamps, Base):
    """Long-lived personal access token used by the browser extension."""

    __tablename__ = "api_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ModelCatalog(Base):
    """Capabilities and pricing per model.

    Kept in the database rather than hardcoded so that adding a model, or
    correcting a price, is data rather than a deploy.
    """

    __tablename__ = "model_catalog"

    provider: Mapped[LLMProvider] = mapped_column(PROVIDER_ENUM, primary_key=True)
    model_id: Mapped[str] = mapped_column(Text, primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    tier: Mapped[str] = mapped_column(Text, nullable=False)  # heavy | mid | fast

    context_window: Mapped[int] = mapped_column(Integer, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    min_cacheable_prefix_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1024"
    )

    # Money as integer micro-dollars per million tokens. Never float.
    price_in_usd_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    price_out_usd_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    price_cache_read_usd_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    price_cache_write_5m_usd_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    price_cache_write_1h_usd_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )

    caps: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
