# Implementation Plan: notifications

## Overview

Build the notifications feature as one backend slice (schemas → service → router → registration → seeding) followed by the frontend surface (feature API → admin page → route mount). The feature reuses the existing `notifications` and `notification_templates` tables, so no migration is added. Backend is Python (FastAPI + SQLAlchemy 2.0 + Pydantic v2); frontend is TypeScript + React 18.

Tasks build incrementally and end by wiring the page into the router. All test sub-tasks are marked optional (`*`). Property tests realize the 21 correctness properties from the design; each lives in its own file so it never conflicts with another task. Tasks that edit the same file (`app/services/notification.py`, `app/api/v1/router.py`, `app/db/seed.py`, `frontend/src/app/router.tsx`) are serialized into different waves — see the Task Dependency Graph.

## Tasks

- [x] 1. Backend foundations — schemas and test infrastructure
  - [x] 1.1 Create `app/schemas/notification.py`
    - Define `EventType = Literal["welcome", "membership_expiry", "payment_receipt"]`
    - `TemplateBase` / `TemplateCreate` / `TemplateUpdate` / `TemplateOut` with `subject` max_length 200 and `body` max_length 2000, `TemplateUpdate.is_active` optional
    - `NotificationOut` log/row projection (adds `member_name`)
    - `ManualSendRequest` with a `model_validator(mode="after")` enforcing exactly one of `template_id` XOR (`event_type` + `channel`); optional `membership_id` / `payment_id`
    - `ReminderRunRequest` (`within_days` default 7, unbounded in schema; `channel` default `whatsapp`) and `ReminderRunResult` (`memberships_selected`, `notifications_created`, `channel`, `within_days`)
    - Design: Schemas — `app/schemas/notification.py`
    - _Requirements: 2.3, 3.2, 3.3, 3.6, 5.1, 5.6, 7.1, 7.4, 7.6_
  - [ ]* 1.2 Set up backend property-test infrastructure (prerequisite for every other backend test sub-task)
    - Add `hypothesis` to `backend/requirements.txt` and install it (`hypothesis` is not currently installed)
    - Create `backend/tests/conftest.py`: a FastAPI `TestClient` fixture, a SQLite test engine/session with `Base.metadata.create_all`, a token/auth-header helper, factories for gym / admin user / member / membership / payment, injectable fake `ChannelSender`s (success, raising-timeout, no-contact), and `settings` overrides for `WHATSAPP_API_*` / `SMTP_*`
    - Add `backend/tests/__init__.py` if needed; configure min 100 iterations for hypothesis profiles
    - _Requirements: supports property tests for Requirements 1–9_

