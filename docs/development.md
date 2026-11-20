# Development guide

How to set up, run, and test the Gym Management System locally. This guide covers the
day-to-day developer workflow; it does **not** repeat the material already in other docs:

- The root [`README.md`](../README.md) has the fastest local start (SQLite, no Docker),
  the project structure, and the roadmap.
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) covers production deployment (Docker + PostgreSQL +
  Caddy/HTTPS on a Linux VM).
- [`usage.md`](./usage.md) describes what each role (admin, trainer, member) can do.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| Python | 3.12 | Backend runtime and the test suite (matches CI and the Docker image) |
| Node.js + npm | 20+ | Frontend dev server and production build |
| Git | any recent | Cloning and version control |
| Docker + Compose | optional | Production-style run and deployment (see [`DEPLOYMENT.md`](../DEPLOYMENT.md)) |

The repository is split into `backend/` (FastAPI app, SQLAlchemy models, Alembic
migrations) and `frontend/` (React + TypeScript SPA). Run each in its own terminal.

## Backend

Run every backend command from the `backend/` directory.

```bash
cd backend

# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate            # macOS / Linux
# .venv\Scripts\Activate.ps1         # Windows PowerShell

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your env file (first time only)
cp .env.example .env

# 4. Create the database schema, then seed the first gym + admin
alembic upgrade head
python -m app.db.seed

# 5. Start the API with auto-reload
uvicorn app.main:app --reload
```

Once it is running:

- **API base / app:** <http://localhost:8000>
- **Interactive API docs (Swagger UI):** <http://localhost:8000/docs>
- **Health check:** <http://localhost:8000/health> → `{"status": "ok", ...}`
- **Admin login:** `admin@example.com` / `ChangeMe123!` — these come from
  `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `backend/.env` (used by the
  seed script). Change them before exposing the app to anyone.

### SQLite by default

For local development the backend runs against a self-contained SQLite file
(`backend/gym.db`), so no database server is needed. The repo's local `backend/.env` is
already set to `DATABASE_URL=sqlite:///./gym.db`. If you start from a clean checkout
(`.env` is git-ignored), set that line yourself after copying the template:

```ini
# backend/.env
DATABASE_URL=sqlite:///./gym.db
```

`backend/.env.example` ships a PostgreSQL URL for production-style setups;
`sqlite:///./gym.db` is the no-server option the root README's fast start uses. The
SQLite file is created by `alembic upgrade head`. See `backend/.env.example` for the full
list of settings (security, CORS, and the optional Razorpay / WhatsApp / SMTP / AI
integrations, which stay disabled while their keys are blank).

> **Windows PowerShell:** if activating the venv is awkward, you can skip activation and
> call the interpreter directly, e.g. `.venv\Scripts\python.exe -m uvicorn app.main:app`.
> The root [`README.md`](../README.md) shows this no-activation form.

## Frontend

Run every frontend command from the `frontend/` directory.

```bash
cd frontend
npm install
npm run dev
```

- **Dev server:** <http://localhost:5173> — Vite proxies `/api` requests to the backend
  on port 8000, so run the backend alongside it.

Production build:

```bash
npm run build        # runs `tsc -b && vite build`, output in frontend/dist
```

> **Windows PowerShell:** if `npm` is blocked by the execution policy, use `npm.cmd` or
> run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (see the root README).

## Tests

The backend test suite uses `pytest` against an isolated in-memory SQLite database, so it
needs no network access and no integration credentials. Run it from `backend/`:

```bash
cd backend
pytest               # or: pytest -q   (the form CI uses)
```

The test dependencies (`pytest`, `pytest-asyncio`, `httpx`) are already pinned in
`backend/requirements.txt`, so the venv set up above is all you need. Tests live in
`backend/tests/` (shared fixtures in `conftest.py`) and cover the health endpoint, auth
login, role-based access control, member create/list, and a smoke test per recent feature
(attendance, reports, notifications, assistant).

## Single-URL mode

In production the backend can serve the built frontend from the **same origin** as the
API, giving one clickable link instead of two servers. This is controlled by the
`STATIC_DIR` setting: when it points at a built `frontend/dist`, `app/main.py` serves the
SPA's `index.html` for any path that isn't the API, `/docs`, or `/health`. It is empty in
local dev (Vite serves the frontend), so this mode is opt-in.

To try it locally:

```bash
# 1. Build the frontend
cd frontend && npm run build          # produces frontend/dist

# 2. Point the backend at that build and run it (from backend/)
cd ../backend
STATIC_DIR=../frontend/dist uvicorn app.main:app
# Windows PowerShell:
#   $env:STATIC_DIR = "../frontend/dist"; uvicorn app.main:app
```

The whole app — SPA, API, `/docs`, and `/health` — is then served from
<http://localhost:8000>. The `Dockerfile` does this automatically: it builds the frontend,
copies `dist` into the image, and sets `STATIC_DIR=/app/static`.

## Continuous integration

Every push and pull request runs the CI pipeline defined in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It has two jobs:

- **Backend tests** — sets up Python 3.12, runs `pip install -r requirements.txt`, then
  `pytest -q` in `backend/`.
- **Frontend build** — sets up Node 20, runs `npm ci`, then `npx tsc -b` and
  `npx vite build` in `frontend/`.

The run passes only when both jobs succeed. Reproduce it locally before pushing with
`pytest` (from `backend/`) and `npm run build` (from `frontend/`).

## Deployment

Deployment assets are documented in [`DEPLOYMENT.md`](../DEPLOYMENT.md) and are **not**
duplicated here. For reference, the relevant files are:

| Path | Purpose |
|------|---------|
| [`Dockerfile`](../Dockerfile) | Single-image build: compiles the frontend, then runs the backend serving both the API and the built site (single-URL mode via `STATIC_DIR`). |
| [`docker-compose.yml`](../docker-compose.yml) | Local multi-service Compose setup. |
| [`deploy/`](../deploy) | Production Compose files (`docker-compose.prod.yml`, `docker-compose.ip.yml`), the `Caddyfile` for automatic HTTPS, and env templates (`.env.prod.example`, `.env.ip.example`). |
| [`render.yaml`](../render.yaml) | Render blueprint: managed PostgreSQL plus the Dockerized web service, deployed on git push. |

Follow [`DEPLOYMENT.md`](../DEPLOYMENT.md) for the step-by-step production setup; treat the
files above as the assets it references rather than editing them from this guide.

## See also

- [`docs/README.md`](./README.md) — documentation index
- [`docs/usage.md`](./usage.md) — role-based usage notes
- [`README.md`](../README.md) — project overview and fast start
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — production deployment
