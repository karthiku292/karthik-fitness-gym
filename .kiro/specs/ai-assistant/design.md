# Design Document

## Overview

This design adds an admin-only AI Business Assistant as one backend feature slice (an `assistant` router, an `assistant` service, and `assistant` schemas) and one frontend surface (the `/app/assistant` chat page plus its feature API module). An administrator asks a natural-language question about the administrator's own gym and receives a single written answer grounded in a compact, gym-scoped metrics snapshot.

The feature is **stateless and read-only**. It adds no table and introduces **no Alembic migration**; it reuses the existing reporting aggregates in `app/services/report.py`. The service takes `db` + `gym_id`, performs reads only, and the router neither commits nor writes an audit row — so processing a question creates, updates, and deletes nothing (Requirements 2.1, 2.2).

Two answer paths are selected by configuration, mirroring the never-raise provider pattern in `app/services/notification.py`:

- **AI path (configured).** When `settings.OPENAI_API_KEY` is non-empty, the service injects the snapshot into a single non-streaming chat-completions request issued over `httpx` using `settings.AI_MODEL`, with a timeout of `PROVIDER_TIMEOUT = 5.0` seconds. The system instruction tells the model to answer only from the snapshot and to decline anything it cannot answer from the snapshot.
- **Local path (unconfigured).** When `OPENAI_API_KEY` is empty, the service returns a deterministic `local_summary` built from the same snapshot, makes no network call, and marks the answer as a non-AI fallback.

A provider error or timeout degrades to a friendly HTTP 200 message rather than an error response; a failed model call never raises to the caller (Requirements 6.1, 6.2).

Languages and stack follow the codebase: the backend is Python (FastAPI + SQLAlchemy 2.0 ORM + Pydantic v2); the frontend is TypeScript + React 18 (React Router, Zustand auth store, Axios client, Tailwind UI kit).

### Decisions resolved here

