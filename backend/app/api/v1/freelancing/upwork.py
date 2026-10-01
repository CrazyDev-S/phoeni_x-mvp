"""The Upwork connection: API key pair, the OAuth round trip, and its status.

The secret is write-only, like an LLM key: reads return a mask. The callback
is the one unauthenticated endpoint in the category, because it is reached by
a browser redirect from upwork.com that carries no bearer token; the signed
``state`` names the user instead.
"""

from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, Query, status
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.core.deps import CurrentUser, Session
from app.freelancing.services import connection
from app.freelancing.upwork import oauth
from app.freelancing.upwork.errors import UpworkError, UpworkNotConfiguredError
from app.models.enums import UpworkConnectionStatus
from app.schemas.freelancing import (
    UpworkAuthorizeOut,
    UpworkConnectionOut,
    UpworkCredentialsIn,
    UpworkTenantIn,
    UpworkTestOut,
)

router = APIRouter(prefix="/upwork", tags=["freelancing: upwork"])


@router.get("/connection", response_model=UpworkConnectionOut)
async def read_connection(user: CurrentUser, session: Session) -> UpworkConnectionOut:
    return connection.describe(await connection.get_connection(session, user.id))


@router.put("/credentials", response_model=UpworkConnectionOut)
async def put_credentials(
    body: UpworkCredentialsIn, user: CurrentUser, session: Session
) -> UpworkConnectionOut:
    row = await connection.store_credentials(
        session, user.id, client_id=body.client_id, client_secret=body.client_secret
    )
    return connection.describe(row)


@router.delete("/credentials", response_model=UpworkConnectionOut)
async def delete_credentials(user: CurrentUser, session: Session) -> UpworkConnectionOut:
    return connection.describe(await connection.clear_credentials(session, user.id))


@router.post("/authorize", response_model=UpworkAuthorizeOut)
async def authorize(user: CurrentUser, session: Session) -> UpworkAuthorizeOut:
    """The URL to send the browser to. The state carries the user for the way back."""
    row = await connection.get_connection(session, user.id)
    credentials = connection.resolve_credentials(row)
    if credentials is None:
        raise UpworkNotConfiguredError()
    if row.status is UpworkConnectionStatus.NOT_CONFIGURED:
        row.status = UpworkConnectionStatus.PENDING_AUTHORIZATION
    return UpworkAuthorizeOut(
        url=oauth.authorization_url(
            client_id=credentials.client_id,
            redirect_uri=get_settings().upwork_callback_url,
            state=oauth.make_state(user.id),
        )
    )


@router.get("/callback", include_in_schema=False)
async def callback(
    session: Session,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
) -> RedirectResponse:
    """Where Upwork sends the browser back. Always ends at the portal's Settings."""
    settings = get_settings()
    portal = f"{settings.portal_url.rstrip('/')}/settings"

    def back(**params: str) -> RedirectResponse:
        return RedirectResponse(
            f"{portal}?{urlencode({'tab': 'integrations', **params})}",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    if error or not code or not state:
        return back(upwork="error", reason=error_description or error or "Upwork sent no code")

    try:
        user_id = oauth.read_state(state)
    except UpworkError as exc:
        return back(upwork="error", reason=exc.message)

    row = await connection.get_connection(session, user_id)
    credentials = connection.resolve_credentials(row)
    if credentials is None:
        return back(upwork="error", reason="No Upwork API key pair is configured")

    try:
        pair = await oauth.exchange_code(
            client_id=credentials.client_id,
            client_secret=credentials.client_secret,
            code=code,
            redirect_uri=settings.upwork_callback_url,
        )
    except UpworkError as exc:
        row.status = UpworkConnectionStatus.ERROR
        row.last_error = exc.message
        return back(upwork="error", reason=exc.message)

    await connection.store_tokens(session, row, pair)

    # Who this is, for the Settings card. Not fatal: the tokens are stored.
    try:
        client = await connection.client_for(session, user_id)
        viewer, organizations = await connection.fetch_viewer(client)
        row.upwork_user_id = str(viewer.get("id") or viewer.get("nid") or "") or None
        row.upwork_user_name = viewer.get("name") or None
        if row.tenant_id is None and len(organizations) == 1:
            row.tenant_id = organizations[0].organization_id
    except UpworkError as exc:
        row.last_error = f"Connected, but the first call failed: {exc.message}"

    return back(upwork="connected")


@router.post("/disconnect", response_model=UpworkConnectionOut)
async def disconnect(user: CurrentUser, session: Session) -> UpworkConnectionOut:
    return connection.describe(await connection.disconnect(session, user.id))


@router.post("/test", response_model=UpworkTestOut)
async def test_connection(user: CurrentUser, session: Session) -> UpworkTestOut:
    """One real call, recorded on the connection so the UI can show the outcome."""
    row = await connection.get_connection(session, user.id)
    try:
        client = await connection.client_for(session, user.id)
        viewer, organizations = await connection.fetch_viewer(client)
    except UpworkError as exc:
        row.last_error = exc.message
        return UpworkTestOut(ok=False, detail=exc.message)
    row.upwork_user_id = str(viewer.get("id") or viewer.get("nid") or "") or None
    row.upwork_user_name = viewer.get("name") or None
    row.last_error = None
    name = row.upwork_user_name or viewer.get("email") or "your account"
    return UpworkTestOut(
        ok=True,
        detail=f"Connected as {name}",
        upwork_user_name=row.upwork_user_name,
        organizations=organizations,
    )


@router.put("/tenant", response_model=UpworkConnectionOut)
async def put_tenant(body: UpworkTenantIn, user: CurrentUser, session: Session) -> UpworkConnectionOut:
    row = await connection.get_connection(session, user.id)
    row.tenant_id = body.tenant_id or None
    await session.flush()
    return connection.describe(row)
