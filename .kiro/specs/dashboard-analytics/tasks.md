# Implementation Plan: Dashboard Analytics

## Overview

This plan turns the `dashboard-analytics` design into incremental coding steps for the spec-task-execution sub-agent. It builds the read-only `reports` backend first (schemas → service → router → registration), verifies it at a checkpoint, then wires the two frontend surfaces (shared data layer → Dashboard KPIs → Reports page + route). Each sub-task names the requirement(s) and design section it implements and is independently verifiable.

Backend is **Python** (FastAPI + SQLAlchemy 2.0); frontend is **TypeScript/React**. All time-series bucketing is done in Python following `revenue_summary` (`backend/app/services/payment.py`), so results are identical on SQLite and PostgreSQL. No database migration is introduced (Req 7.5): every metric derives from existing tables.

Sub-tasks marked `*` are optional tests and can be skipped for a faster MVP; the core (unmarked) sub-tasks are the implementation. The design includes a Correctness Properties section, so the 10 properties become optional property-based test sub-tasks placed next to the code they validate.

## Tasks

- [ ] 1. Set up backend analytics test tooling
  - [ ]* 1.1 Add `hypothesis` as a test dependency
    - Append a pinned `hypothesis` entry to `backend/requirements.txt` (alongside the existing `pytest`/`pytest-asyncio` entries); it is not currently installed
    - _Design: Testing Strategy (Backend — property tests)_
    - _Requirements: 7.7_

  - [ ]* 1.2 Create the backend test harness `backend/tests/conftest.py`
    - Add an in-memory SQLite `Session` fixture (create all tables from `app.db.base.Base.metadata`) and a `TestClient` fixture overriding `get_db`
    - Add helpers/fixtures that seed at least two gyms and issue admin, trainer, and member access tokens for the auth-matrix integration tests
    - Add a Hypothesis `@st.composite` strategy generating members, plans, memberships, payments, and attendance rows across ≥2 gyms with randomized `status`, `amount`, `paid_at`, `joining_date`, and `attendance_date` (values inside and outside each window)
    - _Design: Testing Strategy (Backend — property tests / integration tests)_
    - _Requirements: 6.1, 6.5, 7.6, 7.7_

- [x] 2. Implement report response schemas
  - [x] 2.1 Create `backend/app/schemas/report.py`
    - Define `DashboardSummary` (`total_members`, `active_members`, `expired`, `monthly_revenue: float`, `pending_payments: int`; no `attendance_today` field), `MonthlyRevenuePoint{month, revenue}`, `MonthlySignupPoint{month, signups}`, `DailyAttendancePoint{date, count}`, and `PlanRevenuePoint{plan, revenue}` as pydantic `BaseModel`s, matching the payments schema style
    - _Design: Backend Schemas (`schemas/report.py`)_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 3.4, 4.4, 5.2, 5.3, 7.2_

  - [ ]* 2.2 Write a shape test for `DashboardSummary`
    - Assert the model's fields exactly match the five KPIs and that `attendance_today` is absent
    - _Design: Testing Strategy (Backend — integration tests, shape test)_
    - _Requirements: 1.6_

