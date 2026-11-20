# Implementation Plan: AI Business Assistant

## Overview

This plan implements the admin-only, stateless AI Business Assistant from `design.md`. Work is sequenced backend-first: the request/response schemas, then the `app/services/assistant.py` service built in four same-file slices (snapshot → local summary → provider/prompt → `ask` entry point), then the admin-only router and its registration in the reserved `# ai` slot, and finally the frontend feature API, chat page, and route mount.

Because several sub-tasks edit the same file, same-file edits are placed in different waves: the four `app/services/assistant.py` slices are strictly serialized (2.1 → 2.4 → 2.7 → 2.9), and the frontend chat page (5.2) precedes both its component test (5.3) and the `router.tsx` mount (5.4). Each backend correctness property gets its own test file so the twelve property/integration tests never collide on a shared file.

Test sub-tasks are marked optional with `*`. The twelve correctness properties from the design are realized as ten property-based tests (Properties 1–10, service layer) plus one router integration test (Properties 11–12), with a frontend component/smoke test for the page. `hypothesis` is not yet installed, so task 1.2 adds and installs it and lays down the shared `backend/tests/` fixtures and injected fake providers (no test touches the network).

## Tasks

- [x] 1. Backend schemas and test tooling
  - [x] 1.1 Implement assistant request/response schemas
    - Create `backend/app/schemas/assistant.py` with `ChatRole = Literal["user","assistant"]`, `ChatMessage` (`role: ChatRole`, `content: str` constrained `min_length=1, max_length=2000`), `AskRequest` (`question: str` constrained `min_length=1, max_length=2000` plus a `field_validator` rejecting whitespace-only input, and `recent_messages: list[ChatMessage]` with `Field(default_factory=list, max_length=10)`), and `AskResponse` (`answer: str`, `ai_configured: bool`, `source: Literal["ai","local"]`, `model: Optional[str] = None`)
    - The `max_length=10` on the list bounds item count (422 before handler logic); `min_length`/`max_length`/validator bound the question
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 7.3 — Design: Schemas — `app/schemas/assistant.py`_
  - [ ]* 1.2 Set up backend property-test tooling and shared fixtures
    - Add `hypothesis` to `backend/requirements.txt` and install it into the backend virtualenv (`pytest`/`pytest-asyncio` are already present)
    - Create `backend/tests/__init__.py` and `backend/tests/conftest.py` providing: a SQLite test engine with `Base.metadata.create_all`, a `Session` fixture, a `TestClient` with `get_db` overridden, two seeded gyms (members, payments, memberships/plans, attendance) with known report aggregates, an admin user + token and a non-admin (trainer) user + token, an `OPENAI_API_KEY` toggle helper (monkeypatch `settings.OPENAI_API_KEY` and assert `is_configured()` follows), hypothesis strategies for questions/recent-messages/snapshots, and injected fake `AIProvider`s — a capturing-success fake (records `model`/`messages`), error and timeout fakes (`httpx.HTTPStatusError`/`httpx.TimeoutException`), and a must-not-call fake
    - _Design: Testing Strategy — `backend/requirements.txt`, `backend/tests/conftest.py`_

