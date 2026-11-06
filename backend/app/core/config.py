"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to backend/.env so it loads regardless of the process CWD
# (uvicorn, alembic, scripts, and Docker may each run from a different dir).
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    # Application
    APP_NAME: str = "Gym Management System"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    # Directory of the built frontend (dist). When set, FastAPI serves the
    # web app from the same origin as the API (used in the single-service
    # Docker/Render deploy). Empty in local dev (Vite serves the frontend).
    STATIC_DIR: str = ""

    # Security
    SECRET_KEY: str = "change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://gym:gym@localhost:5432/gym"

    # CORS — stored as a comma-separated string to avoid pydantic-settings'
    # JSON pre-parsing of complex (list) types from .env. Use `cors_origins`.
    CORS_ORIGINS: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        """Database URL normalized for SQLAlchemy.

        - Managed Postgres providers (Render, Heroku, etc.) hand out URLs with
          the ``postgres://`` or ``postgresql://`` scheme; pin them to the
          psycopg2 driver so SQLAlchemy connects correctly.
        - Relative SQLite paths are anchored to the backend dir so the same
          file is used regardless of the process working directory.
        """
        url = self.DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql+psycopg2://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        if url.startswith("sqlite") and ":///" in url:
            prefix, path = url.split(":///", 1)
            is_windows_abs = len(path) > 1 and path[1] == ":"
            if path and not path.startswith("/") and not is_windows_abs:
                abs_path = (_ENV_FILE.parent / path).resolve()
                return f"{prefix}:///{abs_path.as_posix()}"
        return url

    # Bootstrap
    BOOTSTRAP_GYM_NAME: str = "My Gym"
    BOOTSTRAP_ADMIN_EMAIL: str = "admin@example.com"
    BOOTSTRAP_ADMIN_PASSWORD: str = "ChangeMe123!"

    # Integrations (optional)
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    WHATSAPP_API_URL: str = ""
    WHATSAPP_API_TOKEN: str = ""
    WHATSAPP_PHONE_ID: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    OPENAI_API_KEY: str = ""
    AI_MODEL: str = "gpt-4o-mini"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
