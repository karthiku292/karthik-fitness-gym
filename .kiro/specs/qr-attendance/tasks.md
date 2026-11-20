# Implementation Plan: QR Attendance

## Overview

This plan turns the QR-attendance design into incremental, dependency-aware coding tasks. Backend is built first (schemas → service → routers → registration), because every frontend surface depends on the live endpoints; the frontend then consumes a single `features/attendance` API layer across the Scanner, Attendance History, member-portal QR card, and the dashboard KPI.

The feature reuses the existing `attendance` and `qr_tokens` tables and the `uq_attendance_day` constraint, so **no database migration is expected**; task 1.2 verifies this and only adds an inspect-guarded migration if a column is ever found missing.

Backend code follows the members feature conventions (`app/services/member.py`, `app/api/v1/routers/members.py`, `app/schemas/common.py` `Page`). Frontend code follows the `features/members/api.ts` wrapper convention and the `Members.tsx` list pattern (load / loading / error / empty states, `Card`, table, pager) using the existing `useState`/`useEffect` + shared Axios `api` instance.

Property-based tests cover the 14 correctness properties from the design (minimum 100 iterations each, tagged `Feature: qr-attendance, Property {n}: {text}`); example/component tests cover UI criteria and the request-validator edge case. Property/unit/integration/component tests are marked optional (`*`). Two tooling prerequisites are introduced by setup tasks: `hypothesis` for the backend (not currently installed) and `vitest` + Testing Library for the frontend (no test framework currently present).

## Tasks