- [x] 2. Implement the assistant service (`app/services/assistant.py`)
  - [x] 2.1 Create the service module, constants, config gate, and snapshot builder
    - Create `backend/app/services/assistant.py` with the module docstring, `from __future__ import annotations`, imports (`json`, `Protocol`/`Sequence`/`Optional`, `httpx`, `Session`, `settings`, `ChatMessage`, and `dashboard_summary`/`attendance_trend`/`revenue_by_plan` from `app/services/report.py`), and the constants `PROVIDER_TIMEOUT = 5.0`, `RECENT_ATTENDANCE_DAYS = 14`, `TOP_PLANS = 3`, `CHAT_COMPLETIONS_URL`, `UNAVAILABLE_MESSAGE`, `SYSTEM_INSTRUCTION`
    - Implement `is_configured()` returning `bool(settings.OPENAI_API_KEY)`
    - Implement `build_snapshot(db, gym_id)` reusing the three report aggregates (read-only, strictly gym-scoped) and assembling the Metrics_Snapshot dict (members total/active/expired, `revenue_this_month`, `pending_payments`, trailing `RECENT_ATTENDANCE_DAYS` of attendance, `revenue_by_plan`)
    - _Requirements: 1.3, 3.1, 3.2, 3.3, 3.4, 4.5, 7.3 — Design: Service, Snapshot builder — `app/services/assistant.py`_
  - [ ]* 2.2 Property test — snapshot is gym-scoped and mirrors the report aggregates
    - **Property 1: The snapshot is gym-scoped and mirrors the report aggregates**
    - Seed two gyms; assert gym A's snapshot values equal `dashboard_summary`/`attendance_trend` (trailing 14) /`revenue_by_plan` for A and contain no value belonging only to B. File: `backend/tests/test_assistant_snapshot_scope.py`
    - **Validates: Requirements 1.3, 3.1, 3.2, 3.3**
  - [ ]* 2.3 Property test — an empty gym yields a zeroed snapshot
    - **Property 2: An empty gym yields a zeroed snapshot**
    - For a gym with no members/payments/attendance, assert member totals, this-month revenue, and pending-payment count are zero and `revenue_by_plan` is empty. File: `backend/tests/test_assistant_snapshot_empty.py`
    - **Validates: Requirements 3.4**
  - [x] 2.4 Implement the deterministic local summary
    - Add `local_summary(snapshot, question)` to `app/services/assistant.py`: a pure function of `snapshot` (the `question` is accepted for parity but unused) composing text that reports member totals, this-month revenue, pending payments, recent check-ins over the snapshot window, and top `TOP_PLANS` plans by revenue (or a no-plans indication)
    - _Requirements: 7.2, 7.4 — Design: Local summary — `app/services/assistant.py`_
  - [ ]* 2.5 Property test — the local summary is deterministic for a given snapshot
    - **Property 6: The local summary is deterministic for a given snapshot**
    - For any snapshot and any two questions, repeated `local_summary` calls return identical text, independent of the question. File: `backend/tests/test_assistant_local_determinism.py`
    - **Validates: Requirements 7.4**
  - [ ]* 2.6 Property test — the local summary reports the snapshot's headline figures
    - **Property 7: The local summary reports the snapshot's headline figures**
    - For any snapshot, the text includes member totals, this-month revenue, a recent-attendance figure derived from the attendance points, and the top plans (or a no-plans indication). File: `backend/tests/test_assistant_local_figures.py`
    - **Validates: Requirements 7.2**
  - [x] 2.7 Implement the injectable provider and prompt assembly
    - Add to `app/services/assistant.py`: the `AIProvider` `Protocol` (`complete(*, model, messages) -> str`), `HttpAIProvider` performing one non-streaming `httpx.post` to `CHAT_COMPLETIONS_URL` with the bearer header, body `{model, messages, temperature, stream: False}` (no `tools`/`functions`), `timeout=PROVIDER_TIMEOUT`, `raise_for_status()`, and message-content parse; the module-level `DEFAULT_PROVIDER = HttpAIProvider()`; and `build_messages(snapshot, question, recent_messages)` that emits a server-authored system message carrying `SYSTEM_INSTRUCTION` + the JSON snapshot, then the recent messages in order, then the question
    - _Requirements: 1.4, 2.3, 5.2, 5.3, 5.4, 5.5 — Design: Injectable provider, Prompt assembly — `app/services/assistant.py`_
  - [ ]* 2.8 Property test — the provider request carries only snapshot data, the question, and recent messages
    - **Property 3: The provider request carries only snapshot data, the question, and recent messages**
    - For any question, up to ten recent messages, and two gyms, the messages from `build_messages` include the gym's snapshot, the question, and each recent message in order, and contain no figure belonging only to another gym. File: `backend/tests/test_assistant_prompt.py`
    - **Validates: Requirements 1.4, 2.3, 5.2**
  - [x] 2.9 Implement the `ask` entry point (routing + never-raise dispatch)
    - Add `ask(db, gym_id, question, recent_messages=None, *, provider=DEFAULT_PROVIDER)`: build the gym snapshot; when unconfigured return the `local_summary` with `source="local"`, `ai_configured=False`, `model=None`, and make no network call; when configured call `provider.complete(model=settings.AI_MODEL, messages=build_messages(...))` exactly once, wrapping it in `try/except Exception` so any error/timeout/malformed body degrades to `UNAVAILABLE_MESSAGE` without raising, returning `source="ai"`, `ai_configured=True`, `model=settings.AI_MODEL`
    - _Requirements: 4.1, 4.5, 5.1, 5.6, 6.1, 6.2, 7.1, 7.3 — Design: Entry point, Single-call and never-raise guarantees — `app/services/assistant.py`_
  - [ ]* 2.10 Property test — the Configuration Indicator reflects the configured state
    - **Property 4: The Configuration Indicator reflects the configured state**
    - For any configuration state, `ai_configured` is true exactly when `OPENAI_API_KEY` is non-empty, and `source` is `"ai"` iff `ai_configured` is true else `"local"`. File: `backend/tests/test_assistant_config_indicator.py`
    - **Validates: Requirements 4.5, 7.3**
  - [ ]* 2.11 Property test — when unconfigured, the answer is the local summary and no network call is made
    - **Property 5: When unconfigured, the answer is the local summary and no network call is made**
    - While `OPENAI_API_KEY` is empty, `ask` returns `local_summary` text, reports `source="local"`, and invokes the must-not-call fake provider zero times. File: `backend/tests/test_assistant_local_path.py`
    - **Validates: Requirements 7.1**
  - [ ]* 2.12 Property test — configured success: exactly one call returns the provider's text
    - **Property 8: When configured and the provider succeeds, exactly one call returns the provider's text**
    - While configured, `ask` invokes the capturing-success fake exactly once with `model == AI_MODEL`, and the returned answer equals the provider's text. File: `backend/tests/test_assistant_provider_success.py`
    - **Validates: Requirements 5.1, 5.6**
  - [ ]* 2.13 Property test — a provider error or timeout degrades to a friendly answer without raising
    - **Property 9: A provider error or timeout degrades to a friendly answer without raising**
    - For an error-status fake, a timeout fake, and a malformed-body fake, `ask` returns normally with `UNAVAILABLE_MESSAGE`, reports `source="ai"`, and propagates no exception. File: `backend/tests/test_assistant_provider_failure.py`
    - **Validates: Requirements 6.1, 6.2**
  - [ ]* 2.14 Property test — processing a question persists nothing
    - **Property 10: Processing a question persists nothing**
    - For a question on each path (configured success, provider failure, unconfigured local), the row count of every table is identical before and after calling `ask`. File: `backend/tests/test_assistant_stateless.py`
    - **Validates: Requirements 2.1**