- [x] 3. Implement the KPI summary aggregation
  - [x] 3.1 Create `backend/app/services/report.py` with shared date helpers
    - Add `_start(d)`, `_last_n_month_keys(today, n)` (oldest→newest `YYYY-MM`), and `_last_n_day_keys(today, n)` (oldest→newest `YYYY-MM-DD`), mirroring `revenue_summary`'s month boundary; import models and `revenue_summary`
    - Services take `(db: Session, gym_id: int)`, return plain `dict`/`list[dict]`, and perform no `add`/`commit`/`delete`/`log_action`
    - _Design: Aggregation Logic (`services/report.py`) — shared helpers_
    - _Requirements: 2.5, 3.5, 4.5, 5.5, 7.6, 7.7_

  - [x] 3.2 Implement `dashboard_summary(db, gym_id)`
    - Gym-scoped counts for `total_members`, `active_members` (`MemberStatus.active`), `expired` (`MemberStatus.expired`), and `pending_payments` (count of `PaymentStatus.pending`); set `monthly_revenue` from `revenue_summary(db, gym_id)["this_month"]` (reuse, do not duplicate); empty gym yields zeros
    - _Design: Aggregation Logic — 1. `dashboard_summary`_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 6.1_

  - [ ]* 3.3 Property test — Property 1: Member KPI counts match the gym's membership
    - **Feature: dashboard-analytics, Property 1** — for any member distribution across gyms/statuses, `total_members`/`active_members`/`expired` equal the gym's matching counts (including zero); ≥100 iterations
    - _Validates: Requirements 1.1, 1.2, 1.3, 1.7_

  - [ ]* 3.4 Property test — Property 2: Monthly revenue equals the reference computation
    - **Feature: dashboard-analytics, Property 2** — for any payments, `dashboard_summary(...)["monthly_revenue"] == revenue_summary(...)["this_month"]` (including zero); ≥100 iterations
    - _Validates: Requirements 1.4, 1.8_

  - [ ]* 3.5 Property test — Property 3: Pending payments is the pending count
    - **Feature: dashboard-analytics, Property 3** — for any payments, `pending_payments` equals the count of the gym's `pending` payments (including zero); ≥100 iterations
    - _Validates: Requirements 1.5, 1.8_

- [x] 4. Implement the trend and breakdown aggregations
  - [x] 4.1 Implement `revenue_trend(db, gym_id)` in `services/report.py`
    - Fetch gym-scoped `paid` payments with non-null `paid_at`, bucket by `%Y-%m` in Python, emit one point per key from `_last_n_month_keys(today, 12)` with `revenue` rounded to 2dp; zero-fill empty months; oldest→newest
    - _Design: Aggregation Logic — 2. `revenue_trend`_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.2 Property test — Property 5: Revenue-trend values sum paid revenue per month
    - **Feature: dashboard-analytics, Property 5** — each point's `revenue` equals the sum of the gym's `paid` `amount` whose `paid_at` falls in that month, else zero; ≥100 iterations
    - _Validates: Requirements 2.2, 2.3_

  - [x] 4.3 Implement `signup_trend(db, gym_id)` in `services/report.py`
    - Fetch gym-scoped members' `joining_date`, bucket by `%Y-%m`, emit one point per key from `_last_n_month_keys(today, 12)` with `signups` count; zero-fill; oldest→newest
    - _Design: Aggregation Logic — 3. `signup_trend`_
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 4.4 Property test — Property 6: Signup-trend values count members per month by joining date
    - **Feature: dashboard-analytics, Property 6** — each point's `signups` equals the count of the gym's members whose `joining_date` falls in that month, else zero; ≥100 iterations
    - _Validates: Requirements 3.2, 3.3_

  - [x] 4.5 Implement `attendance_trend(db, gym_id)` in `services/report.py`
    - Compute `window_start = today - 29 days`; fetch gym-scoped attendance with `attendance_date >= window_start` (value comparison, not a SQL date function), bucket by ISO date, emit one point per key from `_last_n_day_keys(today, 30)` with `count`; zero-fill; oldest→newest
    - _Design: Aggregation Logic — 4. `attendance_trend`_
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 4.6 Property test — Property 7: Attendance-trend values count check-ins per day
    - **Feature: dashboard-analytics, Property 7** — each point's `count` equals the number of the gym's attendance records on that day, else zero; ≥100 iterations
    - _Validates: Requirements 4.2, 4.3_

  - [x] 4.7 Implement `revenue_by_plan(db, gym_id)` in `services/report.py`
    - Fetch gym-scoped `paid` payments with `paid_at >= _start(month_start)` (same bound as `revenue_summary.this_month`); return `[]` when none; build gym-scoped membership→plan_id and plan_id→name maps; attribute each amount to the plan name or to `"Unassigned"` (null membership, cross-gym/dangling references); sort by revenue desc then plan name; round to 2dp
    - _Design: Aggregation Logic — 5. `revenue_by_plan`_
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 4.8 Property test — Property 8: Plan breakdown conserves and attributes current-month revenue
    - **Feature: dashboard-analytics, Property 8** — amounts attribute to the linked plan name or a single `"Unassigned"` entry; the sum of entries equals `monthly_revenue`; empty when no current-month paid payments; ≥100 iterations
    - _Validates: Requirements 5.1, 5.2, 5.3, 5.4_

  - [ ]* 4.9 Property test — Property 4: Trend series are continuous, ordered, and correctly labelled
    - **Feature: dashboard-analytics, Property 4** — revenue and signup trends return exactly 12 `YYYY-MM` points, attendance returns exactly 30 `YYYY-MM-DD` points, each strictly increasing oldest→newest with no gaps, ending at the current month/day; ≥100 iterations
    - _Validates: Requirements 2.1, 2.4, 3.1, 3.4, 4.1, 4.4_

  - [ ]* 4.10 Property test — Property 9: Tenant isolation
    - **Feature: dashboard-analytics, Property 9** — for data across multiple gyms, each gym's summary and four series depend only on that gym's rows and are unchanged by other gyms' data; ≥100 iterations
    - _Validates: Requirements 6.1, 6.5_

  - [ ]* 4.11 Property test — Property 10: Analytics calls never mutate state
    - **Feature: dashboard-analytics, Property 10** — invoking any of the five service functions leaves member/membership/plan/payment/attendance row counts unchanged; ≥100 iterations
    - _Validates: Requirements 7.6_

