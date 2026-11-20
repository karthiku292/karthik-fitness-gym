# Design Document

## Overview

This design implements QR-based gym attendance on the existing data model. It adds one backend feature slice (an `attendance` router, an `attendance` service, and `attendance` schemas), extends the existing `/me` portal router with member-self QR endpoints, and builds three frontend surfaces (member-portal QR display, the staff Scanner page, and the staff Attendance History page) plus the dashboard's "Today's Attendance" KPI.

The feature is gym-scoped only (no branch linkage, no `branch_id`). It reuses the existing `attendance` and `qr_tokens` tables and the `uq_attendance_day` unique constraint, so **no database migration is required**.

Languages and stack follow the codebase: the backend is Python (FastAPI + SQLAlchemy 2.0 ORM + Pydantic v2); the frontend is TypeScript + React 18 (React Router, Zustand auth store, Axios client, Tailwind UI kit).

### Decisions resolved from requirements

The requirements deferred four decisions. They are resolved here:

1. **Endpoint paths** — a new `attendance` router under `/api/v1/attendance`, plus two `/me/qr` endpoints added to the existing portal router. Full table in [API Endpoints](#api-endpoints).
2. **Check-in response shape** — a `CheckInResult { created: bool, attendance: AttendanceRow }` envelope. `created` is the single, explicit signal for "newly recorded" vs "already checked in today," including the race-resolved case. See [Check-in response shape](#check-in-response-shape).
3. **Frontend libraries** — `qrcode.react` for QR rendering (member portal) and `@zxing/browser` + `@zxing/library` for camera scanning (Scanner page), the latter lazy-loaded and gated on a secure context. See [Frontend library choices](#frontend-library-choices).
4. **Staff member-lookup endpoint** — a new `GET /api/v1/attendance/member-search` gated by `require_staff`, so trainers (not only admins) can run the manual-fallback search without loosening the admin-only `/members` collection. See [Member lookup](#member-lookup-requirement-23).

## Architecture

```
Member Portal (React)            Staff app (React)
  MemberPortal.tsx                 Scanner.tsx   AttendanceHistory.tsx   Dashboard.tsx
  - QRCodeSVG(token)               - camera(HTTPS) / paste / search      - attendance_today KPI
        |                                   |                 |                  |
        | features/portal/api.ts            | features/attendance/api.ts         |
        v                                   v                 v                  v
  GET/POST /me/qr*                 POST /attendance/check-in   GET /attendance   GET /attendance/today
                                   GET  /attendance/member-search
        \__________________________________|_________________|__________________/
                                            v
                              FastAPI v1 router (/api/v1)
                        portal.router (/me)   attendance.router (/attendance)
                                            v
                              app/services/attendance.py
                 (QR get-or-create / regenerate / resolve, check-in w/ idempotency,
                                  history, today-count)  + app/services/audit.log_action
                                            v
                         SQLAlchemy ORM  ->  qr_tokens , attendance  (existing tables)
```

Every request carries a JWT; `get_current_user` resolves the `User`, and `user.gym_id` scopes all queries. Role gates (`require_staff`, `require_admin`) are applied per endpoint. The service layer is transport-agnostic and is shared by the portal (member-self) and attendance (staff) routers.

## Data Models

### Reused tables (unchanged)

Both tables already exist in `app/models/attendance.py` and carry every column this feature needs. No model edits, no migration.

`Attendance` (table `attendance`): `id`, `gym_id`, `member_id`, `check_in_at` (tz, server default `now()`), `attendance_date` (`date`, default `date.today`), `method` (`AttendanceMethod` enum: `qr`/`manual`), `verified_by` (nullable FK `users.id`), plus the `member` relationship. Unique constraint `uq_attendance_day (member_id, attendance_date)`.

`QRToken` (table `qr_tokens`): `id`, `gym_id`, `member_id`, `token` (`String(64)`, unique, indexed), `rotated_at` (nullable tz datetime).

**Migration safety (Requirement 13).** No column is added, so no migration file is created (13.1, 13.2). If a future change required a column, it would follow the project's inspect-guarded idempotent pattern from `backend/alembic/versions/20260102_0000_branches.py` (`Table.create(bind=..., checkfirst=True)` or an `inspect(...)` guard) so the migration is a no-op where the column already exists (13.3). This feature adds none.

## Components and Interfaces

The backend adds one service plus router/schema modules; the frontend adds one feature API module and the pages/cards that consume it. Backend components come first, then frontend.

### Schemas — `app/schemas/attendance.py`

```python
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field, model_validator
from app.models.enums import AttendanceMethod, MemberStatus


class QRTokenOut(BaseModel):
    member_id: int
    token: str
    rotated_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class CheckInRequest(BaseModel):
    """Exactly one identifier. token -> method=qr; member_id -> method=manual."""
    token: Optional[str] = Field(default=None, min_length=1, max_length=64)
    member_id: Optional[int] = None

    @model_validator(mode="after")
    def _exactly_one(self):
        if bool(self.token) == bool(self.member_id):
            raise ValueError("Provide exactly one of 'token' or 'member_id'.")
        return self


class AttendanceRow(BaseModel):
    """Shared projection for check-in results and history rows (Req 5.3)."""
    id: int
    member_id: int
    member_name: str
    member_code: str
    attendance_date: date
    check_in_at: datetime
    method: AttendanceMethod
    verified_by: Optional[int] = None


class CheckInResult(BaseModel):
    created: bool               # True = new row this request; False = already checked in today
    attendance: AttendanceRow


class MemberLookupOut(BaseModel):
    id: int
    name: str
    member_code: str
    phone: Optional[str] = None
    status: MemberStatus
    model_config = {"from_attributes": True}


class AttendanceTodayOut(BaseModel):
    attendance_today: int
```

The server derives `method` from which identifier was supplied; clients never send `method`, which prevents a manual check-in from being mislabeled as `qr`.

### Check-in response shape

`CheckInResult` is returned by `POST /attendance/check-in` and consumed by the Scanner page:

- `created = true` → a new row was written this request (Requirement 3.1); the Scanner shows "Checked in."
- `created = false` → a row for this member and date already existed (Requirement 3.2) **or** a concurrent insert won the race (Requirement 3.3); the Scanner shows "Already checked in today." Both cases return HTTP 200 with the single surviving row.
- `attendance` always carries the one authoritative row (`method`, `verified_by`, and the member's name/code for display), so the UI can show the member's identity in every success case (Requirement 10.4).

### Service — `app/services/attendance.py`

Mirrors the member/payment service style: pure functions taking `db` and `gym_id`, using `db.flush()` and leaving the final `db.commit()` to the router (Requirement 8.3).

```python
import secrets
from datetime import date
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.attendance import Attendance, QRToken
from app.models.enums import AttendanceMethod
from app.models.member import Member

TOKEN_BYTES = 48  # secrets.token_urlsafe(48) -> exactly 64 url-safe chars


def _new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def generate_unique_token(db: Session) -> str:
    """Opaque 64-char token, unique across qr_tokens (Req 1.1, 1.7)."""
    while True:
        tok = _new_token()
        if not db.scalar(select(QRToken.id).where(QRToken.token == tok)):
            return tok


def get_or_create_token(db: Session, gym_id: int, member_id: int) -> QRToken:
    """Fetch the member's token; create one if absent (Req 1.1-1.3)."""
    row = db.scalar(
        select(QRToken).where(
            QRToken.gym_id == gym_id, QRToken.member_id == member_id
        )
    )
    if row is None:
        row = QRToken(gym_id=gym_id, member_id=member_id, token=generate_unique_token(db))
        db.add(row)
        db.flush()
    return row  # existing rows returned unchanged (Req 1.2, 1.8)


def regenerate_token(db: Session, gym_id: int, member_id: int) -> QRToken:
    """Rotate the token in place and stamp rotated_at (Req 1.4-1.6)."""
    row = get_or_create_token(db, gym_id, member_id)
    row.token = generate_unique_token(db)      # old value no longer resolves (Req 1.6)
    row.rotated_at = func.now()
    db.flush()
    return row


def resolve_member_by_token(db: Session, gym_id: int, token: str) -> Optional[Member]:
    """Gym-scoped token -> member, or None (Req 2.1, 2.4, 7.1)."""
    qr = db.scalar(
        select(QRToken).where(QRToken.gym_id == gym_id, QRToken.token == token)
    )
    if qr is None:
        return None
    return db.scalar(
        select(Member).where(Member.id == qr.member_id, Member.gym_id == gym_id)
    )


def check_in(
    db: Session, gym_id: int, member: Member, *, method: AttendanceMethod, verified_by: int
) -> tuple[Attendance, bool]:
    """Idempotent one-per-day check-in. Returns (row, created)."""
    today = date.today()

    existing = db.scalar(
        select(Attendance).where(
            Attendance.member_id == member.id,
            Attendance.attendance_date == today,
            Attendance.gym_id == gym_id,
        )
    )
    if existing is not None:
        return existing, False                       # Req 3.2

    row = Attendance(
        gym_id=gym_id, member_id=member.id, attendance_date=today,
        method=method, verified_by=verified_by,
    )
    try:
        with db.begin_nested():                       # SAVEPOINT around the insert
            db.add(row)
            db.flush()                                # uq_attendance_day enforced here
    except IntegrityError:
        # Concurrent insert won the race (Req 3.3): resolve to the surviving row.
        row = db.scalar(
            select(Attendance).where(
                Attendance.member_id == member.id,
                Attendance.attendance_date == today,
                Attendance.gym_id == gym_id,
            )
        )
        return row, False
    return row, True                                  # Req 3.1


def to_row(att: Attendance, member: Member) -> dict:
    return {
        "id": att.id, "member_id": member.id, "member_name": member.name,
        "member_code": member.member_code, "attendance_date": att.attendance_date,
        "check_in_at": att.check_in_at, "method": att.method, "verified_by": att.verified_by,
    }


def list_history(
    db: Session, gym_id: int, *, on_date: Optional[date], page: int, page_size: int
) -> tuple[list[dict], int]:
    """Gym-scoped, check_in_at desc, optional date filter (Req 5.1-5.4)."""
    stmt = (
        select(Attendance, Member)
        .join(Member, Member.id == Attendance.member_id)
        .where(Attendance.gym_id == gym_id)
    )
    if on_date is not None:
        stmt = stmt.where(Attendance.attendance_date == on_date)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Attendance.check_in_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [to_row(a, m) for a, m in rows], total


def count_today(db: Session, gym_id: int) -> int:
    """Today's check-in count for the gym; 0 when none (Req 6.1, 6.2)."""
    return db.scalar(
        select(func.count()).select_from(Attendance).where(
            Attendance.gym_id == gym_id, Attendance.attendance_date == date.today()
        )
    ) or 0


def search_members(db: Session, gym_id: int, q: Optional[str], limit: int = 20) -> list[Member]:
    """Reuse member-search logic, gym-scoped, capped (Req 2.3)."""
    from app.services.member import list_members
    items, _ = list_members(db, gym_id, search=q, page=1, page_size=limit)
    return items
```

**Idempotency + race handling (Requirement 3).** The common path is a fast existence check (3.1/3.2). The `begin_nested()` SAVEPOINT isolates the `INSERT`/`flush`; if a concurrent request already inserted the same `(member_id, attendance_date)` row, `uq_attendance_day` raises `IntegrityError`, the savepoint rolls back (leaving the outer transaction and session usable), and the service re-reads and returns the surviving row with `created=False` (3.3). SAVEPOINT works on both SQLite (dev) and PostgreSQL (prod).

### Routers

#### Attendance router — `app/api/v1/routers/attendance.py`

```python
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.core.deps import CurrentUser, DbSession, require_admin, require_staff
from app.models.enums import AttendanceMethod
from app.schemas.attendance import (
    AttendanceRow, AttendanceTodayOut, CheckInRequest, CheckInResult,
    MemberLookupOut, QRTokenOut,
)
from app.schemas.common import Page
from app.services import attendance as svc
from app.services.audit import log_action
from app.services.member import get_member

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/check-in", response_model=CheckInResult, dependencies=[Depends(require_staff)])
def check_in(db: DbSession, current_user: CurrentUser, body: CheckInRequest):
    if body.token:
        member = svc.resolve_member_by_token(db, current_user.gym_id, body.token)
        method = AttendanceMethod.qr
        err = "QR code not recognised for this gym"
    else:
        member = get_member(db, current_user.gym_id, body.member_id)   # gym-scoped
        method = AttendanceMethod.manual
        err = "Member not found"
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, err)             # Req 2.4, 2.5

    att, created = svc.check_in(
        db, current_user.gym_id, member, method=method, verified_by=current_user.id
    )
    if created:                                                         # Req 4.1 / 4.2
        log_action(
            db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
            action="attendance.check_in", entity="attendance", entity_id=att.id,
            after={"member_id": member.id, "method": method.value},
        )
    db.commit()                                                        # single txn (Req 8.3)
    db.refresh(att)
    return CheckInResult(created=created, attendance=AttendanceRow(**svc.to_row(att, member)))


@router.get("", response_model=Page[AttendanceRow], dependencies=[Depends(require_staff)])
def history(
    db: DbSession, current_user: CurrentUser,
    on_date: date | None = Query(default=None, alias="date"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    items, total = svc.list_history(
        db, current_user.gym_id, on_date=on_date, page=page, page_size=page_size
    )
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.get("/today", response_model=AttendanceTodayOut, dependencies=[Depends(require_staff)])
def today(db: DbSession, current_user: CurrentUser):
    return AttendanceTodayOut(attendance_today=svc.count_today(db, current_user.gym_id))


@router.get("/member-search", response_model=list[MemberLookupOut],
            dependencies=[Depends(require_staff)])
def member_search(db: DbSession, current_user: CurrentUser, q: str | None = None):
    return svc.search_members(db, current_user.gym_id, q)


@router.get("/members/{member_id}/qr", response_model=QRTokenOut,
            dependencies=[Depends(require_admin)])
def admin_get_qr(db: DbSession, current_user: CurrentUser, member_id: int):
    if get_member(db, current_user.gym_id, member_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    row = svc.get_or_create_token(db, current_user.gym_id, member_id)   # Req 1.3
    db.commit()
    return row


@router.post("/members/{member_id}/qr/regenerate", response_model=QRTokenOut,
             dependencies=[Depends(require_admin)])
def admin_regen_qr(db: DbSession, current_user: CurrentUser, member_id: int):
    if get_member(db, current_user.gym_id, member_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    row = svc.regenerate_token(db, current_user.gym_id, member_id)      # Req 1.5
    log_action(
        db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
        action="attendance.qr_regenerate", entity="qr_token", entity_id=row.id,
    )
    db.commit()
    return row
```

Route order is unambiguous: the static sub-paths (`/check-in`, `/today`, `/member-search`, `/members/{id}/qr`) never collide with the collection root `""` (which resolves to `GET /attendance`). `GET /attendance/today` returns a scalar metric object and is distinct from the `GET /attendance` history list.

#### Portal router additions — `app/api/v1/routers/portal.py`

Member-self QR lives with the other `/me` self-service endpoints, consistent with the existing `/me/attendance` convention (Requirement 7.4). It reuses the same service.

```python
from app.schemas.attendance import QRTokenOut
from app.services import attendance as attendance_svc

@router.get("/qr", response_model=QRTokenOut)
def my_qr(db: DbSession, current_user: CurrentUser):
    member = _member(db, current_user)                      # existing helper
    row = attendance_svc.get_or_create_token(db, member.gym_id, member.id)  # Req 1.1, 1.2
    db.commit()
    return row

@router.post("/qr/regenerate", response_model=QRTokenOut)
def regenerate_my_qr(db: DbSession, current_user: CurrentUser):
    member = _member(db, current_user)
    row = attendance_svc.regenerate_token(db, member.gym_id, member.id)     # Req 1.4
    db.commit()
    return row
```

`_member()` already enforces that the row belongs to the logged-in user within their gym, so a member can only reach their own token (Requirement 7.4).

#### Router registration — `app/api/v1/router.py`

Add the import and `api_router.include_router(attendance.router)`, replacing the `# attendance` placeholder comment, so every route is reachable under `/api/v1` (Requirement 8.1).

### API Endpoints

| Method & path | Auth | Purpose | Requirements |
|---|---|---|---|
| `GET /api/v1/me/qr` | member (self) | Fetch (get-or-create) the caller's QR token | 1.1, 1.2, 9.1 |
| `POST /api/v1/me/qr/regenerate` | member (self) | Rotate the caller's QR token | 1.4, 9.2 |
| `GET /api/v1/attendance/members/{member_id}/qr` | `require_admin` | Fetch a member's token (admin) | 1.3, 7.3 |
| `POST /api/v1/attendance/members/{member_id}/qr/regenerate` | `require_admin` | Rotate a member's token (admin) | 1.5, 7.3 |
| `POST /api/v1/attendance/check-in` | `require_staff` | Check in by QR token or member_id | 2.1, 2.2, 3.x, 4.x |
| `GET /api/v1/attendance/member-search?q=` | `require_staff` | Manual-fallback member lookup | 2.3, 7.2 |
| `GET /api/v1/attendance?date=&page=&page_size=` | `require_staff` | Paginated gym attendance history | 5.1-5.4 |
| `GET /api/v1/attendance/today` | `require_staff` | `attendance_today` count metric | 6.1, 6.2 |

### Member lookup (Requirement 2.3)

The existing `GET /members` collection is `require_admin`, but trainers must run the manual fallback. Rather than loosen that admin endpoint, the design adds a purpose-built `GET /attendance/member-search` gated by `require_staff`. It reuses `app.services.member.list_members` (same gym-scoped name/code/phone/email search) and returns the lightweight `MemberLookupOut` (id, name, member_code, phone, status) — enough to pick a member for check-in, capped at 20 results for a typeahead.

## Frontend Design

### Frontend library choices

Neither library is currently in `frontend/package.json`; both are added as runtime dependencies.

- **QR rendering (member portal): `qrcode.react`.** A small, actively maintained React component library; its `QRCodeSVG` renders an SVG QR from the token string with no canvas/worker overhead. Used only in `MemberPortal`.
- **Camera scanning (Scanner page): `@zxing/browser` + `@zxing/library`.** The maintained ZXing JavaScript port. `html5-qrcode` was considered but its upstream repository is publicly seeking new maintainers, a maintenance risk for a security-relevant surface. ZXing lets us own the `<video>` element and camera lifecycle, which is what the HTTP/HTTPS degradation needs. It is **dynamically imported** only when the camera path activates, so HTTP users never download it.

Exact `dependencies` additions:

```jsonc
"qrcode.react": "^4.2.0",
"@zxing/browser": "^0.1.5",
"@zxing/library": "^0.21.3"
```

### Feature API module — `src/features/attendance/api.ts`

Follows the `features/members/api.ts` convention (thin typed wrappers over the shared `api` Axios instance).

```typescript
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export type AttendanceMethod = "qr" | "manual";

export interface QRToken { member_id: number; token: string; rotated_at: string | null; }
export interface AttendanceRow {
  id: number; member_id: number; member_name: string; member_code: string;
  attendance_date: string; check_in_at: string; method: AttendanceMethod; verified_by: number | null;
}
export interface CheckInResult { created: boolean; attendance: AttendanceRow; }
export interface MemberLookup {
  id: number; name: string; member_code: string; phone: string | null; status: string;
}

export async function getMyQr(): Promise<QRToken> {
  const { data } = await api.get<QRToken>("/me/qr");
  return data;
}
export async function regenerateMyQr(): Promise<QRToken> {
  const { data } = await api.post<QRToken>("/me/qr/regenerate");
  return data;
}
export async function checkIn(body: { token: string } | { member_id: number }): Promise<CheckInResult> {
  const { data } = await api.post<CheckInResult>("/attendance/check-in", body);
  return data;
}
export async function searchMembers(q: string): Promise<MemberLookup[]> {
  const { data } = await api.get<MemberLookup[]>("/attendance/member-search", { params: { q } });
  return data;
}
export async function listAttendance(params: { date?: string; page?: number; page_size?: number }) {
  const { data } = await api.get<Page<AttendanceRow>>("/attendance", { params });
  return data;
}
export async function getAttendanceToday(): Promise<number> {
  const { data } = await api.get<{ attendance_today: number }>("/attendance/today");
  return data.attendance_today;
}
```

### Member portal QR — extend `src/pages/portal/MemberPortal.tsx`

Add a "My QR Code" card to the existing portal grid. On mount it calls `getMyQr()` and renders `<QRCodeSVG value={token} size={200} level="M" />`. A "Regenerate" button calls `regenerateMyQr()` and swaps in the new token (Requirement 9.2). Fetch failure shows the existing `ErrorState` with a retry handler (Requirement 9.3). This is additive; existing portal sections are untouched.

### Scanner page — new `src/pages/Scanner.tsx` (replaces the `/app/scanner` placeholder)

Routing: in `src/app/router.tsx`, replace `{ path: "scanner", element: <Placeholder ... /> }` with the real `ScannerPage` (Requirement 10.1).

Capability detection decides the UI (Requirements 10.2, 10.3):

```typescript
const cameraSupported =
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!navigator.mediaDevices?.getUserMedia;
```

`navigator.mediaDevices.getUserMedia` exists only in a secure context (HTTPS, or `localhost`); on a plain-HTTP LAN IP it is `undefined` and `window.isSecureContext` is `false`. So:

- **Always rendered (works on local HTTP) — Requirement 10.3:** a token-paste `Input` + "Check in" button that calls `checkIn({ token })`, and a member-search box that calls `searchMembers(q)` and renders results; picking one calls `checkIn({ member_id })`. These never depend on the camera.
- **Rendered only when `cameraSupported` — Requirement 10.2:** a "Scan with camera" toggle. When enabled, the component dynamically imports ZXing (`const { BrowserQRCodeReader } = await import("@zxing/browser")`), starts `decodeFromVideoDevice(undefined, videoEl, cb)` into a `<video ref>`, and on a decoded result calls `checkIn({ token })`. The reader is stopped on unmount and after a successful decode to release the camera. If permission is denied, the camera area shows an inline error while the paste/search controls remain usable.

Degradation summary: the HTTP path is the baseline and always functional; the camera is a progressive enhancement that appears only when the browser can actually grant it. The ZXing bundle loads lazily, so HTTP users pay no download cost.

Result handling (Requirements 10.4, 10.5): on success, show the returned `attendance.member_name` + `member_code` and a status line keyed off `created` — "Checked in" when `created`, "Already checked in today" otherwise. On failure, show `apiErrorMessage(err)` and leave the inputs enabled for another attempt. A short success/error banner clears so the next member can be scanned.

### Attendance History page — new `src/pages/AttendanceHistory.tsx` (replaces the `/app/attendance` placeholder)

Routing: replace the attendance `Placeholder` with `AttendanceHistoryPage` (Requirement 11.1). The page follows the `Members.tsx` list pattern (load/loading/error/empty states, `Card`, table, pager):

- Fetches `listAttendance({ date, page, page_size })` and renders columns: member name, `member_code` (mono), `attendance_date`, check-in time (`toLocaleTimeString`), `method` (a `Badge`), and verifier (Requirement 11.2).
- A date `<input type="date">` filter re-queries with `date` and resets to page 1 (Requirement 11.3).
- Error → `ErrorState` with `onRetry` (Requirement 11.4). Empty `items` → `EmptyState` (Requirement 11.5).
- Pagination uses the `Page` envelope's `page`/`pages` exactly like `Members.tsx`.

### Dashboard KPI wiring — edit `src/pages/Dashboard.tsx`

Only the "Today's Attendance" card becomes live (Requirement 12). On mount, call `getAttendanceToday()`; on success, render the number in that card. The other five KPI cards keep their placeholder dash (Requirement 12.2). If the fetch rejects, catch it and leave the card in its placeholder state — no fabricated value, no crash (Requirement 12.3). Implementation: a small `useEffect` + `useState<number | null>` guarded by `try/catch`; the card shows the value when non-null, otherwise the existing `—`.

## Error Handling

| Condition | Backend behavior | Frontend behavior |
|---|---|---|
| QR token not in gym | 404, no row written (2.4) | Scanner error banner, inputs stay enabled (10.5) |
| member_id not in gym | 404, no row written (2.5) | Scanner error banner (10.5) |
| Duplicate same-day check-in | 200, `created=false`, existing row (3.2) | "Already checked in today" + member identity (10.4) |
| Concurrent insert race | 200, `created=false`, surviving row via SAVEPOINT re-query (3.3) | Same as duplicate (10.4) |
| Wrong role for endpoint | 403 via `require_staff`/`require_admin`, no mutation (7.5) | Standard Axios error surfaced by `apiErrorMessage` |
| Invalid check-in body (zero or both identifiers) | 422 from the Pydantic validator | Error banner |
| Portal QR fetch fails | n/a | `ErrorState` + retry (9.3) |
| History load fails | n/a | `ErrorState` + retry (11.4) |
| `attendance_today` fetch fails | n/a | KPI card stays a placeholder (12.3) |

## Security, RBAC, and Multi-Tenancy

- **Tenancy (7.1):** every service query filters by `gym_id` taken from the authenticated user; token resolution, history, the count, and member search are all gym-scoped. Tokens are opaque 64-char `secrets.token_urlsafe` values and are only ever resolved within the caller's gym.
- **Roles:** `require_staff` (admin or trainer) gates check-in, history, member-search, and the today metric (7.2). `require_admin` gates staff-side QR fetch/regeneration (7.3). Members reach only `/me/qr*`, scoped to their own linked member via `_member()` (7.4). An unauthorized role receives 403 before any handler logic runs, so no attendance or token state changes (7.5).
- **Audit (4):** a created check-in writes one `log_action` entry (`action="attendance.check_in"`, `entity="attendance"`, `entity_id=<new id>`); a duplicate/race result writes none. Admin QR regeneration writes `action="attendance.qr_regenerate"`. The handler commits once, covering the attendance row and its audit entry in a single transaction (8.3).

## Testing Strategy

**Dual approach.** Property-based tests (minimum 100 iterations each, tagged `Feature: qr-attendance, Property {n}: {text}`) cover the universal backend logic below; example/unit tests cover specific UI behaviors and edge cases; a small number of integration tests cover wiring (router registration under `/api/v1`) and transaction atomicity (a failed check-in leaves neither an attendance nor an audit row). The concurrency property (Property 9) forces the `IntegrityError` path to exercise the SAVEPOINT fallback rather than relying on real thread timing. Frontend criteria (Requirements 9-12) are verified with component/example tests (render-with-stub, secure-context mock on/off, `created`-flag messaging, error/empty states); they are not property tests. Structural criteria (8.2, 13.x) are review/config items.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: QR generation yields a unique 64-character token

For any Member that has no QR Token, generating one produces an opaque token of exactly 64 characters that is persisted with the Member's `gym_id` and `member_id`, returned unchanged to the caller, and distinct from every other token in `qr_tokens`.

**Validates: Requirements 1.1, 1.3, 1.7**

### Property 2: QR fetch is idempotent until regeneration

For any Member that already has a QR Token, every fetch (member-self or admin) returns the identical token value and creates no additional `qr_tokens` row, until a regeneration occurs.

**Validates: Requirements 1.2, 1.3, 1.8**

### Property 3: Regeneration replaces the token and stamps rotated_at

For any Member, regenerating (member-self or admin) stores a new 64-character opaque token different from the previous value in the same single row and sets `rotated_at` to the current time.

**Validates: Requirements 1.4, 1.5**

### Property 4: A regenerated-away token resolves to no Member

For any Member whose token is regenerated, resolving the previous token value returns no Member, while resolving the new token returns that Member.

**Validates: Requirements 1.6**

### Property 5: Check-in records method, verifier, gym, and current date

For any Member in the Staff user's Gym and either identifier kind, a successful check-in records a row whose `verified_by` is the Staff user's id, `gym_id` is the Staff user's gym, `attendance_date` is the current date, and `method` is `qr` when a token was submitted and `manual` when a member identifier was submitted.

**Validates: Requirements 2.1, 2.2**

### Property 6: Member lookup is gym-scoped

For any backing set of Members across multiple Gyms and any search query, every Member returned by the lookup has `gym_id` equal to the Staff user's `gym_id`.

**Validates: Requirements 2.3, 7.1**

### Property 7: An unresolvable identifier errors and records nothing

For any QR Token that resolves to no Member in the Gym, and for any member identifier that matches no Member in the Gym, the check-in returns an error response and the number of attendance rows is unchanged.

**Validates: Requirements 2.4, 2.5**

### Property 8: At most one check-in per Member per day

For any Member and current date, the first check-in creates exactly one row and reports `created = true`; every subsequent same-day check-in returns that same row, reports `created = false`, and creates no additional row.

**Validates: Requirements 3.1, 3.2**

### Property 9: Concurrent duplicate check-ins converge to one row

For any Member already having a current-date check-in, a second insert that violates `uq_attendance_day` is resolved to the single existing row and returns a success response reporting `created = false`, leaving exactly one row for that Member and date.

**Validates: Requirements 3.3**

### Property 10: A new check-in writes exactly one audit entry; a duplicate writes none

For any check-in, an audit entry (`gym_id` = Staff gym, `actor_user_id` = Staff id, a check-in `action`, `entity` = `attendance`, `entity_id` = the row id) is written if and only if a new row was created; a duplicate or race-resolved result writes no audit entry.

**Validates: Requirements 4.1, 4.2**

### Property 11: History is gym-scoped, date-descending, paginated, and fully projected

For any backing data and pagination arguments, the history response contains only check-ins whose `gym_id` equals the Staff user's gym, ordered by `check_in_at` descending, with `items` no longer than `page_size`, `pages = ceil(total / page_size)`, and every item carrying the Member's name, `member_code`, `attendance_date`, `check_in_at`, `method`, and `verified_by`; when a date filter is supplied, every item's `attendance_date` equals that date.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 12: attendance_today equals today's gym check-in count

For any backing set of attendance rows across dates and Gyms, the `attendance_today` metric equals the number of rows whose `gym_id` is the Staff user's gym and whose `attendance_date` is the current date, and is zero when there are none.

**Validates: Requirements 6.1, 6.2**

### Property 13: Member self-service returns only the caller's own records

For any two distinct Members with portal logins, each Member's self-service QR and attendance requests return only records belonging to that Member.

**Validates: Requirements 7.4**

### Property 14: Role-gated endpoints reject unauthorized roles with 403

For any attendance or QR endpoint and any authenticated user whose role is not permitted by that endpoint, the request returns HTTP 403 and performs no attendance or QR Token change.

**Validates: Requirements 7.2, 7.3, 7.5**