- [x] 1. Backend attendance schemas, migration safety, and test harness
  - [x] 1.1 Create attendance Pydantic schemas
    - Add `backend/app/schemas/attendance.py` with `QRTokenOut`, `CheckInRequest` (with the `model_validator` enforcing exactly one of `token`/`member_id`), `AttendanceRow`, `CheckInResult`, `MemberLookupOut`, and `AttendanceTodayOut`, exactly as specified in the design's Schemas section
    - Import `AttendanceMethod` and `MemberStatus` from `app.models.enums`; use `model_config = {"from_attributes": True}` where the design does
    - Follow existing schema module conventions (full-path imports; `app/schemas/__init__.py` stays empty)
    - _Requirements: 8.2; Design: Components and Interfaces → Schemas_

  - [x] 1.2 Verify data model reuse and migration safety
    - Confirm `app/models/attendance.py` (`Attendance`, `QRToken`) already carries every column the design's service and schemas need (`method`, `verified_by`, `attendance_date`, `uq_attendance_day`, `qr_tokens.token`/`rotated_at`); conclude that no new column and therefore no migration is required
    - Only if a column is found missing: introduce it through the project's inspect-guarded idempotent pattern (see `backend/alembic/versions/20260102_0000_branches.py`, `checkfirst=True` / `inspect(...)` guard) so the migration is a no-op where the column already exists. Otherwise create no migration file
    - _Requirements: 13.1, 13.2, 13.3; Design: Data Models → Migration safety_

  - [ ]* 1.3 Set up the backend test harness
    - Add `hypothesis` to `backend/requirements.txt` (property-based tests require it; not currently installed) and install it into the backend venv
    - Create `backend/tests/__init__.py` and `backend/tests/conftest.py` with fixtures: an isolated SQLite session (create tables via `Base.metadata.create_all`), a FastAPI `TestClient`, and helpers to seed a gym, admin/trainer/member users with valid access tokens, and members — enough to drive both service-level and endpoint-level tests
    - _Design: Testing Strategy_

  - [ ]* 1.4 Write unit test for the `CheckInRequest` validator
    - Assert that supplying neither or both of `token`/`member_id` raises a validation error (maps to the API's 422), and that supplying exactly one is accepted
    - Target: `backend/tests/test_checkin_request_schema.py`
    - _Requirements: Design Error Handling (invalid check-in body → 422)_

- [x] 2. Backend attendance service
  - [x] 2.1 Implement the attendance service module
    - Add `backend/app/services/attendance.py` implementing, per the design's Service section: `_new_token`/`generate_unique_token` (opaque 64-char `secrets.token_urlsafe(48)`, unique across `qr_tokens`), `get_or_create_token`, `regenerate_token` (new token in place + `rotated_at = func.now()`), `resolve_member_by_token` (gym-scoped), `check_in` (fast existence check, then `begin_nested()` SAVEPOINT around the insert/flush with `IntegrityError` handling that re-reads the surviving row, recording `method`/`verified_by`/`gym_id`/`attendance_date=today`, returning `(row, created)`), `to_row`, `list_history` (gym-scoped, `check_in_at` desc, optional date filter, paginated with total), `count_today`, and `search_members` (reuse `app.services.member.list_members`, capped at 20)
    - Use `db.flush()` and leave `db.commit()` to the router, matching the member/payment service style
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 7.1, 8.3; Design: Components and Interfaces → Service_

  - [ ]* 2.2 Write property test — QR generation yields a unique 64-character token
    - **Property 1: QR generation yields a unique 64-character token**
    - **Validates: Requirements 1.1, 1.3, 1.7**
    - Target: `backend/tests/test_prop_01_qr_unique.py`

  - [ ]* 2.3 Write property test — QR fetch is idempotent until regeneration
    - **Property 2: QR fetch is idempotent until regeneration**
    - **Validates: Requirements 1.2, 1.3, 1.8**
    - Target: `backend/tests/test_prop_02_qr_idempotent.py`

  - [ ]* 2.4 Write property test — regeneration replaces the token and stamps rotated_at
    - **Property 3: Regeneration replaces the token and stamps rotated_at**
    - **Validates: Requirements 1.4, 1.5**
    - Target: `backend/tests/test_prop_03_qr_regenerate.py`

  - [ ]* 2.5 Write property test — a regenerated-away token resolves to no Member
    - **Property 4: A regenerated-away token resolves to no Member**
    - **Validates: Requirements 1.6**
    - Target: `backend/tests/test_prop_04_token_resolution.py`

  - [ ]* 2.6 Write property test — check-in records method, verifier, gym, and current date
    - **Property 5: Check-in records method, verifier, gym, and current date**
    - **Validates: Requirements 2.1, 2.2**
    - Target: `backend/tests/test_prop_05_checkin_fields.py`

  - [ ]* 2.7 Write property test — member lookup is gym-scoped
    - **Property 6: Member lookup is gym-scoped**
    - **Validates: Requirements 2.3, 7.1**
    - Target: `backend/tests/test_prop_06_lookup_scope.py`

  - [ ]* 2.8 Write property test — at most one check-in per Member per day
    - **Property 8: At most one check-in per Member per day**
    - **Validates: Requirements 3.1, 3.2**
    - Target: `backend/tests/test_prop_08_one_per_day.py`

  - [ ]* 2.9 Write property test — concurrent duplicate check-ins converge to one row
    - **Property 9: Concurrent duplicate check-ins converge to one row**
    - **Validates: Requirements 3.3**
    - Force the `uq_attendance_day` `IntegrityError` path (simulate a competing insert) so the `begin_nested()` SAVEPOINT fallback is exercised; assert one surviving row and `created = false`
    - Target: `backend/tests/test_prop_09_concurrent_converge.py`

  - [ ]* 2.10 Write property test — history is gym-scoped, date-descending, paginated, and fully projected
    - **Property 11: History is gym-scoped, date-descending, paginated, and fully projected**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Target: `backend/tests/test_prop_11_history.py`

  - [ ]* 2.11 Write property test — attendance_today equals today's gym check-in count
    - **Property 12: attendance_today equals today's gym check-in count**
    - **Validates: Requirements 6.1, 6.2**
    - Target: `backend/tests/test_prop_12_today_count.py`

- [x] 3. Backend attendance router
  - [x] 3.1 Implement the attendance router
    - Add `backend/app/api/v1/routers/attendance.py` with `router = APIRouter(prefix="/attendance", tags=["attendance"])` and the endpoints from the design: `POST /check-in` (derive `method` from identifier, resolve by token or `get_member`, 404 on no match, call `svc.check_in`, and on `created` write one `log_action` with `action="attendance.check_in"`, `entity="attendance"`, `entity_id=att.id`, then a single `db.commit()`), `GET ""` history (`Page[AttendanceRow]`), `GET /today` (`AttendanceTodayOut`), `GET /member-search` (`list[MemberLookupOut]`), `GET /members/{member_id}/qr` and `POST /members/{member_id}/qr/regenerate`
    - Apply role gates via `dependencies=[Depends(require_staff)]` on check-in/history/today/member-search and `Depends(require_admin)` on the two staff-side QR endpoints; the admin regenerate endpoint writes `action="attendance.qr_regenerate"`
    - Commit the attendance row and its audit entry in one transaction (Req 8.3)
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 7.2, 7.3, 8.2, 8.3; Design: Components and Interfaces → Routers → Attendance router_

  - [ ]* 3.2 Write property test — an unresolvable identifier errors and records nothing
    - **Property 7: An unresolvable identifier errors and records nothing**
    - **Validates: Requirements 2.4, 2.5**
    - Drive `POST /attendance/check-in` with an unknown token and an unknown `member_id`; assert an error response and unchanged attendance row count
    - Target: `backend/tests/test_prop_07_unresolvable.py`

  - [ ]* 3.3 Write property test — a new check-in writes exactly one audit entry; a duplicate writes none
    - **Property 10: A new check-in writes exactly one audit entry; a duplicate writes none**
    - **Validates: Requirements 4.1, 4.2**
    - Target: `backend/tests/test_prop_10_audit.py`

  - [ ]* 3.4 Write property test — role-gated endpoints reject unauthorized roles with 403
    - **Property 14: Role-gated endpoints reject unauthorized roles with 403**
    - **Validates: Requirements 7.2, 7.3, 7.5**
    - Cover staff-only endpoints hit by a member, and admin-only QR endpoints hit by a trainer; assert 403 and no attendance/QR change
    - Target: `backend/tests/test_prop_14_rbac.py`

  - [ ]* 3.5 Write integration test — check-in transaction atomicity
    - Assert a failed check-in (unresolvable identifier) leaves neither an attendance row nor an audit row, confirming the single-transaction commit boundary (Req 8.3)
    - Target: `backend/tests/test_checkin_atomicity.py`
    - _Requirements: 8.3; Design: Testing Strategy_

- [x] 4. Backend portal QR endpoints and router registration
  - [x] 4.1 Add member-self QR endpoints to the portal router
    - In `backend/app/api/v1/routers/portal.py` add `GET /qr` and `POST /qr/regenerate` returning `QRTokenOut`, resolving the caller's member via the existing `_member(db, current_user)` helper and delegating to `app.services.attendance.get_or_create_token` / `regenerate_token`, then `db.commit()` — scoped to the caller's own member only
    - _Requirements: 1.1, 1.2, 1.4, 7.4, 9.1, 9.2; Design: Routers → Portal router additions_

  - [x] 4.2 Register the attendance router under the v1 API
    - In `backend/app/api/v1/router.py` import `attendance` and add `api_router.include_router(attendance.router)`, replacing the `# attendance` placeholder comment so all routes are reachable under `/api/v1`
    - _Requirements: 8.1; Design: Routers → Router registration_

  - [ ]* 4.3 Write property test — member self-service returns only the caller's own records
    - **Property 13: Member self-service returns only the caller's own records**
    - **Validates: Requirements 7.4**
    - For two distinct members with portal logins, assert each one's `/me/qr` and `/me/attendance` return only their own records
    - Target: `backend/tests/test_prop_13_self_service.py`

  - [ ]* 4.4 Write integration test — attendance routes mounted under /api/v1
    - Assert the check-in, history, today, member-search, and QR routes are reachable under the `/api/v1` prefix (e.g. via the OpenAPI schema / a staff request), confirming registration
    - Target: `backend/tests/test_router_registration.py`
    - _Requirements: 8.1; Design: Testing Strategy_

- [x] 5. Checkpoint — backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend dependencies and test tooling
  - [x] 6.1 Add runtime and test dependencies
    - Add to `frontend/package.json` `dependencies`: `qrcode.react` (^4.2.0), `@zxing/browser` (^0.1.5), `@zxing/library` (^0.21.3), per the design's library choices
    - Add test tooling to `devDependencies` (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`; no frontend test framework exists yet), add a `test` script, and configure the Vitest environment (`jsdom`) and setup file in `vite.config.ts`
    - Install so `node_modules` and the lockfile are updated
    - _Requirements: 9.1, 10.2; Design: Frontend library choices_

- [x] 7. Frontend attendance API layer
  - [x] 7.1 Create the attendance feature API module
    - Add `frontend/src/features/attendance/api.ts` with the types (`QRToken`, `AttendanceRow`, `CheckInResult`, `MemberLookup`, `AttendanceMethod`) and typed wrappers over the shared `@/lib/api` Axios instance: `getMyQr`, `regenerateMyQr`, `checkIn`, `searchMembers`, `listAttendance`, `getAttendanceToday`, exactly as in the design's Feature API module
    - Follow the `features/members/api.ts` convention; reuse the `Page` type from `@/lib/types`
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 6.1, 9.1, 9.2; Design: Frontend Design → Feature API module_

- [x] 8. Frontend Attendance History page
  - [x] 8.1 Build the Attendance History page and wire its route
    - Add `frontend/src/pages/AttendanceHistory.tsx` following the `Members.tsx` list pattern: fetch `listAttendance({ date, page, page_size })`; render columns member name, `member_code` (mono), `attendance_date`, check-in time (`toLocaleTimeString`), `method` (`Badge`), and verifier; a `<input type="date">` filter that re-queries and resets to page 1; `ErrorState` with retry; `EmptyState` when no items; pager driven by the `Page` envelope
    - In `frontend/src/app/router.tsx` replace the `/app/attendance` `Placeholder` with the new page
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5; Design: Attendance History page_

  - [ ]* 8.2 Write component tests for the Attendance History page
    - Render with a stubbed `listAttendance`: assert rows display the projected fields, the date filter re-queries for the selected date, and the error and empty states render with a retry affordance
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

- [x] 9. Frontend QR Scanner page
  - [x] 9.1 Build the QR Scanner page and wire its route
    - Add `frontend/src/pages/Scanner.tsx`. Always render (works on local HTTP) a token-paste input + "Check in" calling `checkIn({ token })`, and a member-search box calling `searchMembers(q)` whose result selection calls `checkIn({ member_id })`
    - Compute `cameraSupported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia`; only when true render a "Scan with camera" toggle that dynamically imports `@zxing/browser` (`BrowserQRCodeReader`), decodes into a `<video ref>`, submits the decoded token via `checkIn({ token })`, and stops the reader on unmount and after a successful decode; camera-permission denial shows an inline error while paste/search stay usable
    - On success show `attendance.member_name` + `member_code` with a status line keyed off `created` ("Checked in" vs "Already checked in today"); on failure show `apiErrorMessage(err)` and keep inputs enabled for another attempt
    - In `frontend/src/app/router.tsx` replace the `/app/scanner` `Placeholder` with the new page
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5; Design: Scanner page_

  - [ ]* 9.2 Write component tests for the Scanner page
    - With a stubbed `checkIn`/`searchMembers` and a mocked secure context: assert the camera toggle is hidden when `isSecureContext` is false and shown when true; the paste and search fallbacks submit check-ins; the `created` flag drives the "Checked in" vs "Already checked in today" message; and a failed check-in shows an error while leaving inputs enabled
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [x] 10. Frontend member-portal QR display
  - [x] 10.1 Add the "My QR Code" card to the member portal
    - Extend `frontend/src/pages/portal/MemberPortal.tsx` with a card that calls `getMyQr()` on mount and renders `<QRCodeSVG value={token} size={200} level="M" />`; a "Regenerate" button calls `regenerateMyQr()` and swaps in the new token; a fetch failure shows the existing `ErrorState` with a retry handler. Keep existing portal sections untouched
    - _Requirements: 9.1, 9.2, 9.3; Design: Member portal QR_

  - [ ]* 10.2 Write component tests for the portal QR card
    - With a stubbed `getMyQr`/`regenerateMyQr`: assert the QR renders for the returned token, regenerate swaps to the new token, and a fetch failure shows the error state with retry
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 11. Frontend dashboard KPI wiring
  - [x] 11.1 Wire the "Today's Attendance" KPI
    - Edit `frontend/src/pages/Dashboard.tsx` to call `getAttendanceToday()` on mount (`useEffect` + `useState<number | null>` in a `try/catch`) and render the value in the "Today's Attendance" card when non-null; keep the other five KPI cards as Phase 6 placeholders; on fetch failure leave the card in its placeholder (`—`) state with no fabricated value and no crash
    - _Requirements: 12.1, 12.2, 12.3; Design: Dashboard KPI wiring_

  - [ ]* 11.2 Write component test for the dashboard KPI
    - With a stubbed `getAttendanceToday`: assert the card shows the count on success and stays a placeholder on failure, while other cards remain placeholders
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 12. Checkpoint — final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (all property, unit, integration, and component tests, plus the test harness/tooling setup) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Backend is sequenced before the frontend pieces that depend on it: schemas → service → router → portal/registration, then the frontend API layer → pages/KPI.
- Each property test must run a minimum of 100 iterations and carry the tag `Feature: qr-attendance, Property {n}: {text}` from the design.
- Two test frameworks are introduced by setup tasks because they are not currently present: `hypothesis` (backend property tests, task 1.3) and `vitest` + Testing Library (frontend component tests, task 6.1).
- No Alembic migration is expected (task 1.2); a migration is added only if a required column is found missing, using the project's inspect-guarded idempotent pattern.
- Structural criteria (8.2 conventions, 13.x migration safety) and frontend UI criteria are verified by review and example/component tests, not property tests, per the design's Testing Strategy.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "1.4"] },
    { "id": 2, "tasks": ["3.1", "4.1", "6.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11"] },
    { "id": 3, "tasks": ["4.2", "7.1", "3.2", "3.3", "3.4", "3.5", "4.3"] },
    { "id": 4, "tasks": ["8.1", "10.1", "11.1", "4.4"] },
    { "id": 5, "tasks": ["9.1", "8.2", "10.2", "11.2"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
