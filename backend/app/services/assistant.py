"""AI Business Assistant: gym-scoped metrics snapshot, local summary, provider call.

Stateless and read-only. build_snapshot reuses app/services/report.py aggregates;
ask() routes to a deterministic local_summary when unconfigured, or a single
httpx chat-completions call when configured, degrading any provider error/timeout
to a friendly message without ever raising (mirrors app/services/notification.py).

Built incrementally across tasks: this slice lays down the module scaffold, the
shared constants, the is_configured() gate, and the build_snapshot() builder; the
local summary, the injectable provider + prompt assembly, and the ask() entry point
are appended by later slices.
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
RECENT_ATTENDANCE_DAYS = 14            # compact tail of the 30-day attendance series
TOP_PLANS = 3                          # plans named in the local summary
CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
UNAVAILABLE_MESSAGE = (                # friendly degraded answer (Req 6.1)
    "The assistant is temporarily unavailable. Please try again in a moment."
)
SYSTEM_INSTRUCTION = (                 # grounding + decline instruction (Req 5.5)
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
    """One non-streaming chat-completions POST over httpx (Req 5.1, 5.3, 5.4).

    Mirrors the single-request sender shape in app/services/notification.py:
    one httpx.post with a bearer header and PROVIDER_TIMEOUT, raise_for_status(),
    then a parse of the assistant message text. No tools/functions are sent
    (Req 5.4). Both an HTTP error status and a malformed success body surface as
    an exception, which ask() (task 2.9) catches to degrade gracefully."""

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
    enter the request, so no raw cross-gym data can reach the provider
    (Req 1.4, 5.2, 2.3)."""
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

    Routing + never-raise dispatch (the final service slice). The snapshot is
    always built first and is strictly gym-scoped (Req 1.3). When AI_Unconfigured
    holds the answer is the deterministic local_summary, no network call is made,
    and the Configuration Indicator is false with source "local" (Req 7.1, 7.3).
    When AI_Configured holds, provider.complete is invoked exactly once using
    AI_MODEL and its text is returned (Req 5.1, 5.6); any provider error, timeout,
    or malformed body is caught and degraded to the friendly UNAVAILABLE_MESSAGE
    so the call never raises and the endpoint still answers 200 (Req 6.1, 6.2).

    Returns an Answer dict shaped for AskResponse: ``answer``, ``ai_configured``,
    ``source`` ("ai"/"local"), and ``model`` (AI_MODEL when source is "ai", else
    None). Read-only: nothing is persisted (Req 2.1)."""
    recent = list(recent_messages or [])
    snapshot = build_snapshot(db, gym_id)                        # gym-scoped (Req 1.3)

    if not is_configured():                                      # Local path — no network (Req 7.1)
        return {"answer": local_summary(snapshot, question),
                "ai_configured": False, "source": "local", "model": None}

    messages = build_messages(snapshot, question, recent)        # Req 5.2
    try:
        answer = provider.complete(model=settings.AI_MODEL, messages=messages)  # one call (Req 5.1, 5.6)
    except Exception:                                            # Never raise (Req 6.1, 6.2)
        answer = UNAVAILABLE_MESSAGE
    return {"answer": answer, "ai_configured": True,
            "source": "ai", "model": settings.AI_MODEL}
