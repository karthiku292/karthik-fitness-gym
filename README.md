# Gym Management System

A brand-neutral, multi-tenant, full-stack gym management platform.

- **Backend:** Python · FastAPI · SQLAlchemy · PostgreSQL · Alembic · JWT auth · RBAC
- **Frontend:** React · TypeScript · Tailwind CSS (dark theme) · React Router · React Query · Recharts

See the architecture & roadmap in the project plan artifact.

## Project structure

```
gym/
├── backend/     FastAPI app, models, routers, services, migrations
├── frontend/    React + TypeScript SPA
├── docs/        admin/trainer/member guides, handover
└── docker-compose.yml
```

## Fastest start — no Docker, no Postgres (SQLite)

For local development the backend defaults to a self-contained SQLite file
(`backend/gym.db`), so no database server is required.

```powershell
# Backend (from backend/)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
# backend/.env already sets DATABASE_URL=sqlite:///./gym.db
.venv\Scripts\python.exe -m alembic upgrade head   # create schema
.venv\Scripts\python.exe -m app.db.seed            # first gym + admin
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --app-dir .

# Frontend (from frontend/, separate terminal)
npm install
npm run dev
```

- Frontend: http://localhost:5173  (Vite proxies /api → backend:8000)
- API docs: http://localhost:8000/docs
- Login:    `admin@example.com` / `ChangeMe123!` (from `backend/.env`)

> On Windows PowerShell, if `npm` is blocked by the execution policy, use
> `npm.cmd` or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Production start (Docker + Postgres)

```bash
cp backend/.env.example backend/.env   # set SECRET_KEY, bootstrap admin, etc.
# set DATABASE_URL=postgresql+psycopg2://gym:gym@db:5432/gym
docker compose up --build
```

- API:      http://localhost:8000/docs
- Frontend: http://localhost:5173

## Local development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate         # Windows
pip install -r requirements.txt
cp .env.example .env
# with Postgres running and DATABASE_URL set:
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
python -m app.db.seed          # creates first gym + admin
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Roadmap

| Phase | Scope |
|-------|-------|
| 0 | Scaffold (done) |
| 1 | Auth & RBAC (done) |
| 2 | Members, plans, memberships, renewals |
| 3 | Payments & receipts |
| 4 | QR attendance |
| 5 | Trainers, workouts, diets |
| 6 | Dashboard & analytics |
| 7 | Notifications (WhatsApp/email) |
| 8 | AI assistant |
| 9 | Testing, Docker/AWS deploy, CI/CD, docs |

## Security notes

- Secrets live in environment variables, never in code or the frontend bundle.
- Card numbers / CVVs are never stored.
- All tenant data is scoped by `gym_id`; roles: admin, trainer, member.
```
