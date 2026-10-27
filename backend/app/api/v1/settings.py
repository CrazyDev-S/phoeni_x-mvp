"""Provider settings and API-key management.

Keys are write-only over the API: a read returns a mask and a status, never
the secret. Storage is AES-256-GCM with the ciphertext bound to its owner.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.crypto import mask, seal
from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.llm.catalog import ALL_MODELS, DEFAULT_TIERS
from app.llm.factory import get_provider
from app.models.enums import CredentialStatus, LLMProvider
from app.models.profile import AutofillProfile, CandidateProfile
from app.models.user import LLMCredential, UserSettings
from app.remote.services.candidate_profile import (
    DEFAULT_NAME,
    default_profile,
    generation_mode,
    profile_markdown,
)
from app.schemas.settings import (
    ApiKeyIn,
    AutofillProfileIn,
    AutofillProfileOut,
    ConnectionTest,
    CredentialOut,
    ModelOut,
    ResumeProfileIn,
    ResumeProfileOut,
    SettingsOut,
    SettingsPatch,
)

router = APIRouter(prefix="/settings", tags=["settings"])


async def _settings_row(session: Session, user: CurrentUser) -> UserSettings:
    row = await session.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id)
        session.add(row)
        await session.flush()
    return row


async def _credentials(session: Session, user: CurrentUser) -> list[CredentialOut]:
    rows = list(
        await session.scalars(
            select(LLMCredential).where(LLMCredential.user_id == user.id)
        )
    )
    by_provider = {r.provider: r for r in rows}
    return [
        CredentialOut(
            provider=p,
            configured=p in by_provider,
            masked_key=mask(by_provider[p].key_last4, p.value) if p in by_provider else "not configured",
            status=by_provider[p].status if p in by_provider else CredentialStatus.UNVERIFIED,
            last_error=by_provider[p].last_error if p in by_provider else None,
        )
        for p in LLMProvider
    ]


@router.get("", response_model=SettingsOut)
async def read_settings(user: CurrentUser, session: Session) -> SettingsOut:
    row = await _settings_row(session, user)
    return SettingsOut(
        **{
            f: getattr(row, f)
            for f in (
                "default_provider", "heavy_model", "mid_model", "fast_model",
                "base_country", "research_dossiers", "strict_dossier",
                "allow_real_company_names", "display_timezone",
            )
        },
        credentials=await _credentials(session, user),
    )


@router.patch("", response_model=SettingsOut)
async def update_settings(
    body: SettingsPatch, user: CurrentUser, session: Session
) -> SettingsOut:
    row = await _settings_row(session, user)
    data = body.model_dump(exclude_unset=True)
    provider = data.get("default_provider")
    if provider is not None and provider != row.default_provider:
        # Each provider has its own models: switching takes its defaults for
        # every tier the same request does not set explicitly.
        for tier, model in DEFAULT_TIERS[provider].items():
            data.setdefault(f"{tier}_model", model)
    for field, value in data.items():
        setattr(row, field, value)
    await session.flush()
    return await read_settings(user, session)


@router.put("/api-key", response_model=CredentialOut)
async def put_api_key(
    body: ApiKeyIn, user: CurrentUser, session: Session
) -> CredentialOut:
    sealed = seal(
        body.api_key.strip(),
        user_id=str(user.id),
        provider=body.provider.value,
        label=body.label,
    )
    row = await session.scalar(
        select(LLMCredential).where(
            LLMCredential.user_id == user.id,
            LLMCredential.provider == body.provider,
            LLMCredential.label == body.label,
        )
    )
    if row is None:
        row = LLMCredential(user_id=user.id, provider=body.provider, label=body.label)
        session.add(row)

    row.key_ciphertext = sealed.ciphertext
    row.key_nonce = sealed.nonce
    row.encryption_key_version = sealed.encryption_key_version
    row.key_last4 = sealed.last4
    row.key_fingerprint = sealed.fingerprint
    row.status = CredentialStatus.UNVERIFIED
    row.last_error = None
    await session.flush()

    return CredentialOut(
        provider=row.provider,
        configured=True,
        masked_key=mask(row.key_last4, row.provider.value),
        status=row.status,
    )


@router.delete("/api-key/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    provider: LLMProvider, user: CurrentUser, session: Session
) -> None:
    row = await session.scalar(
        select(LLMCredential).where(
            LLMCredential.user_id == user.id, LLMCredential.provider == provider
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not configured")
    await session.delete(row)


@router.post("/test-connection", response_model=ConnectionTest)
async def test_connection(
    user: CurrentUser, session: Session, tier: str = "heavy"
) -> ConnectionTest:
    """One real, one-token call. Records the outcome so the UI can show it."""
    provider = await get_provider(session, user.id, tier)
    ok, detail = await provider.healthcheck()

    settings_row = await _settings_row(session, user)
    cred = await session.scalar(
        select(LLMCredential).where(
            LLMCredential.user_id == user.id,
            LLMCredential.provider == settings_row.default_provider,
        )
    )
    if cred is not None:
        cred.status = CredentialStatus.VALID if ok else CredentialStatus.INVALID
        cred.last_error = None if ok else detail
        cred.last_verified_at = utc_now()

    return ConnectionTest(
        ok=ok, provider=settings_row.default_provider, model=provider.model, detail=detail
    )


@router.get("/models", response_model=list[ModelOut])
async def list_models() -> list[ModelOut]:
    return [
        ModelOut(
            provider=m.provider,
            model_id=m.model_id,
            display_name=m.display_name,
            tier=m.tier,
            context_window=m.context_window,
            max_output_tokens=m.max_output_tokens,
        )
        for m in ALL_MODELS
    ]


@router.get("/defaults")
async def model_defaults() -> dict:
    return {p.value: tiers for p, tiers in DEFAULT_TIERS.items()}


@router.get("/autofill-profile", response_model=AutofillProfileOut)
async def get_autofill_profile(user: CurrentUser, session: Session) -> AutofillProfileOut:
    row = await session.get(AutofillProfile, user.id)
    if row is None:
        return AutofillProfileOut()
    return AutofillProfileOut(
        fields=row.fields or {}, extra_notes_markdown=row.extra_notes_markdown
    )


@router.put("/autofill-profile", response_model=AutofillProfileOut)
async def put_autofill_profile(
    body: AutofillProfileIn, user: CurrentUser, session: Session
) -> AutofillProfileOut:
    """Replace the stored answers.

    A whole-document PUT rather than a patch: the editor owns the full set, and
    a partial merge would make removing a key impossible.
    """
    cleaned = {
        key.strip(): value.strip()
        for key, value in body.fields.items()
        if key.strip() and value.strip()
    }

    row = await session.get(AutofillProfile, user.id)
    if row is None:
        row = AutofillProfile(user_id=user.id, fields=cleaned)
        session.add(row)
    else:
        row.fields = cleaned
    row.extra_notes_markdown = body.extra_notes_markdown or None

    return AutofillProfileOut(fields=cleaned, extra_notes_markdown=row.extra_notes_markdown)


@router.get("/resume-profile", response_model=ResumeProfileOut)
async def get_resume_profile(user: CurrentUser, session: Session) -> ResumeProfileOut:
    return _resume_profile_out(await default_profile(session, user.id))


@router.put("/resume-profile", response_model=ResumeProfileOut)
async def put_resume_profile(
    body: ResumeProfileIn, user: CurrentUser, session: Session
) -> ResumeProfileOut:
    """Replace the profile generating a resume reads as CANDIDATE_PROFILE.

    The text the generator reads is written here, from the fields, so every
    generation path picks it up without knowing the fields exist.
    """
    row = await default_profile(session, user.id)
    if row is None:
        row = CandidateProfile(user_id=user.id, name=DEFAULT_NAME, is_default=True)
        session.add(row)

    for field in ("full_name", "headline", "email", "phone", "location", "summary"):
        value = getattr(body, field)
        setattr(row, field, value.strip() if value and value.strip() else None)
    row.links = [link.strip() for link in body.links if link.strip()]
    row.education = [entry.strip() for entry in body.education if entry.strip()]
    row.raw_profile_markdown = profile_markdown(row)
    await session.flush()
    return _resume_profile_out(row)


def _resume_profile_out(row: CandidateProfile | None) -> ResumeProfileOut:
    if row is None:
        return ResumeProfileOut()
    return ResumeProfileOut(
        full_name=row.full_name,
        headline=row.headline,
        email=row.email,
        phone=row.phone,
        location=row.location,
        links=row.links or [],
        education=row.education or [],
        summary=row.summary,
        mode=generation_mode(row),
        configured=bool(row.raw_profile_markdown),
    )