- [x] 3. Expose the assistant endpoint
  - [x] 3.1 Implement the admin-only, gym-scoped router
    - Create `backend/app/api/v1/routers/assistant.py` with `APIRouter(prefix="/assistant", tags=["assistant"], dependencies=[Depends(require_admin)])` and `POST /ask` → `response_model=AskResponse` that returns `svc.ask(db, current_user.gym_id, body.question, body.recent_messages)`; the handler performs no `commit` and writes no audit row (401 comes from `get_current_user`, 403 from `require_admin`, 422 from `AskRequest`)
    - _Requirements: 1.1, 1.2, 2.1, 4.1, 8.3 — Design: Router — `app/api/v1/routers/assistant.py`_
  - [x] 3.2 Register the router in the v1 API
    - In `backend/app/api/v1/router.py`, add `assistant` to the `from app.api.v1.routers import (...)` block and add `api_router.include_router(assistant.router)` in the reserved `# ai` slot so the endpoint is reachable at `/api/v1/assistant/ask`
    - _Requirements: 8.1, 8.2 — Design: Router registration — `app/api/v1/router.py`_
  - [ ]* 3.3 Integration test — router auth and input validation
    - **Property 11: Invalid input is rejected with 422 and produces no answer**
    - **Property 12: Access is admin-only and token-gated**
    - Using `TestClient`: non-admin token → 403 and no answer; no/invalid token → 401; authorized valid request → 200 in both configured (success fake) and unconfigured modes; empty/whitespace-only question → 422; question > 2000 chars → 422; `recent_messages` with > 10 entries → 422; and the route resolves at `/api/v1/assistant/ask`. File: `backend/tests/test_assistant_api.py`
    - **Validates: Requirements 1.1, 1.2, 4.2, 4.3, 4.4, 6.3, 8.1, 8.2, 8.3**

