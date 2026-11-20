# Design Document

## Overview

This feature adds three thin, non-invasive layers on top of the existing Gym Management System: a backend `pytest` suite, a GitHub Actions CI pipeline, and a contributor `docs/` set. None of it changes application behavior or existing deployment assets. The guiding principle is isolation: tests run the real FastAPI app through an in-process client, but against a throwaway in-memory SQLite database and with every optional integration (Razorpay, WhatsApp, SMTP, AI) forced off, so the suite is deterministic, offline, and credential-free.

The implementation language is **Python** for the test suite (matching the backend), **YAML** for the CI workflow, and **Markdown** for the documentation set. The frontend is validated only through the CI build gate (`tsc -b` + `vite build`); no frontend unit tests are added.

The design reuses the app exactly as it ships:

- `app.main.create_app()` builds the FastAPI instance. (`backend/app/main.py`)
- `app.db.session.get_db` is the single DB-session dependency, referenced through `DbSession = Annotated[Session, Depends(get_db)]` in `app.core.deps`. Overriding `get_db` redirects every handler to the test database. (`backend/app/core/deps.py:16`)
- `app.db.base.Base.metadata` holds every table once `app.models` is imported (the package `__init__` imports all 19 models). (`backend/app/models/__init__.py`)
- Login is `POST /api/v1/auth/login` using an OAuth2 form (`username` + `password`); admins/trainers authenticate by email, members by phone. (`backend/app/api/v1/routers/auth.py:36`)
- The assistant answers from a deterministic local summary with `ai_configured=false` / `source="local"` whenever `OPENAI_API_KEY` is empty. (`backend/app/services/assistant.py`)

## Architecture

### Component breakdown

| Component | Location | Responsibility | Requirements |
|-----------|----------|----------------|--------------|
| Test harness (`conftest.py`) | `backend/tests/conftest.py` | Build the Test_Application, override `get_db` to an isolated SQLite engine, create tables, neutralize the limiter and all integration credentials, expose client / seed / per-role token fixtures | 1, 2, 8 |
| Health test | `backend/tests/test_health.py` | Assert `GET /health` returns 200 and `status == "ok"` | 3 |
| Auth test | `backend/tests/test_auth.py` | Assert login success (tokens present) and wrong-password 401 | 4 |
| RBAC test | `backend/tests/test_rbac.py` | Assert unauthenticated 401 and under-privileged 403 | 5 |
| Member test | `backend/tests/test_members.py` | Assert member create (201 + `member_code`) and list contains the created member | 6 |
| Smoke test | `backend/tests/test_smoke_endpoints.py` | One smoke each for attendance / reports / notifications / assistant | 7 |
| CI workflow | `.github/workflows/ci.yml` | Backend job (setup-python → pip install → pytest) and frontend job (setup-node → npm ci → tsc -b → vite build), gated on all steps passing | 9, 10, 11 |
| Documentation set | `docs/README.md`, `docs/development.md`, `docs/usage.md` | Developer setup/run/test guide + admin/trainer/member usage notes, referencing (not modifying) existing deploy assets | 12 |

### Directory layout (new files only)

```
backend/
  tests/
    conftest.py              # fixtures + Test_Application + Test_Database
    test_health.py
    test_auth.py
    test_rbac.py
    test_members.py
    test_smoke_endpoints.py
.github/
  workflows/
    ci.yml
docs/
  README.md                  # index / table of contents
  development.md             # setup, run backend/frontend/tests, deploy references
  usage.md                   # admin / trainer / member usage notes
```

No `__init__.py` is placed under `tests/`; pytest's default rootdir-based import and automatic `conftest.py` discovery handle collection when the suite is run from `backend/`. No extra pytest config file is required.

### Request flow through a test