1. **Injectable provider abstraction.** A small `AIProvider` protocol with one method, `complete(*, model, messages) -> str`, and one concrete implementation, `HttpAIProvider` (the single `httpx` POST). `ask(...)` accepts a `provider` argument defaulting to the module-level `DEFAULT_PROVIDER`, so tests exercise the success, error, timeout, and never-called paths with no real network — the same injection idea as `DEFAULT_SENDERS` in `notification.py`. See [Injectable provider](#injectable-provider).
2. **Snapshot reuses report aggregates.** `build_snapshot` calls `dashboard_summary`, `attendance_trend`, and `revenue_by_plan` from `app/services/report.py` (each already strictly gym-scoped and SQLite/Postgres-parity safe). No new aggregation logic is written, so the snapshot can never drift from the Reports page. See [Snapshot builder](#snapshot-builder).
3. **Compact recent-attendance window.** The snapshot carries the trailing `RECENT_ATTENDANCE_DAYS = 14` daily counts (the tail of `attendance_trend`'s 30-day series) to keep the prompt small while still conveying a recent trend.
4. **Response indicator.** The response carries a boolean `ai_configured` (the Configuration Indicator required by Requirement 4.5/7.3), a human-readable `source` of `"ai"` or `"local"`, and an optional `model`. `ai_configured` and `source` are always consistent (`ai_configured == (source == "ai")`); `source` is the label the frontend and local-fallback note read.
5. **Chat-completions endpoint.** The OpenAI-compatible endpoint URL is a module constant `CHAT_COMPLETIONS_URL` (there is no AI base-URL setting today, mirroring how the WhatsApp sender reads a fixed destination). The request body carries only `model`, `messages`, `temperature`, and `stream: false` — no `tools`/`functions` (Requirement 5.4).
6. **Statelessness / transaction ownership.** The service is read-only like `app/services/report.py`; the router performs no `commit` and writes no `audit_logs` entry, so the request persists nothing (Requirement 2.1).

## Architecture

```
Staff app (React)  —  Assistant chat page  (/app/assistant, admin-only)
  message list | input box | send -> loading -> answer | error (preserves input)
  "AI not configured — showing a data summary" note when source == "local"
        |
        |  features/assistant/api.ts  (typed Axios over /api/v1)
        v
  POST /api/v1/assistant/ask   { question, recent_messages[] }
        v
  FastAPI v1 router  (/api/v1)
  assistant.router  (prefix /assistant, dependencies=[require_admin])
        v
  app/services/assistant.py
    is_configured()  ·  build_snapshot(db, gym_id)  ·  build_messages(...)
    local_summary(snapshot, question)      ask(db, gym_id, question, recent_messages, *, provider)
                                               |                         |
                              AI_Unconfigured  |                         |  AI_Configured
                                               v                         v
                                      Local_Summary text        AIProvider.complete(model, messages)
                                   (deterministic, no network)   HttpAIProvider -> one httpx POST
                                                                 (timeout 5s; error/timeout -> friendly msg)
        v
  reads only (gym-scoped) via app/services/report.py:
    dashboard_summary · attendance_trend · revenue_by_plan     (members, payments, memberships, attendance)
  no writes · no commit · no audit row · no migration
```

Every request carries a JWT; `get_current_user` resolves the `User`, the router-level `require_admin` rejects non-admins with 403 before any handler logic, and `current_user.gym_id` scopes the snapshot. The service layer is transport-agnostic and takes `db` + `gym_id`, exactly like `app/services/report.py` and `app/services/notification.py`.

## Data Models

**No database models, tables, columns, enums, or migrations are added or changed (Requirements 2.1, 2.2).** The feature reads existing tables only, indirectly, through the `app/services/report.py` aggregates. The one in-memory structure is the Metrics_Snapshot, a plain `dict` assembled per request and discarded after the response.

### Metrics_Snapshot shape

```python
{
  "members": {"total": int, "active": int, "expired": int},   # from dashboard_summary
  "revenue_this_month": float,                                 # dashboard_summary["monthly_revenue"]
  "pending_payments": int,                                     # dashboard_summary["pending_payments"]
  "recent_attendance": [{"date": "YYYY-MM-DD", "count": int}], # tail(attendance_trend, 14)
  "revenue_by_plan": [{"plan": str, "revenue": float}],        # revenue_by_plan (current month)
}
```

Every value originates from a `report.py` aggregate computed with the administrator's `gym_id` (Requirements 3.1, 3.2, 3.3). Because `dashboard_summary` yields zeros for an empty gym, `attendance_trend` zero-fills its day series, and `revenue_by_plan` returns `[]` when the gym has no current-month paid payments, a gym with no members, payments, or attendance produces a snapshot whose counts and revenue are all zero and whose `revenue_by_plan` is empty (Requirement 3.4).

## Components and Interfaces

### Schemas — `app/schemas/assistant.py`

```python
"""Assistant ask-request and answer-response schemas (stateless; Req 4)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# The only roles a client may supply for short-term context; the system
# message is authored server-side and is never accepted from the client.
ChatRole = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)                    # Req 4.2, 4.3
    recent_messages: list[ChatMessage] = Field(default_factory=list, max_length=10)  # Req 4.4

    @field_validator("question")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():                                                   # whitespace-only == empty (Req 4.2)
            raise ValueError("question must not be blank")
        return v


class AskResponse(BaseModel):
    answer: str
    ai_configured: bool                        # Configuration Indicator (Req 4.5, 7.3)
    source: Literal["ai", "local"]             # which path produced the answer
    model: Optional[str] = None                # AI_MODEL when source == "ai", else None
```

In Pydantic v2, `Field(max_length=10)` on a `list` bounds the item count, so an 11th recent message is rejected with 422 before any handler logic runs (Requirement 4.4); `min_length`/`max_length` on `question` enforce the non-empty and 2000-character bounds (Requirements 4.2, 4.3); and the `field_validator` rejects a whitespace-only question as empty (Requirement 4.2).

### Service — `app/services/assistant.py`

Pure, read-only functions over `db` + `gym_id`, following `app/services/report.py` (no `add`/`flush`/`commit`) and the injectable-provider idea from `app/services/notification.py`.

```python
"""AI Business Assistant: gym-scoped metrics snapshot, local summary, provider call.

Stateless and read-only. build_snapshot reuses app/services/report.py aggregates;
ask() routes to a deterministic local_summary when unconfigured, or a single
httpx chat-completions call when configured, degrading any provider error/timeout
to a friendly message without ever raising (mirrors app/services/notification.py).
"""
from __future__ import annotations

import json
from typing import Optional, Protocol, Sequence

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.schemas.assistant import ChatMessage
from app.services.report import attendance_trend, dashboard_summary, revenue_by_plan

PROVIDER_TIMEOUT = 5.0                 # Provider Timeout, seconds (Req 5.3), mirrors notification.py
RECENT_ATTENDANCE_DAYS = 14           # compact tail of the 30-day attendance series
TOP_PLANS = 3                         # plans named in the local summary
CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
UNAVAILABLE_MESSAGE = (               # friendly degraded answer (Req 6.1)
    "The assistant is temporarily unavailable. Please try again in a moment."
)
SYSTEM_INSTRUCTION = (                # grounding + decline instruction (Req 5.5)
    "You are a business analytics assistant for a single gym. Answer ONLY using the "
    "figures in the JSON snapshot provided below. If the question cannot be answered "
    "from the snapshot, say that you can only answer questions about this gym's "
    "members, revenue, attendance, and membership plans. Never invent numbers."
)


# ---------------- Configuration gate (Req 4.5, 7) ----------------

def is_configured() -> bool:
    """True while AI_Configured holds: the OPENAI_API_KEY setting is non-empty."""
    return bool(settings.OPENAI_API_KEY)


# ---------------- Snapshot builder (Req 1.3, 3) ----------------

def build_snapshot(db: Session, gym_id: int) -> dict:
    """Assemble the compact, gym-scoped Metrics_Snapshot from report.py aggregates.

    Every value is sourced from a strictly gym-scoped function in
    app/services/report.py, so the snapshot can never include another gym's data
    (Req 1.3, 3.1, 3.2). An empty gym yields zero counts/revenue and an empty
    plan breakdown (Req 3.3, 3.4)."""
    summary = dashboard_summary(db, gym_id)                      # 5 gym-scoped KPIs
    attendance = attendance_trend(db, gym_id)                    # 30 daily points, zero-filled
    plans = revenue_by_plan(db, gym_id)                          # current-month, by plan
    return {
        "members": {
            "total": summary["total_members"],
            "active": summary["active_members"],
            "expired": summary["expired"],
        },
        "revenue_this_month": summary["monthly_revenue"],
        "pending_payments": summary["pending_payments"],
        "recent_attendance": attendance[-RECENT_ATTENDANCE_DAYS:],
        "revenue_by_plan": plans,
    }


# ---------------- Local summary (Req 7.2, 7.4) ----------------

def local_summary(snapshot: dict, question: str) -> str:
    """Deterministic, non-AI Answer composed from the snapshot (Req 7.2).

    A pure function of ``snapshot``: the ``question`` argument is accepted for
    interface parity with ``ask`` but does not affect the returned text, so an
    identical snapshot always yields identical text (Req 7.4)."""
    m = snapshot["members"]
    recent = snapshot["recent_attendance"]
    checkins = sum(p["count"] for p in recent)
    top = snapshot["revenue_by_plan"][:TOP_PLANS]
    plan_text = (
        ", ".join(f"{p['plan']} ({p['revenue']:.2f})" for p in top) if top else "none recorded"
    )
    return (
        f"Here is a summary of your gym from its current data. "
        f"Members: {m['total']} total, {m['active']} active, {m['expired']} expired. "
        f"Revenue this month: {snapshot['revenue_this_month']:.2f}. "
        f"Pending payments: {snapshot['pending_payments']}. "
        f"Check-ins over the last {len(recent)} days: {checkins}. "
        f"Top plans by revenue this month: {plan_text}."
    )


# ---------------- Injectable provider (Req 5, 6) ----------------

class AIProvider(Protocol):
    def complete(self, *, model: str, messages: list[dict]) -> str: ...


class HttpAIProvider:
    """One non-streaming chat-completions POST over httpx (Req 5.1, 5.3, 5.4)."""

    def complete(self, *, model: str, messages: list[dict]) -> str:
        resp = httpx.post(
            CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"model": model, "messages": messages,
                  "temperature": 0.2, "stream": False},          # no tools/functions (Req 5.4)
            timeout=PROVIDER_TIMEOUT,                             # Req 5.3
        )
        resp.raise_for_status()                                   # HTTP error -> friendly msg (Req 6.1)
        data = resp.json()
        return data["choices"][0]["message"]["content"]          # parse error -> friendly msg (Req 6.1)


DEFAULT_PROVIDER: AIProvider = HttpAIProvider()


# ---------------- Prompt assembly (Req 5.2, 1.4) ----------------

def build_messages(
    snapshot: dict, question: str, recent_messages: Sequence[ChatMessage]
) -> list[dict]:
    """Compose the chat messages: a server-authored system instruction carrying the
    snapshot, then the Recent Messages as context, then the Question. Only
    snapshot-derived business data, the question, and the supplied recent messages
    enter the request (Req 1.4, 5.2, 2.3)."""
    system = f"{SYSTEM_INSTRUCTION}\n\nSNAPSHOT:\n{json.dumps(snapshot, default=str)}"
    messages: list[dict] = [{"role": "system", "content": system}]
    messages += [{"role": m.role, "content": m.content} for m in recent_messages]
    messages.append({"role": "user", "content": question})
    return messages


# ---------------- Entry point (Req 4, 5, 6, 7) ----------------

def ask(
    db: Session, gym_id: int, question: str,
    recent_messages: Optional[Sequence[ChatMessage]] = None,
    *, provider: AIProvider = DEFAULT_PROVIDER,
) -> dict:
    """Return one Answer dict for a Question, grounded in the gym's snapshot.

    Unconfigured -> deterministic local_summary, no network call, source "local"
    (Req 7.1, 7.3). Configured -> exactly one provider.complete call using AI_MODEL,
    returning its text (Req 5.1, 5.6); any provider error/timeout degrades to the
    friendly UNAVAILABLE_MESSAGE and is never re-raised (Req 6.1, 6.2)."""
    recent = list(recent_messages or [])
    snapshot = build_snapshot(db, gym_id)                        # gym-scoped (Req 1.3)

    if not is_configured():                                      # Local path (Req 7.1)
        return {"answer": local_summary(snapshot, question),
                "ai_configured": False, "source": "local", "model": None}

    messages = build_messages(snapshot, question, recent)        # Req 5.2
    try:
        answer = provider.complete(model=settings.AI_MODEL, messages=messages)  # Req 5.1, 5.6
    except Exception:                                            # Never raise (Req 6.1, 6.2)
        answer = UNAVAILABLE_MESSAGE
    return {"answer": answer, "ai_configured": True,
            "source": "ai", "model": settings.AI_MODEL}
```

#### Snapshot builder

`build_snapshot` writes no new query logic; it composes three existing gym-scoped aggregates. Because `dashboard_summary`, `attendance_trend`, and `revenue_by_plan` each filter strictly by the passed `gym_id`, the snapshot is tenant-isolated by construction — there is no code path through which another gym's figures can enter it (Requirements 1.3, 3.1, 3.2). Reusing these functions also guarantees the assistant's numbers match the Reports/Dashboard surfaces exactly.

#### Injectable provider

`HttpAIProvider.complete` is the only place that performs I/O: a single `httpx.post` with a 5-second timeout, `raise_for_status()`, and the response parse. Both an HTTP error status and a malformed success body surface as an exception from `complete`, which `ask` catches uniformly. Because `ask` accepts a `provider` argument (default `DEFAULT_PROVIDER`), tests inject fakes:

- a **success** fake returns fixed text and records the `model`/`messages` it was called with (for the single-call, model-identity, and prompt-content assertions);
- an **error/timeout** fake raises `httpx.HTTPStatusError` / `httpx.TimeoutException` (for the graceful-degradation assertions);
- a **must-not-call** fake raises if invoked, proving the unconfigured path makes no network call;
- the real `HttpAIProvider` can be exercised against a `localhost` stub to cover the actual `httpx` + timeout construction without reaching the internet.

#### Single-call and never-raise guarantees

`ask` calls `provider.complete` exactly once on the configured path and not at all on the unconfigured path. The `try/except Exception` around that single call means a provider failure returns the friendly message in-band; no exception propagates and the endpoint still answers 200 (Requirements 5.1, 6.1, 6.2).

### Router — `app/api/v1/routers/assistant.py`

Admin-only (router-level `require_admin`), gym-scoped via `current_user.gym_id`, read-only (no `commit`, no audit write), mirroring the read-only shape of `app/api/v1/routers/reports.py`.

```python
"""Assistant endpoint: admin-only, gym-scoped, stateless question answering."""
from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, DbSession, require_admin
from app.schemas.assistant import AskRequest, AskResponse
from app.services import assistant as svc

router = APIRouter(
    prefix="/assistant",
    tags=["assistant"],
    dependencies=[Depends(require_admin)],          # Req 1.1, 8.3
)


@router.post("/ask", response_model=AskResponse)
def ask(db: DbSession, current_user: CurrentUser, body: AskRequest):
    # Read-only: no commit, no audit row -> nothing is persisted (Req 2.1).
    return svc.ask(
        db, current_user.gym_id, body.question, body.recent_messages,  # Req 1.3, 4.1, 5.2
    )
```

A non-admin is rejected with 403 and an unauthenticated caller with 401, both before the handler runs; an authorized request with a valid body returns 200 whether the answer came from the provider, the degraded message, or the local summary (Requirements 1.1, 1.2, 6.3). Invalid input (empty/oversized question, >10 recent messages) is rejected by the `AskRequest` schema with 422 and no answer (Requirements 4.2, 4.3, 4.4).

#### Router registration — `app/api/v1/router.py`

Add `assistant` to the `from app.api.v1.routers import (...)` block and `api_router.include_router(assistant.router)` in the reserved `# ai` slot, so the endpoint is reachable at `/api/v1/assistant/ask` (Requirements 8.1, 8.2).

### API Endpoints

| Method & path | Auth | Purpose | Requirements |
|---|---|---|---|
| `POST /api/v1/assistant/ask` | `require_admin` | Answer one gym-scoped question from the snapshot | 1.1, 4.1–4.5, 5.x, 6.x, 7.x, 8.2 |

Request body: `{ "question": string(1..2000), "recent_messages"?: [{ "role": "user"|"assistant", "content": string(1..2000) }] (<=10) }`.
Response body: `{ "answer": string, "ai_configured": boolean, "source": "ai"|"local", "model": string|null }`.

## Frontend Design

### Feature API module — `src/features/assistant/api.ts`

Thin typed wrappers over the shared `api` Axios instance, following `features/reports/api.ts` and `features/notifications/api.ts`.

```typescript
import { api } from "@/lib/api";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AskRequest {
  question: string;
  recent_messages: ChatMessage[];
}

export interface AskResponse {
  answer: string;
  ai_configured: boolean;
  source: "ai" | "local";
  model: string | null;
}

export async function askAssistant(input: AskRequest): Promise<AskResponse> {
  const { data } = await api.post<AskResponse>("/assistant/ask", input);
  return data;
}
```

### Assistant chat page — new `src/pages/Assistant.tsx` (replaces the placeholder)

Routing: in `src/app/router.tsx`, replace `{ path: "assistant", element: <Placeholder title="AI Business Assistant" phase="Phase 8" /> }` with `<AssistantPage />` (Requirement 9.1). The sidebar entry (`/app/assistant`, `Bot` icon) is already gated to `roles: ["admin"]` in `components/layout/Sidebar.tsx`, so it stays hidden for non-admins and no nav change is needed (Requirement 9.7).

The page reuses the UI kit (`Card`, `Button`, `Input`, `EmptyState`, `ErrorState`, `Badge`) and `apiErrorMessage` from `@/lib/api`, and holds all conversation state in component memory (nothing persisted, matching the stateless backend):

- **Message list** — an array of `ChatMessage` turns (`user` / `assistant`) rendered as a scrolling transcript; an `EmptyState` prompts for the first question when empty.
- **Input + send** — a text input bound to component state and a `Button`. On submit the page appends the user's turn, captures up to the last 10 prior turns as `recent_messages`, sets a loading flag, and calls `askAssistant` (Requirement 9.2). While the request is in flight the send button shows its `loading` spinner and is disabled (Requirement 9.3).
- **Answer** — on success the returned `answer` is appended as an `assistant` turn and rendered (Requirement 9.4).
- **Error (preserves input)** — on failure the page shows an inline `ErrorState`/message via `apiErrorMessage(err)` and keeps the user's typed question in the input (it is not cleared until a successful send), so the administrator can retry without retyping (Requirement 9.5).
- **No-AI note** — when the latest response has `source === "local"` (equivalently `ai_configured === false`), a visible `Badge`/banner reads that the assistant is operating without AI configuration and is showing a data summary (Requirement 9.6).

A minimal `useState`/`async` submit handler (no new data library) matches the page conventions in `Reports.tsx` and `Members.tsx`.

## Error Handling

| Condition | Backend behavior | Frontend behavior |
|---|---|---|
| Non-admin role | 403 via `require_admin`, no answer (1.1) | `apiErrorMessage` surfaces 403; entry hidden anyway (9.7) |
| Missing/invalid token | 401 from `get_current_user` (1.2) | Axios refresh-or-logout flow |
| Empty/whitespace-only question | 422 from `AskRequest` validator, no answer (4.2) | Inline error; input preserved (9.5) |
| Question > 2000 chars | 422 from Pydantic, no answer (4.3) | Inline error; input preserved (9.5) |
| More than 10 recent messages | 422 from Pydantic, no answer (4.4) | Client caps `recent_messages` at 10, so this is defensive |
| AI unconfigured (`OPENAI_API_KEY` empty) | 200 + local summary, `source` `local`, no network (7.1) | Answer renders + "no AI configuration" note (9.6) |
| Provider HTTP error / timeout / malformed body | 200 + friendly `UNAVAILABLE_MESSAGE`, no exception (6.1, 6.2) | Answer renders as an assistant turn |
| Provider success | 200 + provider text, `source` `ai` (5.6, 6.3) | Answer renders as an assistant turn |
| Network failure to our own API | n/a | `apiErrorMessage` shows "cannot reach server"; input preserved (9.5) |

The provider failure is confined to the single `try/except` around `provider.complete`: it is swallowed, the friendly message is returned, and the endpoint answers 200 (Requirements 6.1, 6.2, 6.3).

## Security, RBAC, and Multi-Tenancy

- **Admin-only (1.1, 8.3):** the router-level `dependencies=[Depends(require_admin)]` rejects every non-admin with 403 before the handler runs. A missing or invalid token yields 401 from `get_current_user` (1.2).
- **Tenancy — no cross-gym data in the prompt (1.3, 1.4):** the snapshot is built solely from `current_user.gym_id` through report aggregates that each filter by that `gym_id`; there is no parameter or code path by which another gym's figures can enter `build_snapshot`. `build_messages` composes the request from only the snapshot, the question, and the supplied recent messages — so the provider request carries only this gym's business data (1.4, 5.2). No raw member PII (names, phones, emails) is placed in the snapshot; only counts and aggregated revenue/attendance are included.
- **Statelessness (2.1, 2.2, 2.3):** the service performs reads only; the router does not `commit` and writes no audit row, so a request persists nothing. Recent messages exist only for the duration of the single call and are never stored. No table or migration is added.
- **Secrets:** the `OPENAI_API_KEY` is read only from `settings` (env) and sent only in the `Authorization` header to `CHAT_COMPLETIONS_URL`; it never appears in the snapshot, the response, logs, or the frontend.

## Testing Strategy

**Dual approach.** Property-based tests (minimum 100 iterations each, tagged `Feature: ai-assistant, Property {n}: {text}`) cover the universal backend logic in [Correctness Properties](#correctness-properties). The provider is an injected fake, so no test touches the network:

- a **capturing success fake** records the `model` and `messages` and returns arbitrary text — used for the single-call/model-identity, prompt-content, and "returns provider text" properties;
- **error/timeout fakes** raise `httpx.HTTPStatusError` / `httpx.TimeoutException` — used for the graceful-degradation property;
- a **must-not-call fake** raises if invoked — used to prove the unconfigured path makes no network call.

Configuration is toggled by setting/clearing `settings.OPENAI_API_KEY` (and asserting `is_configured()` follows). Snapshot gym-scoping is tested by seeding two or more gyms and asserting gym A's snapshot equals A's `report.py` aggregates while excluding B's distinguishing figures. Statelessness is tested by snapshotting all table row counts before and after a request on each path and asserting no change.

**Example / edge tests** cover the fixed request construction and shapes that do not vary with input: the timeout equals `PROVIDER_TIMEOUT` and the request body omits `tools`/`functions` (5.3, 5.4); the system message contains the grounding/decline instruction (5.5); the single-JSON response shape (4.1); an authorized valid request returns 200 in both modes (6.3); the question-length boundary (2000 accepted, 2001 rejected) and the recent-messages boundary (10 accepted, 11 rejected) (4.3, 4.4); and the empty-gym snapshot zeros (3.4).

**Structural items** — router registration in the `ai` slot and reachability at `/api/v1/assistant/ask` (8.1, 8.2) and the no-migration guarantee (2.2) — are verified by a route test and by confirming the `alembic/versions` set is unchanged.

**Frontend criteria (Requirement 9)** are verified with component/example tests, not property tests: the page renders in place of the placeholder (9.1); submitting sends the question plus session recent messages (9.2); a loading indicator shows while pending (9.3); the answer renders on success (9.4); a failure shows an error and preserves the input (9.5); a `source === "local"` response renders the no-AI note (9.6); and the sidebar hides the entry for non-admin roles (9.7).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: The snapshot is gym-scoped and mirrors the report aggregates

For any backing data spread across two or more gyms, `build_snapshot(db, gym_id)` produces member totals, this-month revenue, pending-payment count, recent daily attendance, and current-month revenue-by-plan whose values equal `dashboard_summary`, `attendance_trend` (trailing window), and `revenue_by_plan` computed for that same `gym_id`, and contains no value that belongs only to another gym.

**Validates: Requirements 1.3, 3.1, 3.2, 3.3**

### Property 2: An empty gym yields a zeroed snapshot

For any gym with no members, no payments, and no attendance, the snapshot's member totals, this-month revenue, and pending-payment count are all zero and its revenue-by-plan list is empty.

**Validates: Requirements 3.4**

### Property 3: The provider request carries only snapshot data, the question, and recent messages

For any question, any list of up to ten recent messages, and any two gyms, the messages passed to the provider include the gym's snapshot, the question, and each supplied recent message in order, and contain no figure that belongs only to another gym.

**Validates: Requirements 1.4, 2.3, 5.2**

### Property 4: The Configuration Indicator reflects the configured state

For any configuration state, the response's `ai_configured` is true exactly when `OPENAI_API_KEY` is non-empty and false otherwise, and `source` equals `"ai"` when `ai_configured` is true and `"local"` when it is false.

**Validates: Requirements 4.5, 7.3**

### Property 5: When unconfigured, the answer is the local summary and no network call is made

For any question while `OPENAI_API_KEY` is empty, `ask` returns the text produced by `local_summary` for the gym's snapshot, reports `source` `"local"`, and invokes the provider zero times.

**Validates: Requirements 7.1**

### Property 6: The local summary is deterministic for a given snapshot

For any snapshot and any two questions, `local_summary` returns identical text across repeated calls with that snapshot, independent of the question.

**Validates: Requirements 7.4**

### Property 7: The local summary reports the snapshot's headline figures

For any snapshot, the `local_summary` text includes the member totals, the this-month revenue, a recent-attendance figure derived from the snapshot's attendance points, and the snapshot's top plans by revenue (or a no-plans indication when the breakdown is empty).

**Validates: Requirements 7.2**

### Property 8: When configured and the provider succeeds, exactly one call returns the provider's text

For any question while `OPENAI_API_KEY` is non-empty and the provider returns text, `ask` invokes the provider exactly once with `model` equal to `AI_MODEL`, and the returned answer equals the provider's text.

**Validates: Requirements 5.1, 5.6**

### Property 9: A provider error or timeout degrades to a friendly answer without raising

For any provider failure while configured — an HTTP error status, a timeout, or a malformed success body — `ask` returns normally with the fixed unavailable message as the answer, reports `source` `"ai"`, and propagates no exception.

**Validates: Requirements 6.1, 6.2**

### Property 10: Processing a question persists nothing

For any question on any path (configured success, provider failure, or unconfigured local summary), the row count of every database table is identical before and after the request.

**Validates: Requirements 2.1**

### Property 11: Invalid input is rejected with 422 and produces no answer

For any request whose question is empty or whitespace-only, whose question exceeds 2000 characters, or whose `recent_messages` list has more than ten entries, the endpoint responds with HTTP 422 and returns no answer.

**Validates: Requirements 4.2, 4.3, 4.4**

### Property 12: Access is admin-only and token-gated

For any authenticated user whose role is not `admin`, `POST /assistant/ask` returns HTTP 403 and produces no answer; a request with no valid access token returns HTTP 401.

**Validates: Requirements 1.1, 1.2, 8.3**