- [x] 2. Backend service — `app/services/notification.py` (built incrementally)
  - [x] 2.1 Create the service module scaffold and rendering layer
    - Module imports and constants: `PROVIDER_TIMEOUT = 5.0`, `ERROR_MAX = 500`, `DEFAULT_WINDOW = 7`, `_PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_.]+)\}")`
    - `build_context(member, gym, membership=None, payment=None)` flattening Context Sources to dotted-key strings, mapping `None` to `""`
    - `render(text, context)` doing regex substitution where unknown keys resolve to `""` and no token survives
    - Design: Service — Rendering (Req 4)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 2.2 Write property test for rendering
    - **Property 9: Rendering substitutes context, blanks unknowns, and leaves no tokens**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - File `backend/tests/test_prop09_rendering.py`; tag `Feature: notifications, Property 9`
  - [x] 2.3 Implement the channel senders
    - `ChannelSender` Protocol (`channel`, `is_configured`, `destination`, `send`)
    - `WhatsAppSender` (httpx POST with `timeout=PROVIDER_TIMEOUT`, `raise_for_status`, config from `WHATSAPP_API_URL` + `WHATSAPP_API_TOKEN`, destination `member.phone`)
    - `EmailSender` (smtplib + `email.message.EmailMessage`, `timeout=PROVIDER_TIMEOUT`, config from `SMTP_HOST` + `SMTP_FROM`, destination `member.email`)
    - `DEFAULT_SENDERS` mapping
    - Design: Service — Channel senders (Req 6); Channel-sender abstraction
    - _Requirements: 6.2, 6.5, 6.6, 6.7_
  - [ ]* 2.4 Write property test for independent channel configuration
    - **Property 16: Channel configuration is evaluated independently**
    - **Validates: Requirements 6.5**
    - File `backend/tests/test_prop16_channel_config.py`; tag `Feature: notifications, Property 16`
  - [x] 2.5 Implement `dispatch`
    - Render subject/body, construct exactly one `Notification` (default `queued`), stamp `gym_id` + `member_id`
    - Unconfigured channel → dry-run: `status=sent`, `provider_ref` begins `dryrun:`, set `sent_at`, no network call
    - Configured + no destination → `status=failed` with explanatory `error`, no network call
    - Configured + send success → `status=sent`, store provider ref, set `sent_at`
    - Configured + send raises → caught, `status=failed`, `error` truncated to 500 chars, never re-raise
    - Single `db.add` + `db.flush`; accept injectable `senders=DEFAULT_SENDERS`
    - Design: Service — Dispatch; Dispatch exactly-one-row guarantee
    - _Requirements: 2.3, 1.4, 5.7, 6.1, 6.3, 6.4, 6.8_
  - [ ]* 2.6 Write property test for the exactly-one-terminal-row / no-row-on-404 guarantee
    - **Property 11: A resolved send writes exactly one terminal row; a failed resolution writes none**
    - **Validates: Requirements 5.4, 5.7**
    - File `backend/tests/test_prop11_dispatch_one_row.py`; tag `Feature: notifications, Property 11`
  - [ ]* 2.7 Write property test for dry-run dispatch
    - **Property 12: An unconfigured channel dispatches as a dry-run**
    - **Validates: Requirements 6.1**
    - File `backend/tests/test_prop12_dryrun.py`; tag `Feature: notifications, Property 12`
  - [ ]* 2.8 Write property test for configured success
    - **Property 13: A configured channel that succeeds records a sent delivery**
    - **Validates: Requirements 6.3**
    - File `backend/tests/test_prop13_configured_success.py`; tag `Feature: notifications, Property 13`
  - [ ]* 2.9 Write property test for configured failure never raising
    - **Property 14: A configured provider failure records a failure and never raises**
    - **Validates: Requirements 6.4**
    - File `backend/tests/test_prop14_configured_failure.py`; tag `Feature: notifications, Property 14`
  - [ ]* 2.10 Write property test for missing destination contact
    - **Property 15: A configured channel with no destination contact fails without a network call**
    - **Validates: Requirements 6.8**
    - File `backend/tests/test_prop15_no_contact.py`; tag `Feature: notifications, Property 15`
  - [x] 2.11 Implement template resolution, CRUD, and context getters
    - `resolve_template` (by id gym-scoped; else active `(event_type, channel)` gym-scoped), `get_template`, `list_templates`, `create_template` (`is_active=True`), `update_template` (`model_dump(exclude_unset=True)`), `delete_template`
    - `get_membership`, `get_payment` (gym-scoped)
    - Service `flush`es; all reads filter by `gym_id`
    - Design: Service — Template resolution & CRUD (Req 3, 5); Context getters
    - _Requirements: 1.3, 1.5, 3.1, 3.4, 3.5, 3.6, 3.7, 3.8, 5.2, 5.3_
  - [ ]* 2.12 Write property test for template resolution
    - **Property 8: Template resolution honors ownership, active flag, and selector**
    - **Validates: Requirements 3.8, 5.1, 5.2, 5.3**
    - File `backend/tests/test_prop08_resolution.py`; tag `Feature: notifications, Property 8`
  - [x] 2.13 Implement expiry reminders
    - `clamp_window` (None → 7, else bound to 1..90), `select_expiring` (gym-scoped, `status=active`, `end_date` in `[today, today+window]`, ordered ascending), `run_expiry_reminders` (one `membership_expiry` dispatch per selected membership, returns `(selected, created)`, accepts injectable `senders`)
    - Design: Service — Expiry reminders (Req 7)
    - _Requirements: 7.1, 7.2, 7.3, 7.6_
  - [ ]* 2.14 Write property test for the reminder window
    - **Property 17: The reminder window defaults to 7 and clamps to 1 through 90**
    - **Validates: Requirements 7.1**
    - File `backend/tests/test_prop17_window.py`; tag `Feature: notifications, Property 17`
  - [ ]* 2.15 Write property test for reminder selection
    - **Property 18: Reminder selection matches the active, gym-scoped, in-window predicate**
    - **Validates: Requirements 7.2**
    - File `backend/tests/test_prop18_selection.py`; tag `Feature: notifications, Property 18`
  - [ ]* 2.16 Write property test for per-selection dispatch and truthful counts
    - **Property 19: Reminders dispatch one membership_expiry per selection and report truthful counts**
    - **Validates: Requirements 7.3, 7.6**
    - File `backend/tests/test_prop19_reminder_counts.py`; tag `Feature: notifications, Property 19`
  - [x] 2.17 Implement log listing
    - `to_row(note, member_name)` projection; `list_notifications` with optional `status` / `channel` / `event_type` / `member_id` filters, `created_at` descending, offset/limit pagination, returning `(rows, total)`
    - Design: Service — Log listing (Req 8)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ]* 2.18 Write property test for the notification log
    - **Property 20: The notification log is gym-scoped, filtered, date-descending, and paginated**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
    - File `backend/tests/test_prop20_log.py`; tag `Feature: notifications, Property 20`

