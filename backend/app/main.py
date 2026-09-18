"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db.session import engine
from app.worker.runner import run_workers

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run the generation worker in-process by default.

    One process, no extra infrastructure. Set WORKER_IN_PROCESS=false and run
    ``python -m app.worker.runner`` when you want it on its own box.
    """
    stop = asyncio.Event()
    task = None
    if settings.worker_in_process:
        task = asyncio.create_task(run_workers(stop, settings.worker_concurrency))
    try:
        yield
    finally:
        stop.set()
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError, TimeoutError):
                await asyncio.wait_for(task, timeout=5)
        await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    # Both clients generate their TypeScript types from this document.
    openapi_url="/openapi.json",
)

# Extension fetches from a chrome-extension:// origin are exempt from CORS via
# host_permissions, but the Next.js portal is not - and proxies in front of the
# API can still reject an unusual Origin, so configure it explicitly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    # Bearer tokens, not cookies. Never pair credentials with a wildcard origin.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID"],
    max_age=600,
)

app.include_router(api_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "env": settings.app_env}
