# Implementation Plan: Testing & CI/CD

## Overview

This plan builds the three deliverables from the design — a backend `pytest` suite, a GitHub Actions CI pipeline, and a contributor `docs/` set — on top of the existing Gym Management System without changing application behavior or deployment assets. The tests, CI config, and docs *are* the deliverable, so every task below is required (none optional) and "done" means a green local `pytest` run plus a CI workflow that gates on it.

Because this feature produces tests, configuration, and documentation rather than new application logic with universally quantified behavior, the design has no Correctness Properties section; there are therefore no property-based test sub-tasks. The test modules themselves are the executable specification of Requirements 3–8.

Build order follows the design's dependency chain: the shared harness (`conftest.py`) first, then the five test modules in parallel (separate files, all consuming the harness fixtures), then a local green-run gate, then the CI workflow, then the documentation set, and finally a full-suite verification. No new dependencies are needed — `pytest`, `pytest-asyncio`, and `httpx` are already pinned in `backend/requirements.txt`.

## Tasks

- [x] 1. Create the backend test harness
  - [x] 1.1 Build the Test_Application, Test_Database, and shared fixtures in `backend/tests/conftest.py`
    - Create the `backend/tests/` directory and `conftest.py`; do not add `tests/__init__.py` (rely on pytest's rootdir-based discovery when the suite runs from `backend/`).
    - Import `app.models` explicitly before `Base.metadata.create_all` so all model tables register on `Base.metadata`; build an in-memory engine with `create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)`, a `TestingSessionLocal` sessionmaker bound to it, and call `Base.metadata.create_all(bind=engine)` at import time (isolated from `backend/gym.db`, fresh tables per process).
    - Define `_override_get_db()` that yields a `TestingSessionLocal()` session and closes it in `finally`.
    - Session-scoped `app` fixture: call `create_app()`, register `application.dependency_overrides[get_db] = _override_get_db` (import `get_db` from `app.db.session` so the key matches what `app.core.deps` binds), set `application.state.limiter.enabled = False`, and zero the integration keys on `settings` (`OPENAI_API_KEY`; `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`; `WHATSAPP_API_URL`/`WHATSAPP_API_TOKEN`; `SMTP_HOST`).
    - Session-scoped `client` fixture: `with TestClient(app) as c: yield c`.
    - Session-scoped autouse `seed` fixture: insert one `Gym` and one `User` per role — admin (email login), trainer (email login), member (phone login) — with `hash_password`-ed passwords, committed through a `TestingSessionLocal()` session; expose the email/phone/password literals as module-level constants for reuse by test modules.
    - Session-scoped `admin_token` / `trainer_token` / `member_token` fixtures, each logging in exactly once via `POST /api/v1/auth/login` (OAuth2 form fields `username` + `password`) and returning `access_token`; plus a function-scoped `auth` fixture returning `lambda token: {"Authorization": f"Bearer {token}"}`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 8.1, 8.2 — Design: Components and Interfaces §1 (Test harness)_

- [x] 2. Write the backend test modules
  - [x] 2.1 Create `backend/tests/test_health.py`
    - `test_health_ok`: `GET /health` via the `client` fixture; assert status 200 and `body["status"] == "ok"`.
    - _Requirements: 3.1 — Design: Components and Interfaces §2 (`test_health.py`); Test Matrix_

  - [x] 2.2 Create `backend/tests/test_auth.py`
    - `test_login_success`: `POST /api/v1/auth/login` with the admin email/password form; assert status 200 and that both `access_token` and `refresh_token` are present in the body.
    - `test_login_wrong_password`: `POST /api/v1/auth/login` with the admin identifier and an incorrect password; assert status 401.
    - Reuse the admin credential constants exported from `conftest.py`.
    - _Requirements: 4.1, 4.2 — Design: Components and Interfaces §2 (`test_auth.py`); Test Matrix_

  - [x] 2.3 Create `backend/tests/test_rbac.py`
    - `test_protected_requires_auth`: `GET /api/v1/members` with no `Authorization` header; assert status 401.
    - `test_admin_only_rejects_member`: `GET /api/v1/members` with `auth(member_token)`; assert status 403.
    - _Requirements: 5.1, 5.2 — Design: Components and Interfaces §2 (`test_rbac.py`); Test Matrix_

  - [x] 2.4 Create `backend/tests/test_members.py`
    - `test_create_member`: `POST /api/v1/members` with `auth(admin_token)` and the minimal payload `{"name": "Alice Example"}`; assert status 201 and a truthy `member_code` in the body.
    - `test_list_members_includes_created`: create a member, then `GET /api/v1/members` with `auth(admin_token)`; assert status 200 and that the created member's `member_code` appears in the paginated `items`. Each test creates the record it asserts on so the pair is order-independent against the session-shared database.
    - _Requirements: 6.1, 6.2 — Design: Components and Interfaces §2 (`test_members.py`); Test Matrix_

  - [x] 2.5 Create `backend/tests/test_smoke_endpoints.py`
    - `test_attendance_today`: `GET /api/v1/attendance/today` with `auth(trainer_token)` (staff-authorized, non-admin); assert status 200 and `"attendance_today"` present in the body.
    - `test_reports_summary`: `GET /api/v1/reports/summary` with `auth(admin_token)`; assert status 200 and a dashboard summary field (`"total_members"`) present.
    - `test_notifications_templates`: `GET /api/v1/notifications/templates` with `auth(admin_token)`; assert status 200 and that the body is a JSON list (empty list is valid for the minimal seed).
    - `test_assistant_ask`: `POST /api/v1/assistant/ask` with `auth(admin_token)` and `{"question": "..."}`; assert status 200, a non-empty `answer` string, `ai_configured` equal to `False`, and `source` equal to `"local"` (relies on the harness having zeroed `OPENAI_API_KEY`).
    - _Requirements: 7.1, 7.2, 7.3, 7.4 — Design: Components and Interfaces §2 (`test_smoke_endpoints.py`); Test Matrix_

- [x] 3. Verify the backend suite locally
  - [x] 3.1 Run the suite from `backend/` and fix failures until green
    - Run `pytest -q` with `backend/` as the working directory; confirm the full suite passes with no outbound network access and with integrations unconfigured.
    - If any test fails, correct the harness or the offending test module (not application behavior) and re-run until the suite is green.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2 — Design: Testing Strategy (Local backend verification)_

- [x] 4. Add the continuous integration pipeline
  - [x] 4.1 Create `.github/workflows/ci.yml` with the backend and frontend jobs
    - Workflow named `CI`, triggered on both `push` and `pull_request` with no branch filter.
    - `backend` job on `ubuntu-latest` with `defaults.run.working-directory: backend`: `actions/checkout@v4`; `actions/setup-python@v5` (Python `3.12`, `cache: pip`, `cache-dependency-path: backend/requirements.txt`); `pip install -r requirements.txt`; `pytest -q`.
    - `frontend` job on `ubuntu-latest` with `defaults.run.working-directory: frontend`: `actions/checkout@v4`; `actions/setup-node@v4` (Node `20`, `cache: npm`, `cache-dependency-path: frontend/package-lock.json`); `npm ci`; `npx tsc -b`; `npx vite build`.
    - Set no `continue-on-error` on any step so any non-zero exit fails its job and the overall run, and the run is green only when every step in both jobs passes.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 11.1, 11.2 — Design: Components and Interfaces §3 (CI workflow)_

- [x] 5. Write the contributor documentation set
  - [x] 5.1 Create `docs/README.md`
    - One-paragraph orientation plus an index linking to `development.md` and `usage.md`; point newcomers to the root `README.md` for the fast start.
    - _Requirements: 12.1 — Design: Components and Interfaces §4 (Documentation set)_

  - [x] 5.2 Create `docs/development.md`
    - Developer setup and run guide: reference the root `README.md` (local SQLite quickstart) and `DEPLOYMENT.md` (Docker/Postgres/Caddy production) for environment setup and deployment.
    - Document running the backend (`venv` → `pip install -r requirements.txt` → `alembic upgrade head` → `python -m app.db.seed` → `uvicorn app.main:app`), the frontend (`npm install` → `npm run dev`), and the tests (`cd backend` → `pytest`); link the `.github/workflows/ci.yml` workflow.
    - In the deployment section, reference the existing `Dockerfile`, `docker-compose.yml`, `deploy/` directory, and `render.yaml` by path only, without altering their content.
    - _Requirements: 12.1, 12.3 — Design: Components and Interfaces §4 (Documentation set)_

  - [x] 5.3 Create `docs/usage.md`
    - Role-based usage notes in three labeled sections — **Admin** (manage gym, members, plans, payments, attendance, reports, notifications, assistant), **Trainer** (staff-level attendance check-in and assigned-member views), and **Member** (portal: profile, QR code, membership status).
    - _Requirements: 12.2 — Design: Components and Interfaces §4 (Documentation set)_

- [x] 6. Final verification
  - [x] 6.1 Re-run the full backend suite and confirm it is green
    - After the CI workflow and docs are in place, run `pytest -q` from `backend/` once more to confirm no regression; verify the run completes offline and with no Razorpay / WhatsApp / SMTP / AI credentials present. Ensure all tests pass; ask the user if questions arise.
    - _Requirements: 8.1, 8.2, 11.1, 11.2 — Design: Testing Strategy; Error Handling_

## Notes

- No tasks are marked optional (`*`): the passing suite, the CI gate, and the docs are the deliverables, so each task is required.
- There are no property-based test sub-tasks — the design has no Correctness Properties section because this feature *is* tests, configuration, and documentation. The example/integration tests are the executable specification of Requirements 3–8.
- Each task references the specific requirement clauses and the design section it implements for traceability.
- Verification tasks (3.1 and 6.1) run the automated suite only; they do not modify application behavior or any existing deployment asset.
- No new dependencies are introduced; `pytest`, `pytest-asyncio`, and `httpx` are already pinned in `backend/requirements.txt`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1"] }
  ]
}
```