- [x] 5. Expose and register the reports router
  - [x] 5.1 Create `backend/app/api/v1/routers/reports.py`
    - Define `router = APIRouter(prefix="/reports", tags=["reports"])` with five admin-only `GET` endpoints — `/summary`, `/revenue-trend`, `/signup-trend`, `/attendance-trend`, `/revenue-by-plan` — each `dependencies=[Depends(require_admin)]`, declaring its `response_model`, reading `current_user.gym_id`, delegating to the service, and performing no commit/audit
    - _Design: Endpoint Breakdown; Router (`api/v1/routers/reports.py`)_
    - _Requirements: 6.2, 6.3, 6.4, 7.2, 7.3, 7.6_

  - [x] 5.2 Register the reports router in `backend/app/api/v1/router.py`
    - Add `reports` to the routers import tuple and `api_router.include_router(reports.router)` at the reserved `# reports` slot so routes resolve under `/api/v1`; confirm no new Alembic revision is added (no migration)
    - _Design: Architecture — Module layout_
    - _Requirements: 7.1, 7.4, 7.5_

  - [ ]* 5.3 Integration test — auth matrix and routing for all five endpoints
    - Using `TestClient`, assert 200 for admin, 403 for trainer and member, and 401 without a token on each of the five endpoints, and that the routes resolve under `/api/v1`
    - _Design: Testing Strategy (Backend — integration tests)_
    - _Requirements: 6.2, 6.3, 6.4, 7.1_

  - [ ]* 5.4 Integration test — no cross-gym leakage end-to-end
    - With a two-gym fixture, assert each admin's summary and four series reflect only their own gym's data
    - _Design: Testing Strategy (Backend — integration tests)_
    - _Requirements: 6.5_

- [x] 6. Backend checkpoint
  - Ensure all backend tests pass and confirm no Alembic migration was added; ask the user if questions arise.

- [x] 7. Build the frontend data layer
  - [x] 7.1 Create `frontend/src/lib/currency.ts`
    - Export `inr(n: number)` returning `"₹" + Number(n).toLocaleString("en-IN")`, matching the Payments page format; leave `Payments.tsx` unchanged (no unrequested refactor)
    - _Design: Shared currency helper (`lib/currency.ts`)_
    - _Requirements: 8.3, 9.7_

  - [x] 7.2 Create `frontend/src/features/reports/api.ts`
    - Export response interfaces (`DashboardSummary`, `MonthlyRevenuePoint`, `MonthlySignupPoint`, `DailyAttendancePoint`, `PlanRevenuePoint`) and typed axios functions `getDashboardSummary`, `getRevenueTrend`, `getSignupTrend`, `getAttendanceTrend`, `getRevenueByPlan` hitting the `/reports/*` paths, in the `features/attendance/api.ts` style
    - _Design: API layer (`features/reports/api.ts`)_
    - _Requirements: 8.1, 9.2_