- [x] 3. Backend router and registration
  - [x] 3.1 Create `app/api/v1/routers/notifications.py`
    - `APIRouter(prefix="/notifications", tags=["notifications"], dependencies=[Depends(require_admin)])`
    - Template endpoints: `GET /templates`, `POST /templates` (201), `PUT /templates/{id}` (404 cross-gym), `DELETE /templates/{id}` (204, 404 cross-gym)
    - Log: `GET ""` returning `Page[NotificationOut]` with `status`/`channel`/`event_type`/`member_id` filters and `page`/`page_size` (`ge=1`, `le=100`)
    - Manual send: `POST /send` — resolve member (404) and template (404), optional owned membership/payment (404 if cross-gym), dispatch, return `to_row`
    - Run reminders: `POST /run-reminders` — `clamp_window`, resolve active `membership_expiry` template for channel (404 if absent), run, return `ReminderRunResult`
    - Each mutating handler calls `svc` (which flushes), then `log_action`, then `db.commit()`; reuse `get_member` from `app.services.member`
    - Design: Routers — `app/api/v1/routers/notifications.py`; API Endpoints table
    - _Requirements: 1.1, 1.5, 3.1, 3.4, 3.5, 3.6, 3.7, 5.1, 5.4, 5.5, 5.6, 5.7, 5.8, 7.1, 7.4, 7.5, 7.6, 8.1, 8.3, 10.2, 10.3_
  - [x] 3.2 Register the router in `app/api/v1/router.py`
    - Add `notifications` to the `routers` import and call `api_router.include_router(notifications.router)` in the reserved `# notifications, ai` slot
    - Design: Router registration — `app/api/v1/router.py`
    - _Requirements: 10.1, 10.2_
  - [ ]* 3.3 Write integration/example tests for router wiring and response shapes
    - Routes reachable under `/api/v1/notifications`, `require_admin` applied to every endpoint, manual-send response includes `status` + `provider_ref`, reminder channel defaults to `whatsapp`, missing `membership_expiry` template yields 404; optionally point `WHATSAPP_API_URL` at a localhost stub to exercise the real httpx + 5s timeout path
    - File `backend/tests/test_router_integration.py`
    - _Requirements: 5.4, 5.8, 7.4, 7.5, 10.1, 10.2, 10.3_
  - [ ]* 3.4 Write property test for admin-only, token-gated access
    - **Property 1: Access is admin-only and token-gated**
    - **Validates: Requirements 1.1, 1.2, 10.3**
    - File `backend/tests/test_prop01_access.py`; tag `Feature: notifications, Property 1`
  - [ ]* 3.5 Write property test for gym-scoped reads
    - **Property 2: Reads are gym-scoped**
    - **Validates: Requirements 1.3, 3.4**
    - File `backend/tests/test_prop02_scoped_reads.py`; tag `Feature: notifications, Property 2`
  - [ ]* 3.6 Write property test for gym-scoped writes and active-on-create
    - **Property 3: Persisted rows are gym-scoped and new templates are active**
    - **Validates: Requirements 1.4, 3.1**
    - File `backend/tests/test_prop03_scoped_writes.py`; tag `Feature: notifications, Property 3`
  - [ ]* 3.7 Write property test for cross-gym rejection without side effects
    - **Property 4: Cross-gym references are rejected without side effects**
    - **Validates: Requirements 1.5, 5.5**
    - File `backend/tests/test_prop04_cross_gym.py`; tag `Feature: notifications, Property 4`
  - [ ]* 3.8 Write property test for invalid template input
    - **Property 5: Invalid template input is rejected and persists nothing**
    - **Validates: Requirements 3.2, 3.3**
    - File `backend/tests/test_prop05_invalid_input.py`; tag `Feature: notifications, Property 5`
  - [ ]* 3.9 Write property test for template update and toggle
    - **Property 6: Template update and toggle persist exactly the submitted changes**
    - **Validates: Requirements 3.5, 3.6**
    - File `backend/tests/test_prop06_update_toggle.py`; tag `Feature: notifications, Property 6`
  - [ ]* 3.10 Write property test for template deletion
    - **Property 7: Template deletion removes the record**
    - **Validates: Requirements 3.7**
    - File `backend/tests/test_prop07_delete.py`; tag `Feature: notifications, Property 7`
  - [ ]* 3.11 Write property test for supplied owned context sources
    - **Property 10: Supplied owned context sources are available to rendering**
    - **Validates: Requirements 5.6**
    - File `backend/tests/test_prop10_context_sources.py`; tag `Feature: notifications, Property 10`

