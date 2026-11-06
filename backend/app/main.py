"""FastAPI application factory for the Gym Management System."""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.v1.router import api_router
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        docs_url="/docs",
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok", "app": settings.APP_NAME, "env": settings.ENVIRONMENT}

    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    # Serve the built React app from the same origin as the API (single-service
    # deploy). API, /docs and /health are registered above, so they take
    # precedence; everything else falls through to the SPA's index.html.
    if settings.STATIC_DIR:
        static_path = Path(settings.STATIC_DIR)
        if static_path.is_dir():
            index_file = static_path / "index.html"

            @app.get("/{full_path:path}", include_in_schema=False)
            async def serve_spa(full_path: str):
                candidate = static_path / full_path
                if full_path and candidate.is_file():
                    return FileResponse(candidate)
                return FileResponse(index_file)

    return app


app = create_app()