- [x] 8. Wire the Dashboard KPIs
  - [x] 8.1 Update `frontend/src/pages/Dashboard.tsx`
    - Add an independent `getDashboardSummary()` fetch (separate from the existing `getAttendanceToday()` fetch) with `summary`/`summaryLoading` state; resolve the five business KPI cards from `summary`, formatting `monthly_revenue` via `inr`, and keep the attendance card on `/attendance/today`
    - On summary failure or while in flight, keep the five business cards in the `"—"` placeholder (no fabricated value, no crash) and let the attendance fetch proceed independently
    - _Design: Dashboard wiring (`pages/Dashboard.tsx`)_
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 8.2 Component tests for the Dashboard (vitest + testing-library, mocking `features/reports/api.ts`)
    - Summary resolves → five KPI values render with `monthly_revenue` in ₹; summary rejects → five cards show `"—"` and the attendance card still renders its value; summary pending → placeholder with no number
    - _Design: Testing Strategy (Frontend — component tests)_
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_

- [x] 9. Build the Reports page and mount the route
  - [x] 9.1 Create `frontend/src/pages/Reports.tsx`
    - Add an internal `useAsync` hook and a `ChartCard` wrapper rendering, in priority order, `Skeleton` (loading), `ErrorState` with retry (error), `EmptyState` (empty array), else the chart; each of the four charts fetches independently so one failure isolates to its card
    - Render Monthly Revenue (LineChart), New Signups (BarChart), Daily Attendance (Line/AreaChart), and Revenue by Plan (BarChart) using the Payments dark tokens (grid `#2A2A2A`, axes `#9A9A9A`, tooltip bg `#151515`/border `#2A2A2A`/white text, accent `#B794F6`) and format monetary axes/tooltips with `inr`
    - _Design: Reports page (`pages/Reports.tsx`)_
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 9.2 Mount `ReportsPage` in `frontend/src/app/router.tsx`
    - Import `ReportsPage` from `@/pages/Reports` and replace the `{ path: "reports", element: <Placeholder ... /> }` entry with `{ path: "reports", element: <ReportsPage /> }`; leave the sidebar entry and `ProtectedRoute` unchanged
    - _Design: Reports page — Routing_
    - _Requirements: 9.1_

  - [ ]* 9.3 Component tests for the Reports page (vitest + testing-library, mocking `features/reports/api.ts`)
    - Four cards render on success; one chart rejects → only that card shows `ErrorState` + Retry; a chart resolves `[]` → `EmptyState`; `/app/reports` renders `ReportsPage`, not `Placeholder`
    - _Design: Testing Strategy (Frontend — component tests)_
    - _Requirements: 9.1, 9.2, 9.5, 9.6_

- [x] 10. Final checkpoint
  - Ensure all backend and frontend tests pass; ask the user if questions arise.

## Notes

- Sub-tasks marked `*` are optional tests and can be skipped for a faster MVP; unmarked sub-tasks are the implementation and must be built.
- Backend precedes dependent frontend: schemas → service → router → registration, verified at the backend checkpoint (task 6), then the shared data layer → Dashboard wiring → Reports page + route.
- Property tests require tasks 1.1 and 1.2 (hypothesis + harness); each runs ≥100 iterations and is tagged `Feature: dashboard-analytics, Property N: <text>` per the design.
- No database migration is introduced (Req 7.4, 7.5); services are read-only (no `add`/`commit`/`delete`/`log_action`, Req 7.6, A6).
- Property 10 (task 4.11) provides the read-only/no-mutation guarantee for Req 7.6, so a separate example-based read-only check is intentionally omitted to avoid redundancy.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "7.1", "7.2"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "8.1", "9.1"] },
    { "id": 2, "tasks": ["3.3", "3.4", "3.5", "4.1", "8.2", "9.2"] },
    { "id": 3, "tasks": ["4.2", "4.3", "9.3"] },
    { "id": 4, "tasks": ["4.4", "4.5"] },
    { "id": 5, "tasks": ["4.6", "4.7"] },
    { "id": 6, "tasks": ["4.8", "4.9", "4.10", "4.11", "5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["5.3", "5.4"] }
  ]
}
```
