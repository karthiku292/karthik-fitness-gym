# Documentation

The Gym Management System is a brand-neutral, multi-tenant platform for running one or
more gyms from a single deployment. The backend is a **FastAPI** (Python) service using
SQLAlchemy, Alembic migrations, JWT authentication, and role-based access control for
three roles — **admin**, **trainer**, and **member**. The frontend is a **React +
TypeScript** single-page app. Features (through Phase 8 of the roadmap) cover members,
membership plans and renewals, payments and receipts, QR-based attendance,
trainers with workout and diet plans, a dashboard with analytics, notifications
(WhatsApp/email), and an AI assistant.

## Start here

New to the project? The root [`README.md`](../README.md) has the fastest local start
(SQLite, no Docker or Postgres required) along with the project structure and roadmap.

## Guides

| Document | What it covers |
|----------|----------------|
| [`development.md`](./development.md) | Developer setup — run the backend, frontend, and test suite locally; links to the CI workflow and the deployment assets. |
| [`usage.md`](./usage.md) | Role-based usage notes for the **admin**, **trainer**, and **member** roles. |

## Deployment

Production deployment (Docker + PostgreSQL + Caddy for automatic HTTPS) is documented in
[`DEPLOYMENT.md`](../DEPLOYMENT.md) at the repository root. See `development.md` for a
summary and pointers to the underlying assets (`Dockerfile`, `docker-compose.yml`, the
`deploy/` directory, and `render.yaml`).