- [x] 4. Checkpoint — backend
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 5. Frontend assistant surface
  - [x] 5.1 Implement the feature API module
    - Create `frontend/src/features/assistant/api.ts` exporting `ChatRole`, `ChatMessage`, `AskRequest`, `AskResponse` types (mirroring the backend contract, including `ai_configured`/`source`/`model`) and `askAssistant(input)` that POSTs to `/assistant/ask` via the shared `api` Axios instance and returns `data`
    - _Requirements: 9.2 — Design: Feature API module — `frontend/src/features/assistant/api.ts`_
  - [x] 5.2 Implement the Assistant chat page
    - Create `frontend/src/pages/Assistant.tsx` exporting `AssistantPage`: holds the transcript (`user`/`assistant` turns) in component state (nothing persisted); on submit append the user turn, send the question plus up to the last 10 prior turns as `recent_messages`, show a loading indicator on the disabled send button while in flight, append the returned `answer` as an assistant turn on success, on failure show an inline error via `apiErrorMessage` and preserve the typed question, and when the latest response has `source === "local"` show a visible note that the assistant is operating without AI configuration
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6 — Design: Assistant chat page — `frontend/src/pages/Assistant.tsx`_
  - [ ]* 5.3 Component/smoke test for the Assistant page
    - With vitest + Testing Library (mock `askAssistant`): the page renders; submitting a question calls the API with the question and session recent messages and renders the returned answer; a failing request shows an error and preserves the input; and a `source === "local"` response renders the local-fallback note. File: `frontend/src/pages/Assistant.test.tsx`
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6 — Design: Testing Strategy (frontend)_
  - [x] 5.4 Mount the Assistant page and restore the Notifications route
    - In `frontend/src/app/router.tsx`, import `AssistantPage` from `@/pages/Assistant` and `NotificationsPage` from `@/pages/Notifications`; replace the `/app/assistant` placeholder with `{ path: "assistant", element: <AssistantPage /> }` and the `/app/notifications` placeholder with `{ path: "notifications", element: <NotificationsPage /> }` (the admin-only sidebar entry is already gated, so no nav change is needed — Requirement 9.7)
    - _Requirements: 9.1 — Design: Routing — `frontend/src/app/router.tsx`_

- [x] 6. Checkpoint — full stack
  - Ensure all backend and frontend tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests and test tooling) and can be skipped for a faster MVP; core implementation tasks are never optional.
- The four `app/services/assistant.py` slices (2.1 → 2.4 → 2.7 → 2.9) edit the same file and are serialized into separate waves; each slice's property tests live in their own files in the next wave.
- Property tests use the injected fake providers from `conftest.py`, so no test performs real network I/O; configuration is toggled by setting/clearing `settings.OPENAI_API_KEY`.
- Each property-based test must run a minimum of 100 iterations and carry the tag `Feature: ai-assistant, Property {n}: {property text}` referencing the design property it validates.
- The feature adds no database table and no Alembic migration (Requirements 2.1, 2.2); the service is read-only and the router neither commits nor writes an audit row.
- Properties 1–10 are covered by the service-layer property tests (2.2–2.14); Properties 11–12 are covered by the router integration test (3.3).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["2.8", "2.9"] },
    { "id": 5, "tasks": ["2.10", "2.11", "2.12", "2.13", "2.14", "3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3", "5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["5.3", "5.4"] }
  ]
}
```
