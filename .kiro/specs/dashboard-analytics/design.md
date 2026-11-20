# Design Document

## Overview

This design turns the nine validated requirements for `dashboard-analytics` into a concrete plan: a read-only `reports` backend (one KPI summary endpoint plus four chart endpoints) and two wired frontend surfaces (the Dashboard's five business KPI cards and a new Reports page at `/app/reports`). It resolves every flagged assumption (A1–A9) into a committed decision and records the aggregation logic precisely enough to implement and test.

The backend mirrors the payments feature: a service module holds the aggregation logic, a schema module declares response shapes, and a router exposes admin-only endpoints under `/api/v1`. Every time-series is bucketed in Python following `revenue_summary` (`backend/app/services/payment.py:90`), so results are identical on SQLite (dev) and PostgreSQL (prod). No migration is introduced. The frontend adds a typed axios layer (`features/reports/api.ts`) in the style of `features/attendance/api.ts`, wires the Dashboard KPIs while preserving its no-fabricated-data behavior, and replaces the Reports placeholder with a Recharts page reusing the Payments page's dark chart tokens and the shared UI kit.

Implementation languages are **Python** (backend, FastAPI + SQLAlchemy 2.0) and **TypeScript/React** (frontend). These are the detected dominant languages; no pseudocode is used.

## Resolved Assumptions

| Ref | Decision |
| --- | --- |
| A1 | By-plan chart = **revenue per plan** (sum of `amount`), not member counts. |
| A2 | By-plan period = **Current_Month**, using the same timestamp bound as `revenue_summary.this_month`. |
| A3 | Paid payments with no linked plan are grouped under a single **"Unassigned"** entry. |
| A4 | Signup trend buckets members by **`joining_date`**. |
| A5 | All three trend endpoints return a **continuous, zero-filled** series (12 months / 30 days). |
| A6 | Read endpoints write **no** audit log (`log_action` stays for state changes only). |
| A7 | Four **separate** endpoints under the `reports` router; no reuse of `/payments/summary`. |
| A8 | `pending_payments` is a **count** (distinct from `revenue_summary.pending`, a sum). |
| A9 | Existing `/app/reports` route + sidebar entry host the page; no new nav. |

Open questions OQ1 (trainer read access) and OQ2 (custom date ranges) remain out of scope; endpoints are admin-only with fixed windows.

## Architecture

### Module layout

```
backend/app/
  schemas/report.py        # NEW  response schemas (DashboardSummary + 4 point types)
  services/report.py       # NEW  aggregation logic (pure over db + gym_id)
  api/v1/routers/reports.py# NEW  5 admin-only read endpoints, prefix /reports
  api/v1/router.py         # EDIT register reports.router at the `# reports` slot (line 32)

frontend/src/
  features/reports/api.ts  # NEW  typed axios layer + response interfaces
  lib/currency.ts          # NEW  shared `inr()` formatter (used by Dashboard + Reports)
  pages/Reports.tsx        # NEW  ReportsPage: 4 Recharts cards
  pages/Dashboard.tsx      # EDIT fetch summary, wire 5 KPI cards
  app/router.tsx           # EDIT replace <Placeholder/> at /app/reports with <ReportsPage/> (line 84)
```

### Request flow

```
Browser                         FastAPI                         SQLAlchemy / DB
  |  GET /api/v1/reports/summary   |                                |
  |  Authorization: Bearer <jwt>   |                                |
  |------------------------------->| Depends(get_current_user)      |
  |                                | Depends(require_admin) -> 401/403 if not admin
  |                                | report_svc.dashboard_summary(db, current_user.gym_id)
  |                                |------------------------------->| gym-scoped SELECTs
  |                                |<-------------------------------| rows
  |                                | bucket/aggregate in Python     |
  |  200 DashboardSummary (JSON)   |<--- response_model coercion ---|
  |<-------------------------------|                                |
```

The service layer takes `(db: Session, gym_id: int)` and returns plain `dict` / `list[dict]`, exactly like `revenue_summary`. Routers declare `response_model=` and let FastAPI validate and coerce. Services perform **no** commit, add, or delete.

## Components and Interfaces

The feature is five backend components and five frontend components. The subsections that follow (Endpoint Breakdown, Backend Schemas, Aggregation Logic, Frontend Design) give each component's full interface.

| Component | File | Responsibility | Depends on |
| --------- | ---- | -------------- | ---------- |
| Report schemas | `backend/app/schemas/report.py` (new) | Declare `DashboardSummary` + four point types | pydantic |
| Report service | `backend/app/services/report.py` (new) | Gym-scoped aggregation, Python bucketing | models, `payment.revenue_summary` |
| Reports router | `backend/app/api/v1/routers/reports.py` (new) | Five admin-only read endpoints under `/reports` | `report` service, `require_admin` |
| v1 aggregator | `backend/app/api/v1/router.py` (edit) | Register `reports.router` at `# reports` slot | reports router |
| Reports API layer | `frontend/src/features/reports/api.ts` (new) | Typed axios calls + response interfaces | `lib/api` |
| Currency helper | `frontend/src/lib/currency.ts` (new) | Shared `inr()` formatter | — |
| Dashboard page | `frontend/src/pages/Dashboard.tsx` (edit) | Wire five KPI cards from summary | reports API, currency |
| Reports page | `frontend/src/pages/Reports.tsx` (new) | Four Recharts cards with per-chart states | reports API, currency, UI kit, recharts |
| App router | `frontend/src/app/router.tsx` (edit) | Mount `ReportsPage` at `/app/reports` | Reports page |

## Endpoint Breakdown

All endpoints live on `router = APIRouter(prefix="/reports", tags=["reports"])`, carry `dependencies=[Depends(require_admin)]`, and read `current_user.gym_id` for scope. Lists are fixed-length series, not naturally paginated, so they return bare arrays (the convention `/attendance/member-search` already uses) rather than `Page[T]`.

| # | Method & path | Response model | Purpose | Requirements |
| - | ------------- | -------------- | ------- | ------------ |
| 1 | `GET /api/v1/reports/summary` | `DashboardSummary` | Five Dashboard KPIs | 1.1–1.8 |
| 2 | `GET /api/v1/reports/revenue-trend` | `list[MonthlyRevenuePoint]` | 12-month paid-revenue trend | 2.1–2.5 |
| 3 | `GET /api/v1/reports/signup-trend` | `list[MonthlySignupPoint]` | 12-month new-member trend | 3.1–3.5 |
| 4 | `GET /api/v1/reports/attendance-trend` | `list[DailyAttendancePoint]` | 30-day daily check-in trend | 4.1–4.5 |
| 5 | `GET /api/v1/reports/revenue-by-plan` | `list[PlanRevenuePoint]` | Current-month revenue by plan | 5.1–5.5 |

Path naming is consistent with existing hyphenated routes (`/attendance/member-search`, `/attendance/check-in`) and mirrors `/payments/summary` for the KPI endpoint.

## Data Models

All reads come from tables already defined; no column, index, or migration is added (Req 7.4, 7.5).

- `Member` (`models/member.py`): `gym_id`, `status` (`active`/`inactive`/`expired`), `joining_date: date`.
- `Payment` (`models/payment.py`): `gym_id`, `amount: Numeric`, `status` (`paid`/`pending`/`refunded`), `paid_at: datetime(tz)` (nullable), `membership_id: int|None` (FK `ondelete=SET NULL`).
- `Membership` (`models/membership.py`): `id`, `gym_id`, `plan_id` → `MembershipPlan`.
- `MembershipPlan` (`models/membership.py`): `id`, `gym_id`, `name`.
- `Attendance` (`models/attendance.py`): `gym_id`, `attendance_date: date`.

## Backend Schemas (`schemas/report.py`)

Each series names its own metric for self-documentation and an easy frontend mapping (a deliberate, small divergence from the payments `RevenuePoint{period,total,count}` generic shape).

```python
from pydantic import BaseModel


class DashboardSummary(BaseModel):
    total_members: int
    active_members: int
    expired: int
    monthly_revenue: float
    pending_payments: int
    # Note: attendance_today is intentionally absent (Req 1.6); the Dashboard
    # keeps sourcing that card from /attendance/today.


class MonthlyRevenuePoint(BaseModel):
    month: str      # "YYYY-MM"
    revenue: float


class MonthlySignupPoint(BaseModel):
    month: str      # "YYYY-MM"
    signups: int


class DailyAttendancePoint(BaseModel):
    date: str       # "YYYY-MM-DD"
    count: int


class PlanRevenuePoint(BaseModel):
    plan: str       # plan name, or "Unassigned"
    revenue: float
```

## Aggregation Logic (`services/report.py`)

All bucketing is performed in Python on fetched rows (Req 2.5, 3.5, 4.5, 5.5, 7.7). Shared date helpers mirror `revenue_summary` so the month boundary and `this_month` definition stay identical.

```python
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.attendance import Attendance
from app.models.member import Member
from app.models.membership import Membership, MembershipPlan
from app.models.enums import MemberStatus, PaymentStatus
from app.models.payment import Payment
from app.services.payment import revenue_summary


def _start(d: date) -> datetime:
    """Midnight UTC for a date — same helper revenue_summary uses."""
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _last_n_month_keys(today: date, n: int) -> list[str]:
    """n consecutive 'YYYY-MM' keys ending in today's month, oldest -> newest."""
    keys, y, m = [], today.year, today.month
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(keys))


def _last_n_day_keys(today: date, n: int) -> list[str]:
    """n consecutive 'YYYY-MM-DD' keys ending today, oldest -> newest."""
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]
```

### 1. `dashboard_summary(db, gym_id) -> dict` (Req 1)

```python
def dashboard_summary(db: Session, gym_id: int) -> dict:
    def _count(*where) -> int:
        return db.scalar(select(func.count()).select_from(Member).where(*where)) or 0

    total = _count(Member.gym_id == gym_id)
    active = _count(Member.gym_id == gym_id, Member.status == MemberStatus.active)
    expired = _count(Member.gym_id == gym_id, Member.status == MemberStatus.expired)

    pending_count = db.scalar(
        select(func.count()).select_from(Payment).where(
            Payment.gym_id == gym_id, Payment.status == PaymentStatus.pending
        )
    ) or 0

    monthly_revenue = revenue_summary(db, gym_id)["this_month"]  # Req 1.4 — reuse, don't duplicate

    return {
        "total_members": total,
        "active_members": active,
        "expired": expired,
        "monthly_revenue": float(monthly_revenue),
        "pending_payments": int(pending_count),
    }
```

- `monthly_revenue` is taken directly from `revenue_summary(...)["this_month"]` so the two can never drift (Req 1.4). The extra work `revenue_summary` does is acceptable for a once-per-dashboard-load call; correctness/consistency outweighs the micro-cost.
- `pending_payments` is `COUNT(*)` of pending payments — deliberately a count, not the monetary sum `revenue_summary.pending` (Req 1.5, A8).
- Empty gym yields zeros naturally via `func.count` + `coalesce` inside `revenue_summary` (Req 1.7, 1.8).

### 2. `revenue_trend(db, gym_id) -> list[dict]` (Req 2)

```python
def revenue_trend(db: Session, gym_id: int) -> list[dict]:
    keys = _last_n_month_keys(date.today(), 12)
    rows = db.execute(
        select(Payment.paid_at, Payment.amount).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at.is_not(None),
        )
    ).all()
    buckets: dict[str, float] = {}
    for paid_at, amount in rows:
        buckets[paid_at.strftime("%Y-%m")] = buckets.get(paid_at.strftime("%Y-%m"), 0.0) + float(amount or 0)
    return [{"month": k, "revenue": round(buckets.get(k, 0.0), 2)} for k in keys]
```

Zero-fill is intrinsic: the output iterates the 12 window keys and reads `buckets.get(k, 0.0)`, so empty months appear as `0` (Req 2.3) and payments older than the window fall outside `keys` and are excluded. Labels are `YYYY-MM`, ordered oldest→newest by construction (Req 2.4).

### 3. `signup_trend(db, gym_id) -> list[dict]` (Req 3)

```python
def signup_trend(db: Session, gym_id: int) -> list[dict]:
    keys = _last_n_month_keys(date.today(), 12)
    rows = db.execute(
        select(Member.joining_date).where(Member.gym_id == gym_id)
    ).all()
    buckets: dict[str, int] = {}
    for (joining_date,) in rows:
        if joining_date is None:
            continue
        key = joining_date.strftime("%Y-%m")
        buckets[key] = buckets.get(key, 0) + 1
    return [{"month": k, "signups": buckets.get(k, 0)} for k in keys]
```

Buckets by `joining_date` (A4), zero-filled across the 12 months (Req 3.3), labelled/ordered as Req 3.4.

### 4. `attendance_trend(db, gym_id) -> list[dict]` (Req 4)

```python
def attendance_trend(db: Session, gym_id: int) -> list[dict]:
    today = date.today()
    keys = _last_n_day_keys(today, 30)
    window_start = today - timedelta(days=29)
    rows = db.execute(
        select(Attendance.attendance_date).where(
            Attendance.gym_id == gym_id,
            Attendance.attendance_date >= window_start,   # value comparison, not a DB date function
        )
    ).all()
    buckets: dict[str, int] = {}
    for (att_date,) in rows:
        key = att_date.isoformat()
        buckets[key] = buckets.get(key, 0) + 1
    return [{"date": k, "count": buckets.get(k, 0)} for k in keys]
```

The `>= window_start` clause is a comparison against a Python-computed `date`, not a SQL date function, so parity holds (Req 4.5, 7.7). Counting and zero-fill are in Python (Req 4.2, 4.3); labels are `YYYY-MM-DD`, oldest→newest (Req 4.4).

### 5. `revenue_by_plan(db, gym_id) -> list[dict]` (Req 5)

```python
def revenue_by_plan(db: Session, gym_id: int) -> list[dict]:
    month_start = date.today().replace(day=1)
    payments = db.execute(
        select(Payment.amount, Payment.membership_id).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at >= _start(month_start),   # same bound as revenue_summary.this_month
        )
    ).all()
    if not payments:
        return []                                       # Req 5.4

    membership_to_plan = dict(
        db.execute(
            select(Membership.id, Membership.plan_id).where(Membership.gym_id == gym_id)
        ).all()
    )
    plan_name = dict(
        db.execute(
            select(MembershipPlan.id, MembershipPlan.name).where(MembershipPlan.gym_id == gym_id)
        ).all()
    )

    buckets: dict[str, float] = {}
    for amount, membership_id in payments:
        plan_id = membership_to_plan.get(membership_id) if membership_id is not None else None
        label = plan_name.get(plan_id, "Unassigned") if plan_id is not None else "Unassigned"
        buckets[label] = buckets.get(label, 0.0) + float(amount or 0)

    return sorted(
        ({"plan": k, "revenue": round(v, 2)} for k, v in buckets.items()),
        key=lambda e: (-e["revenue"], e["plan"]),
    )
```

- The current-month bound is the **same** `paid_at >= _start(month_start)` predicate `revenue_summary.this_month` uses (a value comparison, not a date function), which guarantees the entries sum to `monthly_revenue` (Req 5.1, A2) and keeps SQLite/Postgres parity (Req 5.5).
- A payment with `membership_id is None`, a membership outside the gym, or a plan that no longer exists resolves to `"Unassigned"` (Req 5.3, A3) — the `.get(..., "Unassigned")` defaults cover deleted/dangling references defensively.
- Output is sorted by revenue descending (ties by plan name) for a readable chart; requirements do not mandate an order, so this is a design choice.
- No current-month paid payments → `[]` (Req 5.4).

### Router (`api/v1/routers/reports.py`)

```python
from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, DbSession, require_admin
from app.schemas.report import (
    DailyAttendancePoint, DashboardSummary, MonthlyRevenuePoint,
    MonthlySignupPoint, PlanRevenuePoint,
)
from app.services import report as svc

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary", response_model=DashboardSummary, dependencies=[Depends(require_admin)])
def summary(db: DbSession, current_user: CurrentUser):
    return svc.dashboard_summary(db, current_user.gym_id)


@router.get("/revenue-trend", response_model=list[MonthlyRevenuePoint], dependencies=[Depends(require_admin)])
def revenue_trend(db: DbSession, current_user: CurrentUser):
    return svc.revenue_trend(db, current_user.gym_id)


@router.get("/signup-trend", response_model=list[MonthlySignupPoint], dependencies=[Depends(require_admin)])
def signup_trend(db: DbSession, current_user: CurrentUser):
    return svc.signup_trend(db, current_user.gym_id)


@router.get("/attendance-trend", response_model=list[DailyAttendancePoint], dependencies=[Depends(require_admin)])
def attendance_trend(db: DbSession, current_user: CurrentUser):
    return svc.attendance_trend(db, current_user.gym_id)


@router.get("/revenue-by-plan", response_model=list[PlanRevenuePoint], dependencies=[Depends(require_admin)])
def revenue_by_plan(db: DbSession, current_user: CurrentUser):
    return svc.revenue_by_plan(db, current_user.gym_id)
```

Registration in `api/v1/router.py`: add `reports` to the import tuple and `api_router.include_router(reports.router)`, replacing the `# reports` comment at the reserved slot (Req 7.1).

## Frontend Design

### API layer (`features/reports/api.ts`)

Plain typed axios functions, matching `features/attendance/api.ts` (the cited reference). React Query is available app-wide but no existing page uses its hooks; staying with the established `useState`/`useEffect` + typed-function pattern keeps the Dashboard and Reports consistent with Payments and avoids an inconsistent one-off.

```typescript
import { api } from "@/lib/api";

export interface DashboardSummary {
  total_members: number;
  active_members: number;
  expired: number;
  monthly_revenue: number;
  pending_payments: number;
}
export interface MonthlyRevenuePoint { month: string; revenue: number; }
export interface MonthlySignupPoint { month: string; signups: number; }
export interface DailyAttendancePoint { date: string; count: number; }
export interface PlanRevenuePoint { plan: string; revenue: number; }

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>("/reports/summary");
  return data;
}
export async function getRevenueTrend(): Promise<MonthlyRevenuePoint[]> {
  const { data } = await api.get<MonthlyRevenuePoint[]>("/reports/revenue-trend");
  return data;
}
export async function getSignupTrend(): Promise<MonthlySignupPoint[]> {
  const { data } = await api.get<MonthlySignupPoint[]>("/reports/signup-trend");
  return data;
}
export async function getAttendanceTrend(): Promise<DailyAttendancePoint[]> {
  const { data } = await api.get<DailyAttendancePoint[]>("/reports/attendance-trend");
  return data;
}
export async function getRevenueByPlan(): Promise<PlanRevenuePoint[]> {
  const { data } = await api.get<PlanRevenuePoint[]>("/reports/revenue-by-plan");
  return data;
}
```

### Shared currency helper (`lib/currency.ts`)

Payments defines `const inr = (n) => "₹" + Number(n).toLocaleString("en-IN")` locally. Dashboard and Reports both need the identical format (Req 8.3, 9.7), so extract one shared helper rather than copy the one-liner twice; Payments is left untouched (no unrequested refactor).

```typescript
export const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
```

### Dashboard wiring (`pages/Dashboard.tsx`)

Keep the existing `KPIS` array and the independent attendance fetch. Add a second, independent summary fetch so a summary failure cannot affect the attendance card (Req 8.5).

- State: `summary: DashboardSummary | null`, `summaryLoading: boolean`, plus the existing `attendanceToday: number | null`.
- Two separate effects (or two `try/catch` blocks in one effect): one calls `getDashboardSummary()`, the other `getAttendanceToday()`. Each swallows its own error.
- Value resolution per card key:
  - `attendance_today` → `attendanceToday` (live when not null).
  - `monthly_revenue` → `summary ? inr(summary.monthly_revenue) : "—"`.
  - all other business keys → `summary ? String(summary[key]) : "—"`.
- On summary failure, the five business cards keep the `"—"` placeholder with muted styling — no fabricated value, no crash (Req 8.4). While the request is in flight, cards show the same placeholder (or a `Skeleton`), never a number (Req 8.6).

```tsx
const liveValue = (key: string): string | number | null => {
  if (key === "attendance_today") return attendanceToday;            // existing source (Req 8.2)
  if (!summary) return null;                                         // placeholder (Req 8.4, 8.6)
  if (key === "monthly_revenue") return inr(summary.monthly_revenue);// INR (Req 8.3)
  return summary[key as keyof DashboardSummary] as number;
};
// render: const v = liveValue(key); const live = v !== null;
// <p className={live ? "" : "text-muted/40"}>{live ? v : "—"}</p>
```

### Reports page (`pages/Reports.tsx`)

Four chart cards, each fetching independently so one failure isolates to its own card (Req 9.2–9.6). A small internal hook plus a `ChartCard` wrapper remove repetition across the four charts.

```tsx
function useAsync<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetcher()
      .then(setData)
      .catch((e) => setError(apiErrorMessage(e, "Could not load chart")))
      .finally(() => setLoading(false));
  }, [fetcher]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}
```

`ChartCard` renders the shared states in priority order: `Skeleton` while `loading` (Req 9.4) → `ErrorState message onRetry={reload}` on `error` (Req 9.5) → `EmptyState` when the array is empty (Req 9.6) → otherwise the chart (via children/render-prop). All four cards use the Payments dark tokens:

- Grid `stroke="#2A2A2A"` with `vertical={false}`; axes `stroke="#9A9A9A"` `fontSize={12}`.
- Tooltip `contentStyle={{ background: "#151515", border: "1px solid #2A2A2A", borderRadius: 12, color: "#fff" }}`.
- Accent `#B794F6`; monetary axes/tooltips formatted with `inr` (Req 9.3, 9.7).

| Card | Recharts type | X / Y | Notes |
| ---- | ------------- | ----- | ----- |
| Monthly Revenue (12mo) | `LineChart` (line `#B794F6`) | X `month.slice(5)`, Y `₹{v/1000}k` | tooltip `inr` |
| New Signups (12mo) | `BarChart` (bar `#B794F6`, radius `[6,6,0,0]`) | X `month.slice(5)`, Y integer | counts |
| Daily Attendance (30d) | `LineChart`/`AreaChart` | X date (thin to ~every 5th tick), Y integer | counts |
| Revenue by Plan | `BarChart` (bar `#B794F6`) | X `plan`, Y `₹{v/1000}k` | tooltip `inr` |

Routing: in `app/router.tsx`, import `ReportsPage` from `@/pages/Reports` and replace `{ path: "reports", element: <Placeholder title="Reports & Analytics" phase="Phase 6" /> }` with `{ path: "reports", element: <ReportsPage /> }` (Req 9.1). The sidebar entry and `ProtectedRoute` are unchanged (A9); the backend already enforces admin-only, and the summary/chart fetches simply fail closed (403) for non-admins.

## Error Handling

| Surface | Condition | Behavior |
| ------- | --------- | -------- |
| Backend | non-admin | `require_admin` → HTTP 403, no body data (Req 6.3) |
| Backend | missing/invalid token | `get_current_user` → HTTP 401 (Req 6.4) |
| Backend | no data (empty gym / empty window) | zeros or `[]` — not an error (Req 1.7, 1.8, 2.3, 3.3, 4.3, 5.4) |
| Backend | dangling membership/plan reference | payment attributed to `"Unassigned"` (Req 5.3) |
| Frontend Dashboard | summary fetch fails | five cards stay `"—"`; attendance fetch proceeds; no crash (Req 8.4, 8.5) |
| Frontend Reports | a chart fetch fails | that card shows `ErrorState` + Retry; siblings unaffected (Req 9.5) |
| Frontend Reports | a chart returns `[]` | that card shows `EmptyState` (Req 9.6) |

Services contain no `try/except` beyond defensive `None` skips — reads cannot 404 (no path params) and have no write path to fail. Frontend messages route through the existing `apiErrorMessage` helper (`lib/api.ts`).

## Security and Tenancy

- **RBAC**: every one of the five routes carries `dependencies=[Depends(require_admin)]`, identical to `/payments/summary` (Req 6.2). `require_admin` raises 403 for non-admins (Req 6.3); `get_current_user` raises 401 for unauthenticated requests (Req 6.4).
- **Tenant scope**: every `SELECT` in `services/report.py` filters on `<Model>.gym_id == gym_id`, where `gym_id` comes only from `current_user.gym_id` (never from client input). No cross-gym row can enter any aggregate (Req 6.1, 6.5). The plan-name and membership lookups are themselves gym-scoped, so a payment can never be attributed to another gym's plan.
- **Read-only**: services issue no `db.add`, `db.commit`, `db.delete`, or `log_action`; the routers do not commit (Req 7.6, A6). Read fetches are not audited, keeping the audit log for state changes only.
- **No migration**: only existing tables/columns are queried; no Alembic revision is added (Req 7.4, 7.5).

## Testing Strategy

A dual approach: property-based tests for the input-varying aggregation logic, example/integration tests for wiring, auth, and UI. Property tests run against an in-memory SQLite session; because all bucketing is Python-side, these faithfully model PostgreSQL (Req 7.7).

**Backend — property tests** (pytest + Hypothesis). `hypothesis` is not yet in `backend/requirements.txt`; add it as a dev/test dependency. A composite strategy generates members, plans, memberships, payments, and attendance rows spread across ≥2 gyms, with randomized statuses, amounts, `paid_at`, `joining_date`, and `attendance_date` (including dates inside and outside each window). Each property seeds a fresh session, runs the service, and asserts the universal statement below. Minimum 100 iterations per property; each test is tagged `Feature: dashboard-analytics, Property N: <text>`.

**Backend — integration tests** (FastAPI `TestClient` over `httpx`): for each of the five endpoints, assert 200 for an admin, 403 for trainer/member, 401 without a token (Req 6.2–6.4), the `reports` routes resolve under `/api/v1` (Req 7.1), and a two-gym fixture shows no cross-gym leakage end-to-end. A shape test asserts `DashboardSummary` has no `attendance_today` field (Req 1.6).

**Backend — read-only check**: snapshot row counts of all five tables before/after invoking each service over seeded data; assert unchanged (Req 7.6).

**Frontend — component tests** (vitest + testing-library, mocking `features/reports/api.ts`):
- Dashboard: summary resolves → five KPI values render, `monthly_revenue` with ₹ (Req 8.1, 8.3); summary rejects → five cards show `"—"` and the attendance card still renders its value (Req 8.4, 8.5); summary pending → placeholder, no number (Req 8.6).
- Reports: four cards render on success (Req 9.2); one chart rejects → only that card shows `ErrorState`+Retry (Req 9.5); a chart resolves `[]` → `EmptyState` (Req 9.6); `/app/reports` renders `ReportsPage`, not `Placeholder` (Req 9.1).

Chart visual tokens and Recharts rendering are verified by shallow assertions, not property tests (UI rendering is not amenable to PBT).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Member KPI counts match the gym's membership

For any distribution of members across gyms and statuses, `dashboard_summary(db, gym_id)` returns `total_members`, `active_members`, and `expired` equal to the number of members whose `gym_id` matches the requested gym — overall, with `status == active`, and with `status == expired`, respectively — including zero when the gym has no members.

**Validates: Requirements 1.1, 1.2, 1.3, 1.7**

### Property 2: Monthly revenue equals the reference computation

For any set of payments, `dashboard_summary(db, gym_id)["monthly_revenue"]` equals `revenue_summary(db, gym_id)["this_month"]` for the same gym, including zero when the gym has no paid payments in the current month.

**Validates: Requirements 1.4, 1.8**

### Property 3: Pending payments is the pending count

For any set of payments, `dashboard_summary(db, gym_id)["pending_payments"]` equals the number of payments whose `gym_id` matches the requested gym and whose `status` is `pending`, including zero when none exist.

**Validates: Requirements 1.5, 1.8**

### Property 4: Trend series are continuous, ordered, and correctly labelled

For any data and any current date, the revenue trend and the signup trend each return exactly 12 points labelled `YYYY-MM` for the 12 consecutive calendar months ending with the current month, and the attendance trend returns exactly 30 points labelled `YYYY-MM-DD` for the 30 consecutive days ending with the current date; in every series the points are strictly increasing from oldest to newest with no gaps.

**Validates: Requirements 2.1, 2.4, 3.1, 3.4, 4.1, 4.4**

### Property 5: Revenue-trend values sum paid revenue per month

For any set of payments, each revenue-trend point's `revenue` equals the sum of `amount` over the gym's `paid` payments whose `paid_at` falls within that point's month, and equals zero for any month in the window with no such payments.

**Validates: Requirements 2.2, 2.3**

### Property 6: Signup-trend values count members per month by joining date

For any set of members, each signup-trend point's `signups` equals the count of the gym's members whose `joining_date` falls within that point's month, and equals zero for any month in the window with no such members.

**Validates: Requirements 3.2, 3.3**

### Property 7: Attendance-trend values count check-ins per day

For any set of attendance records, each attendance-trend point's `count` equals the number of the gym's attendance records whose `attendance_date` equals that point's day, and equals zero for any day in the window with no such records.

**Validates: Requirements 4.2, 4.3**

### Property 8: Plan breakdown conserves and attributes current-month revenue

For any set of paid payments in the current month, `revenue_by_plan` attributes each payment's `amount` to the entry named for the plan linked through its membership, or to a single `"Unassigned"` entry when no plan is linked; the sum of all entries' `revenue` equals the gym's `monthly_revenue`; and when the gym has no paid payments in the current month the breakdown is empty.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 9: Tenant isolation

For any data partitioned across multiple gyms, every analytics result for a given gym (summary KPIs and all four series) depends only on records whose `gym_id` matches that gym and is unchanged by the presence or absence of any other gym's members, memberships, plans, payments, or attendance records.

**Validates: Requirements 6.1, 6.5**

### Property 10: Analytics calls never mutate state

For any database state, invoking any analytics function (`dashboard_summary`, `revenue_trend`, `signup_trend`, `attendance_trend`, `revenue_by_plan`) leaves the number of members, memberships, membership plans, payments, and attendance records unchanged.

**Validates: Requirements 7.6**
