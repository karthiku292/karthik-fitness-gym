"""Shared pytest fixtures and the backend test harness.

Builds the Test_Application (the real FastAPI app from ``create_app()`` with the
``get_db`` dependency overridden, the rate limiter disabled, and every optional
integration credential zeroed) and the Test_Database (an isolated in-memory
SQLite engine created from the SQLAlchemy models' metadata, kept separate from
``backend/gym.db``). Exposes the client, seed, and per-role token fixtures
reused by every test module.

Covers Requirements 1.1-1.4, 2.1-2.4, 8.1-8.2 of the testing-ci-cd spec.
Design: Components and Interfaces section 1 (Test harness).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import all models BEFORE create_all so every table registers on Base.metadata.
import app.models  # noqa: F401  (registers all model tables on Base.metadata)
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db  # exact object app.core.deps binds via Depends(get_db)
from app.main import create_app
from app.models.enums import UserRole
from app.models.gym import Gym
from app.models.user import User

# --------------------------------------------------------------------------- #
# Test_Database — isolated in-memory SQLite, separate from backend/gym.db.
# A StaticPool keeps one shared connection so the in-memory database survives
# across the TestClient's threaded request handling (Req 1.2, 1.3).
# --------------------------------------------------------------------------- #
engine = create_engine(
    "sqlite://",                                 # in-memory, not backend/gym.db
    connect_args={"check_same_thread": False},   # FastAPI's threaded TestClient
    poolclass=StaticPool,                        # one shared connection per process
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.create_all(bind=engine)            # all model tables present (Req 1.2, 1.3)


def _override_get_db():
    """Yield a session bound to the test engine; close it in finally (Req 1.1)."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Seed credentials — module-level constants exported for reuse by test modules.
# Admins/trainers authenticate by email; members by phone.
# --------------------------------------------------------------------------- #
ADMIN_EMAIL, ADMIN_PASSWORD = "admin@test.local", "AdminPass123!"
TRAINER_EMAIL, TRAINER_PASSWORD = "trainer@test.local", "TrainerPass123!"
MEMBER_EMAIL = "member@test.local"               # User.email is NOT NULL + unique per gym
MEMBER_PHONE, MEMBER_PASSWORD = "9990001111", "MemberPass123!"


# --------------------------------------------------------------------------- #
# Test_Application + Test_Client
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def app():
    """Real app with get_db overridden, limiter disabled, integrations zeroed."""
    application = create_app()
    application.dependency_overrides[get_db] = _override_get_db   # Req 1.1
    application.state.limiter.enabled = False                     # Req 1.4 (never 429)
    # Force every optional integration off so the suite is offline & deterministic
    # regardless of the developer's backend/.env (Req 7.4, Req 8.1, 8.2).
    settings.OPENAI_API_KEY = ""
    settings.RAZORPAY_KEY_ID = ""
    settings.RAZORPAY_KEY_SECRET = ""
    settings.WHATSAPP_API_URL = ""
    settings.WHATSAPP_API_TOKEN = ""
    settings.SMTP_HOST = ""
    return application


@pytest.fixture(scope="session")
def client(app):
    """Test_Client bound to the Test_Application (Req 2.1)."""
    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------------- #
# Seed_Fixture — one gym tenant + one user per role (Req 2.2, 2.3).
# Inserted directly through the test session (not production seed.run(), which
# binds to the production engine), so the seed stays minimal and isolated.
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session", autouse=True)
def seed():
    """Insert one Gym and one User per role into the Test_Database."""
    db = TestingSessionLocal()
    try:
        gym = Gym(name="Test Gym", slug="test-gym")
        db.add(gym)
        db.flush()  # assign gym.id before referencing it on the users
        db.add_all(
            [
                User(
                    gym_id=gym.id, email=ADMIN_EMAIL, full_name="Admin",
                    role=UserRole.admin, is_active=True,
                    password_hash=hash_password(ADMIN_PASSWORD),
                ),
                User(
                    gym_id=gym.id, email=TRAINER_EMAIL, full_name="Trainer",
                    role=UserRole.trainer, is_active=True,
                    password_hash=hash_password(TRAINER_PASSWORD),
                ),
                User(
                    gym_id=gym.id, email=MEMBER_EMAIL, phone=MEMBER_PHONE,
                    full_name="Member", role=UserRole.member, is_active=True,
                    password_hash=hash_password(MEMBER_PASSWORD),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Auth_Token_Fixture — exactly one login per role per session (Req 2.4).
# --------------------------------------------------------------------------- #
def _login(client: TestClient, username: str, password: str) -> str:
    r = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},  # OAuth2 form fields
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(client, seed):
    return _login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def trainer_token(client, seed):
    return _login(client, TRAINER_EMAIL, TRAINER_PASSWORD)


@pytest.fixture(scope="session")
def member_token(client, seed):
    return _login(client, MEMBER_PHONE, MEMBER_PASSWORD)  # member authenticates by phone


@pytest.fixture
def auth():
    """Return a helper building the bearer Authorization header for a token."""
    return lambda token: {"Authorization": f"Bearer {token}"}