```
TestClient.get("/api/v1/members", headers=Bearer admin_token)
        │  (in-process ASGI call, no sockets)
        ▼
create_app() FastAPI  ──►  dependency_overrides[get_db] = _override_get_db
        │                            │
        │                            ▼
        │                 TestingSessionLocal()  ──►  StaticPool SQLite (":memory:")
        ▼
require_admin → get_current_user → handler → JSON response → assertions
```

Because the production engine in `app.db.session` is created lazily (`create_engine` opens no connection until used) and `get_db` is overridden before any request runs, the real database (`backend/gym.db` or Postgres) is never touched.

## Components and Interfaces

### 1. Test harness — `backend/tests/conftest.py`

#### Test_Database construction (Requirements 1.2, 1.3)

An isolated in-memory SQLite engine is created at module import, using a `StaticPool` so every session shares one connection (required for an in-memory DB to persist across the TestClient's threaded request handling), with `check_same_thread=False`. Tables are created once from `Base.metadata`.

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers all tables on Base.metadata
from app.db.base import Base

engine = create_engine(
    "sqlite://",                               # in-memory, separate from backend/gym.db
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,                      # one shared connection for the whole session
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.create_all(bind=engine)          # all model tables present (Req 1.3)
```

`import app.models` is explicit (rather than relying on `create_app()` to import models transitively) so the metadata is guaranteed populated before `create_all`. A fresh OS process gets a fresh in-memory DB, so no data survives from a previous run (Req 1.3).

#### `get_db` override and app/client construction (Requirements 1.1, 2.1)

The override yields a session bound to the test engine and is registered on the app's `dependency_overrides`, keyed by the exact `get_db` object that `app.core.deps` references.

```python
from fastapi.testclient import TestClient
from app.db.session import get_db          # same object deps.py binds via Depends(get_db)
from app.main import create_app
from app.core.config import settings

def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(scope="session")
def app():
    application = create_app()
    application.dependency_overrides[get_db] = _override_get_db   # Req 1.1
    application.state.limiter.enabled = False                     # Req 1.4 — guarantee no 429
    # Force every optional integration off so the suite is offline & deterministic
    # regardless of the developer's backend/.env (Req 7.4, Req 8).
    settings.OPENAI_API_KEY = ""
    settings.RAZORPAY_KEY_ID = settings.RAZORPAY_KEY_SECRET = ""
    settings.WHATSAPP_API_URL = settings.WHATSAPP_API_TOKEN = ""
    settings.SMTP_HOST = ""
    return application

@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c
```

**Rate limiter neutralization (Req 1.4).** `create_app()` attaches a slowapi `Limiter` with a 200/minute default to `app.state.limiter`. The test app sets `application.state.limiter.enabled = False`, which short-circuits all limiting so no request can ever receive HTTP 429. This holds the guarantee even if a `SlowAPIMiddleware` or per-route `@limiter.limit` decorator is added later. The session-scoped login design (below) is a second safeguard: the whole suite issues only three logins plus a few dozen requests, far under any per-minute limit.

**Integration neutralization (Req 7.4, 8).** `settings` is a cached singleton; zeroing its integration keys in the `app` fixture forces `assistant.is_configured()` false (local path, no network) and keeps payment/WhatsApp/SMTP senders in their existing dry-run/local branches. This makes the assistant smoke's `ai_configured=false` / `source="local"` assertions deterministic even if a real key is present in `backend/.env`.

#### Seed fixture (Requirements 2.2, 2.3)

A session-scoped, autouse fixture inserts one gym and one user per role directly through the test session (not the production `seed.run()`, which binds to the production engine). Direct model inserts keep the seed minimal and independent of bootstrap settings.

```python
from app.core.security import hash_password
from app.models.gym import Gym
from app.models.user import User
from app.models.enums import UserRole

ADMIN_EMAIL, ADMIN_PASSWORD = "admin@test.local", "AdminPass123!"
TRAINER_EMAIL, TRAINER_PASSWORD = "trainer@test.local", "TrainerPass123!"
MEMBER_PHONE, MEMBER_PASSWORD = "9990001111", "MemberPass123!"

@pytest.fixture(scope="session", autouse=True)
def seed():
    db = TestingSessionLocal()
    try:
        gym = Gym(name="Test Gym", slug="test-gym")
        db.add(gym); db.flush()
        db.add_all([
            User(gym_id=gym.id, email=ADMIN_EMAIL, full_name="Admin",
                 role=UserRole.admin, is_active=True,
                 password_hash=hash_password(ADMIN_PASSWORD)),
            User(gym_id=gym.id, email=TRAINER_EMAIL, full_name="Trainer",
                 role=UserRole.trainer, is_active=True,
                 password_hash=hash_password(TRAINER_PASSWORD)),
            User(gym_id=gym.id, email="member@test.local", phone=MEMBER_PHONE,
                 full_name="Member", role=UserRole.member, is_active=True,
                 password_hash=hash_password(MEMBER_PASSWORD)),
        ])
        db.commit()
    finally:
        db.close()
```

The admin satisfies Req 2.2; the member (phone login) and trainer (email login) satisfy Req 2.3 — the member drives the RBAC 403 case and the trainer drives the staff-authorized attendance smoke.

#### Auth token fixtures (Requirement 2.4)

One session-scoped fixture per role, each performing a single login and caching the access token for the whole session.

```python
def _login(client, username, password):
    r = client.post("/api/v1/auth/login",
                    data={"username": username, "password": password})  # OAuth2 form
    assert r.status_code == 200, r.text
    return r.json()["access_token"]

@pytest.fixture(scope="session")
def admin_token(client, seed):   return _login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
@pytest.fixture(scope="session")
def trainer_token(client, seed): return _login(client, TRAINER_EMAIL, TRAINER_PASSWORD)
@pytest.fixture(scope="session")
def member_token(client, seed):  return _login(client, MEMBER_PHONE, MEMBER_PASSWORD)

@pytest.fixture
def auth():
    return lambda token: {"Authorization": f"Bearer {token}"}
```

Session scope means each role logs in at most once per run (Req 2.4). The `auth` helper builds the bearer header tests attach to requests.

### 2. Test modules

All tests are behavioral/integration-level, issued through the shared `client` with cached tokens. Representative content per module:

#### `test_health.py` (Requirement 3)

```python
def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

#### `test_auth.py` (Requirement 4)

```python
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD  # or import the literals locally

def test_login_success(client):
    r = client.post("/api/v1/auth/login",
                    data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"]      # Req 4.1

def test_login_wrong_password(client):
    r = client.post("/api/v1/auth/login",
                    data={"username": ADMIN_EMAIL, "password": "wrong-password"})
    assert r.status_code == 401                                 # Req 4.2
```

#### `test_rbac.py` (Requirement 5)

```python
def test_protected_requires_auth(client):
    r = client.get("/api/v1/members")                           # no Authorization header
    assert r.status_code == 401                                 # Req 5.1

def test_admin_only_rejects_member(client, auth, member_token):
    r = client.get("/api/v1/members", headers=auth(member_token))
    assert r.status_code == 403                                 # Req 5.2
```

`GET /api/v1/members` is gated by `require_admin`; `OAuth2PasswordBearer` raises 401 when the header is absent, and `require_roles` raises 403 for a member token.

#### `test_members.py` (Requirement 6)

```python
def test_create_member(client, auth, admin_token):
    r = client.post("/api/v1/members", headers=auth(admin_token),
                    json={"name": "Alice Example"})            # minimal valid payload
    assert r.status_code == 201
    assert r.json()["member_code"]                              # Req 6.1

def test_list_members_includes_created(client, auth, admin_token):
    created = client.post("/api/v1/members", headers=auth(admin_token),
                          json={"name": "Bob Example"}).json()
    r = client.get("/api/v1/members", headers=auth(admin_token))
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(i["member_code"] == created["member_code"] for i in items)  # Req 6.2
```

Each test creates the member it asserts on, so the pair is order-independent and tolerant of the session-shared database. `member_code` is auto-generated (`GM-000001`…), so only `name` is required in the payload.

#### `test_smoke_endpoints.py` (Requirement 7)

```python
def test_attendance_today(client, auth, trainer_token):         # staff-authorized (Req 7.1)
    r = client.get("/api/v1/attendance/today", headers=auth(trainer_token))
    assert r.status_code == 200
    assert "attendance_today" in r.json()

def test_reports_summary(client, auth, admin_token):            # Req 7.2
    r = client.get("/api/v1/reports/summary", headers=auth(admin_token))
    assert r.status_code == 200
    assert "total_members" in r.json()                          # dashboard summary body

def test_notifications_templates(client, auth, admin_token):    # Req 7.3
    r = client.get("/api/v1/notifications/templates", headers=auth(admin_token))
    assert r.status_code == 200
    assert isinstance(r.json(), list)                           # list body (may be empty)

def test_assistant_ask(client, auth, admin_token):              # Req 7.4
    r = client.post("/api/v1/assistant/ask", headers=auth(admin_token),
                    json={"question": "How many members do we have?"})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["answer"], str) and body["answer"]
    assert body["ai_configured"] is False
    assert body["source"] == "local"
```

The attendance smoke uses the trainer token to exercise `require_staff` for a non-admin role; the other three are admin-only. The assistant assertions rely on the harness having zeroed `OPENAI_API_KEY`, which routes `assistant.ask()` down the no-network local-summary path. The notifications list is asserted only to be a JSON list because the minimal seed creates no templates (an empty list is valid per Req 7.3).

### 3. CI workflow — `.github/workflows/ci.yml`

Two independent jobs run on every push and pull request. Each uses a job-level `working-directory` default so steps resolve paths inside `backend/` or `frontend/`. Dependency-cache paths are repo-relative (unaffected by `working-directory`).

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  backend:
    name: Backend tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run tests
        run: pytest -q

  frontend:
    name: Frontend build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Type-check
        run: npx tsc -b
      - name: Build
        run: npx vite build
```

- **Triggers (Req 9.1–9.3):** the file lives at `.github/workflows/ci.yml`; `on: [push, pull_request]` with no branch filter starts the pipeline for every pushed commit and every opened/updated pull request.
- **Backend job (Req 9.4):** `actions/setup-python` provisions Python 3.12 (compatible with the pinned deps), `pip install -r requirements.txt` runs with `working-directory: backend`, and `pytest -q` runs in `backend/`. `pytest`, `pytest-asyncio`, and `httpx` (the TestClient transport) are already in `requirements.txt`, so no extra install is needed.
- **Frontend job (Req 10.1–10.2):** `actions/setup-node` provisions Node 20 (satisfies Vite 6's Node ≥18 requirement) with npm caching keyed on `frontend/package-lock.json`; `npm ci` installs from the lockfile; `npx tsc -b` type-checks via the project references; `npx vite build` produces the production bundle. (`npm run build` runs the same `tsc -b && vite build`; the two steps are kept separate for clearer failure attribution.)
- **Result gating (Req 11):** no step sets `continue-on-error`, so any non-zero exit fails its step and job; GitHub marks the workflow run failed if either job fails (Req 11.1) and successful only when every step in both jobs passes (Req 11.2).

### 4. Documentation set — `docs/`

A minimal three-file set that fills the `docs/` folder the root `README.md` already references, without duplicating or altering existing deploy assets.

| File | Purpose | Requirements |
|------|---------|--------------|
| `docs/README.md` | Index / table of contents linking to the two guides; one-paragraph orientation that points newcomers at the root `README.md` for the fast start | 12.1 |
| `docs/development.md` | Developer setup and run guide: references root `README.md` (local SQLite quickstart) and `DEPLOYMENT.md` (Docker/Postgres/Caddy production) for environment setup and deployment; documents how to run the backend (`venv` → `pip install -r requirements.txt` → `alembic upgrade head` → `python -m app.db.seed` → `uvicorn app.main:app`), the frontend (`npm install` → `npm run dev`), and the tests (`cd backend` → `pytest`); links the CI workflow. Its deployment section references the existing `Dockerfile`, `docker-compose.yml`, `deploy/` directory, and `render.yaml` by path without changing them | 12.1, 12.3 |
| `docs/usage.md` | Role-based usage notes in three labeled sections — **Admin** (manage gym, members, plans, payments, attendance, reports, notifications, assistant), **Trainer** (staff-level attendance check-in and assigned-member views), **Member** (portal: profile, QR code, membership status) | 12.2 |

Deployment references are descriptive links only (e.g., "to deploy, see `DEPLOYMENT.md` and `deploy/docker-compose.prod.yml`"); the content of those assets is untouched (Req 12.3).

## Data Models

The suite introduces no persistent schema; it reuses the application's SQLAlchemy models. The only test-owned "data" is the seed set and the derived token/header values.

**Seeded records (one gym tenant + one user per role):**

| Entity | Key fields | Login identifier | Used by |
|--------|-----------|------------------|---------|
| `Gym` | `name="Test Gym"`, `slug="test-gym"` | — | tenant scope for all users/members |
| `User` admin | `email=admin@test.local`, `role=admin` | email | auth, members, reports, notifications, assistant tests |
| `User` trainer | `email=trainer@test.local`, `role=trainer` | email | attendance staff smoke |
| `User` member | `phone=9990001111`, `role=member` | phone | RBAC 403 test |

**Test-created record:** member-management tests create members through `POST /api/v1/members` with the minimal payload `{"name": <str>}`; the server assigns `member_code`, `joining_date` (today), and `status=active`.

**Derived values:** `admin_token` / `trainer_token` / `member_token` (session-cached JWT access tokens) and the `auth(token)` → `{"Authorization": "Bearer <token>"}` header map.

## Error Handling

- **Assertion failures → CI failure (Req 11).** A failed assertion makes `pytest` exit non-zero, which fails the backend job and therefore the workflow run. A frontend type error (`tsc -b`) or build error (`vite build`) exits non-zero and fails the frontend job the same way.
- **Offline guarantee (Req 8).** With all integration credentials zeroed in the harness, the assistant takes its local path (no `httpx` call) and payment/WhatsApp/SMTP code stays in its dry-run branches, so no test issues an outbound network request and the suite completes with no Razorpay/WhatsApp/SMTP/AI credential present.
- **Database isolation (Req 1).** The in-memory `sqlite://` engine is distinct from `backend/gym.db` and the production Postgres URL; the `get_db` override and lazy production engine ensure no real database connection is opened during tests. A fresh process yields fresh tables with no carried-over data.
- **No throttling (Req 1.4).** The limiter is disabled on the test app, so RBAC/auth assertions can never be masked by a 429.
- **Determinism / ordering.** State that spans the session (seed users, created members) is additive and never asserted by absolute count; each member test creates the exact record it checks, so tests pass regardless of collection order or repeated runs within a process.

## Testing Strategy

Because this feature *is* the test suite, CI configuration, and documentation, verification is the suite's own green run plus the CI build gate rather than a separate test layer.

**Local backend verification (primary):**

```bash
cd backend
pip install -r requirements.txt     # once; pytest/httpx already pinned
pytest -q                           # expect all tests passing, no network access
```

Run from `backend/` so that `app` is importable and `conftest.py` is auto-discovered. A green run confirms Requirements 1–8 end to end: the app starts (health), auth works both ways, RBAC rejects correctly, member create/list behave, and all four recent endpoints answer offline.

**Local frontend verification (mirrors the CI frontend job):**

```bash
cd frontend
npm ci
npx tsc -b
npx vite build
```

**CI verification (Req 9–11):** pushing a commit or opening a pull request triggers `ci.yml`; the run is green only when both jobs pass, and red if any `pytest`, `tsc -b`, or `vite build` step fails. This is the automated enforcement of the same two local checks above.

## Verification Approach

This feature produces tests, CI configuration, and documentation rather than new application logic with universally quantified behavior, so a formal Correctness Properties / property-based ("for all inputs…") section does not apply. The verification is the artifact set itself:

- The **example/integration tests** in `backend/tests/` are the executable specification of Requirements 3–8 — each test maps to a specific acceptance criterion (see the Test Matrix below) and is asserted through the real application via the in-process client.
- The **CI pipeline** (`.github/workflows/ci.yml`) is the automated gate for Requirements 9–11, asserting that the backend suite passes and the frontend builds on every push and pull request.
- The **documentation set** satisfies Requirement 12 by inspection against its acceptance criteria.

No property-based (Hypothesis) harness is wired up, consistent with the requirements' explicit non-goals.

## Test Matrix

| Test (file :: function) | Request | Assertion | Requirement |
|--------------------------|---------|-----------|-------------|
| `test_health.py :: test_health_ok` | `GET /health` | 200; `status == "ok"` | 3.1 |
| `test_auth.py :: test_login_success` | `POST /api/v1/auth/login` (admin creds) | 200; `access_token` and `refresh_token` present | 4.1 |
| `test_auth.py :: test_login_wrong_password` | `POST /api/v1/auth/login` (bad password) | 401 | 4.2 |
| `test_rbac.py :: test_protected_requires_auth` | `GET /api/v1/members` (no token) | 401 | 5.1 |
| `test_rbac.py :: test_admin_only_rejects_member` | `GET /api/v1/members` (member token) | 403 | 5.2 |
| `test_members.py :: test_create_member` | `POST /api/v1/members` (admin token) | 201; `member_code` present | 6.1 |
| `test_members.py :: test_list_members_includes_created` | `GET /api/v1/members` (admin token) | 200; `items` include created member | 6.2 |
| `test_smoke_endpoints.py :: test_attendance_today` | `GET /api/v1/attendance/today` (staff token) | 200; `attendance_today` present | 7.1 |
| `test_smoke_endpoints.py :: test_reports_summary` | `GET /api/v1/reports/summary` (admin token) | 200; dashboard summary body | 7.2 |
| `test_smoke_endpoints.py :: test_notifications_templates` | `GET /api/v1/notifications/templates` (admin token) | 200; JSON list body | 7.3 |
| `test_smoke_endpoints.py :: test_assistant_ask` | `POST /api/v1/assistant/ask` (admin token) | 200; `answer` string, `ai_configured == false`, `source == "local"` | 7.4 |
| Harness-wide (offline/no-credential execution) | entire suite | no outbound network; runs with integrations unconfigured | 8.1, 8.2 |
| `conftest.py` (harness) | fixtures | isolated DB via `get_db` override; tables from metadata; limiter disabled; shared client/seed/token fixtures | 1.1–1.4, 2.1–2.4 |
| `.github/workflows/ci.yml` | CI | triggers on push/PR; backend pytest job; frontend build job; fail/pass gating | 9, 10, 11 |
| `docs/` set | documentation | setup guide + role usage notes + unaltered deploy references | 12 |

## Notes

- The test suite requires no new dependencies — `pytest`, `pytest-asyncio`, and `httpx` are already pinned in `backend/requirements.txt`.
- Existing deployment assets (`Dockerfile`, `docker-compose.yml`, `deploy/`, `render.yaml`, `DEPLOYMENT.md`) are referenced by the docs but not modified, per Requirement 12.3.
- Session-scoped fixtures keep the suite fast and respect the request rate limit; tests are written to be order-independent so the shared in-memory database stays safe.