- [x] 4. Backend seeding — `app/db/seed.py`
  - [x] 4.1 Add idempotent starter-template seeding
    - Add `_NOTIFICATION_TEMPLATES` (welcome / membership_expiry / payment_receipt subject+body) and `_seed_notification_templates(db, gym_id)` that inserts only missing `(event_type, channel)` pairs across `whatsapp` + `email` (six total), each `is_active=True`, leaving existing rows unchanged
    - Call `_seed_notification_templates(db, gym.id)` before the existing `db.commit()` in `run()`
    - Design: Seeding — `app/db/seed.py`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ]* 4.2 Write property test for complete, idempotent seeding
    - **Property 21: Template seeding is complete and idempotent**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - File `backend/tests/test_prop21_seed.py`; tag `Feature: notifications, Property 21`

- [x] 5. Checkpoint — backend complete
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 6. Frontend feature API — `src/features/notifications/api.ts`
  - [x] 6.1 Create the typed Axios module
    - Export `Channel`, `EventType`, `NotificationStatus` types and `NotificationTemplate`, `TemplateInput`, `NotificationLog`, `LogFilters`, `ManualSend`, `ReminderRunResult` interfaces
    - Export `listTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `listNotifications`, `sendNotification`, `runReminders` over the shared `api` instance; reuse `searchMembers` from `features/attendance/api.ts` for the member picker
    - Design: Frontend — Feature API module
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

- [x] 7. Frontend admin page — `src/pages/Notifications.tsx`
  - [x] 7.1 Build the Notifications page
    - Tabbed layout (Log default) following `Members.tsx` / `AttendanceHistory.tsx` patterns using the existing UI kit (Card, Modal, Badge, Select, table, pager)
    - Log: filter row (status / channel / event type Selects + member typeahead) that resets to page 1 on change, table with status/channel badges, pager driven by the `Page` envelope
    - Templates: table + "Add template" modal form (event type, channel, subject, body) calling `createTemplate` / `updateTemplate`, activate/deactivate toggle via `updateTemplate(id, { is_active })`, delete via `deleteTemplate`
    - Manual send: form with member typeahead, event type, channel, optional membership/payment id; submits `sendNotification` and shows returned `status` + `provider_ref`
    - Run reminders: within-days + channel form calling `runReminders`, rendering returned counts
    - Every mutating call wrapped in try/catch using `apiErrorMessage`, showing the message inline and preserving entered input
    - Design: Frontend — Notifications page
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_
  - [ ]* 7.2 Write component tests for the page
    - Cover tab render + history load, filter change triggers reload to page 1, template create/edit/deactivate modal, manual-send result display, run-reminders counts, and error-preserves-input
    - File `frontend/src/pages/Notifications.test.tsx`
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 8. Frontend route mount — `src/app/router.tsx`
  - [x] 8.1 Replace the `/app/notifications` placeholder
    - Import `NotificationsPage` and swap the `Placeholder` element for `<NotificationsPage />`; the sidebar entry is already admin-gated, so no nav change is needed
    - Design: Frontend — Notifications page (routing)
    - _Requirements: 11.1, 11.7_

- [x] 9. Checkpoint — feature complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marked `*` are optional tests and can be skipped for a faster MVP; task 1.2 is the prerequisite for every other backend test sub-task.
- Each property test realizes one design property, runs a minimum of 100 iterations, and carries the tag `Feature: notifications, Property {n}`; each lives in its own file so test tasks never conflict and can run in parallel.
- Channel senders are injected as fakes in dispatch/reminder tests to exercise dry-run, success, and failure paths without real network; the configured httpx + timeout path is optionally covered by a localhost stub in task 3.3.
- Backend (tasks 1–4) precedes the dependent frontend (tasks 6–8); the two checkpoints gate backend completion and final completion.
- Same-file edits are serialized across waves: the six `app/services/notification.py` implementation sub-tasks (2.1, 2.3, 2.5, 2.11, 2.13, 2.17) each occupy a distinct wave, and `app/api/v1/router.py` (3.2), `app/db/seed.py` (4.1), and `frontend/src/app/router.tsx` (8.1) are isolated.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.3", "2.2", "4.2"] },
    { "id": 3, "tasks": ["2.5", "2.4"] },
    { "id": 4, "tasks": ["2.11", "2.6", "2.7", "2.8", "2.9", "2.10"] },
    { "id": 5, "tasks": ["2.13", "2.12"] },
    { "id": 6, "tasks": ["2.17", "2.14", "2.15", "2.16"] },
    { "id": 7, "tasks": ["3.1", "2.18"] },
    { "id": 8, "tasks": ["3.2"] },
    { "id": 9, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "6.1"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["8.1", "7.2"] }
  ]
}
```
