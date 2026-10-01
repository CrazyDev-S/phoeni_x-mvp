"""The Apify token behind the Apify job source.

Write-only, like an LLM key: reads return a mask. The actor it runs is set
for the deployment (``APIFY_UPWORK_ACTOR_ID``) and shown here read-only.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, Session
from app.freelancing.services import apify_connection
from app.schemas.freelancing import ApifyConnectionOut, ApifyTestOut, ApifyTokenIn

router = APIRouter(prefix="/apify", tags=["freelancing: apify"])


@router.get("/connection", response_model=ApifyConnectionOut)
async def read_connection(user: CurrentUser, session: Session) -> ApifyConnectionOut:
    return apify_connection.describe(await apify_connection.get_connection(session, user.id))


@router.put("/token", response_model=ApifyConnectionOut)
async def put_token(body: ApifyTokenIn, user: CurrentUser, session: Session) -> ApifyConnectionOut:
    row = await apify_connection.store_token(session, user.id, body.token)
    return apify_connection.describe(row)


@router.delete("/token", response_model=ApifyConnectionOut)
async def delete_token(user: CurrentUser, session: Session) -> ApifyConnectionOut:
    return apify_connection.describe(await apify_connection.clear_token(session, user.id))


@router.post("/test", response_model=ApifyTestOut)
async def test_token(user: CurrentUser, session: Session) -> ApifyTestOut:
    """Who the token belongs to, and whether the actor answers. Costs nothing."""
    return await apify_connection.test(session, user.id)
