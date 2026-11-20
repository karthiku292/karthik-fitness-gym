# Design Document

## Overview

This design adds member notifications to the Gym Management System as one backend feature slice (a `notifications` router, a `notification` service, and `notification` schemas), an idempotent seeding addition, and one frontend surface (the `/app/notifications` admin page plus its feature API module).

The feature reuses the existing `notifications` and `notification_templates` tables declared in `app/models/notification.py` and registered in `app/models/__init__.py`, so **no database migration is introduced**. It is admin-only and strictly gym-scoped: every query filters by the authenticated administrator's `gym_id`, and every persisted row is stamped with it.

Delivery degrades independently per channel. When a channel has no credentials, dispatch runs as a **dry-run** — no network call, recorded as `sent` with a synthetic `provider_ref`. When a channel is configured but the provider errors or times out, the attempt is recorded as `failed` with a captured message and control returns normally; a provider failure is **never** raised to the caller. There is no background scheduler and no automatic event hooks — every notification originates from an explicit admin action (manual send or run-reminders).

Languages and stack follow the codebase: the backend is Python (FastAPI + SQLAlchemy 2.0 ORM + Pydantic v2); the frontend is TypeScript + React 18 (React Router, Zustand auth store, Axios client, Tailwind UI kit).

### Decisions resolved here

1. **Channel-sender abstraction.** A small `ChannelSender` interface with two concrete implementations (`WhatsAppSender`, `EmailSender`). Each owns its own config check, destination extraction, and the single I/O call. Senders are injected into `dispatch`/`run_expiry_reminders` (default `DEFAULT_SENDERS`), so tests exercise dry-run, success, and failure paths without real network. See [Channel-sender abstraction](#channel-sender-abstraction).
2. **Rendering engine.** A regex substitution over `{dotted.key}` placeholders against a flat context built from the Context Sources. Unknown keys resolve to an empty string, and no placeholder token survives. `str.format` is deliberately avoided because it raises on missing keys and stray braces. See [Template rendering](#template-rendering).
3. **HTTP/SMTP libraries.** `httpx` (already a backend dependency, `requirements.txt`) for the WhatsApp HTTP POST; `smtplib` + `email.message` (stdlib) for email. Both use a 5-second timeout.
4. **Manual-send request shape.** `member_id` is required; the caller supplies **either** `template_id` **or** (`event_type` + `channel`), enforced by a Pydantic validator. Optional `membership_id` / `payment_id` add context. See [Schemas](#schemas--appschemasnotificationpy).
5. **Member picker reuse.** The manual-send member search reuses the existing `GET /api/v1/attendance/member-search` (gated `require_staff`, which admins satisfy) rather than adding a duplicate endpoint.
6. **Transaction ownership.** The service layer `flush`es; the router `commit`s and writes the `audit_logs` entry via `log_action`, matching the attendance router.

## Architecture

```
Staff app (React)  —  Notifications admin page  (/app/notifications, admin-only)
  Log table (filters + pager) | Templates CRUD | Manual send | Run reminders
        |                         |                 |              |
        |  features/notifications/api.ts (typed Axios over /api/v1)
        v                         v                 v              v
  GET /notifications   GET/POST/PUT/DELETE     POST /notifications POST /notifications
                       /notifications/templates   /send              /run-reminders
        \________________________|_________________|______________/
                                 v
                    FastAPI v1 router  (/api/v1)
                    notifications.router  (prefix /notifications, require_admin)
                                 v
                    app/services/notification.py
      resolve_template · build_context · render · dispatch (1 row, queued->sent/failed)
      channel senders (WhatsApp httpx / Email smtplib) · run_expiry_reminders · list_notifications
                                 v                              + app/services/audit.log_action
      SQLAlchemy ORM -> notification_templates , notifications  (existing tables, no migration)
                     reads: members , gyms , memberships , payments  (Context Sources, gym-scoped)
```

Every request carries a JWT; `get_current_user` resolves the `User`, `require_admin` rejects non-admins with 403 before any handler logic, and `user.gym_id` scopes every query and every write. The service layer is transport-agnostic and takes `db` + `gym_id`, exactly like `app/services/attendance.py`.

## Data Models

### Reused tables (unchanged, no migration)

Both tables already exist in `app/models/notification.py` with every column this feature needs; no model edits and no Alembic revision are added (Requirements 2.1, 2.2).

`NotificationTemplate` (table `notification_templates`): `id`, `gym_id` (FK `gyms.id`, indexed), `event_type` (`String(60)`), `channel` (`NotificationChannel` enum: `whatsapp`/`email`), `subject` (`String(200)`, nullable), `body` (`String(2000)`), `is_active` (bool, default true), plus `created_at`/`updated_at` from `TimestampMixin`.

`Notification` (table `notifications`): `id`, `gym_id` (FK, indexed), `member_id` (nullable FK `members.id`), `channel` (`NotificationChannel`), `event_type` (`String(60)`), `status` (`NotificationStatus` enum: `queued`/`sent`/`failed`, default `queued`, indexed), `provider_ref` (`String(120)`, nullable), `error` (`String(500)`, nullable), `sent_at` (tz datetime, nullable), `payload` (JSON, default `{}`), plus timestamps.

The `NotificationStatus` and `NotificationChannel` enums already pin the allowed `status` and `channel` values (Requirement 2.3); the model's `String(200)`/`String(2000)` columns back the subject/body length limits.

**Event type is validated at the schema layer.** The column is a free `String(60)`, but Requirement 3.2 restricts it to the three Standardized Event Types. A `Literal` in the schema enforces this without touching the model or the database.

## Components and Interfaces

### Schemas — `app/schemas/notification.py`

```python
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.enums import NotificationChannel, NotificationStatus

# Standardized Event Types (Req 3.2). Kept in the schema layer so the reused
# String(60) column needs no change.
EventType = Literal["welcome", "membership_expiry", "payment_receipt"]


class TemplateBase(BaseModel):
    event_type: EventType
    channel: NotificationChannel
    subject: Optional[str] = Field(default=None, max_length=200)   # Req 3.3
    body: str = Field(min_length=1, max_length=2000)               # Req 3.3


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    event_type: Optional[EventType] = None
    channel: Optional[NotificationChannel] = None
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None                               # Req 3.6


class TemplateOut(TemplateBase):
    id: int
    gym_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    """Log/row projection; member_name joined in for the table (Req 8)."""
    id: int
    gym_id: int
    member_id: Optional[int] = None
    member_name: Optional[str] = None
    channel: NotificationChannel
    event_type: str
    status: NotificationStatus
    provider_ref: Optional[str] = None
    error: Optional[str] = None
    sent_at: Optional[datetime] = None
    created_at: datetime


class ManualSendRequest(BaseModel):
    """member_id + exactly one of {template_id} or {event_type + channel}."""
    member_id: int
    template_id: Optional[int] = None
    event_type: Optional[EventType] = None
    channel: Optional[NotificationChannel] = None
    membership_id: Optional[int] = None                            # Req 5.6
    payment_id: Optional[int] = None                               # Req 5.6

    @model_validator(mode="after")
    def _one_selector(self):
        by_id = self.template_id is not None
        by_pair = self.event_type is not None and self.channel is not None
        if by_id == by_pair:
            raise ValueError(
                "Provide either 'template_id' or both 'event_type' and 'channel'."
            )
        return self


class ReminderRunRequest(BaseModel):
    within_days: int = Field(default=7)          # clamped to 1..90 in service (Req 7.1)
    channel: NotificationChannel = NotificationChannel.whatsapp   # Req 7.4


class ReminderRunResult(BaseModel):
    memberships_selected: int                    # Req 7.6
    notifications_created: int                   # Req 7.6
    channel: NotificationChannel
    within_days: int
```

`within_days` is intentionally not bounded with `ge`/`le` in the schema; the service clamps it to `[1, 90]` so the runner is safe for any caller and the API never rejects an out-of-range window (Requirement 7.1).

### Service — `app/services/notification.py`

Pure functions over `db` + `gym_id`, using `db.flush()` and leaving `db.commit()` to the router, mirroring `app/services/attendance.py`.

```python
"""Notification logic: template resolution, rendering, channel dispatch, reminders, log."""
from __future__ import annotations

import re
import smtplib
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Mapping, Optional, Protocol

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import MembershipStatus, NotificationChannel, NotificationStatus
from app.models.gym import Gym
from app.models.member import Member
from app.models.membership import Membership
from app.models.notification import Notification, NotificationTemplate
from app.models.payment import Payment

PROVIDER_TIMEOUT = 5.0   # Provider Timeout, seconds (Req 6.2)
ERROR_MAX = 500          # error column cap (Req 6.4)
DEFAULT_WINDOW = 7       # reminder window default (Req 7.1)
_PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_.]+)\}")


# ---------------- Rendering (Req 4) ----------------

def build_context(
    *, member: Member, gym: Gym,
    membership: Optional[Membership] = None, payment: Optional[Payment] = None,
) -> dict[str, str]:
    """Flatten the Context Sources into dotted-key -> string (Req 4.1)."""
    ctx: dict[str, object] = {
        "member.name": member.name, "member.code": member.member_code,
        "member.phone": member.phone, "member.email": member.email,
        "gym.name": gym.name, "gym.phone": gym.phone, "gym.email": gym.email,
        "gym.address": gym.address, "gym.currency": gym.currency,
    }
    if membership is not None:
        ctx.update({
            "membership.start_date": membership.start_date.isoformat(),
            "membership.end_date": membership.end_date.isoformat(),
            "membership.status": membership.status.value,
        })
    if payment is not None:
        ctx.update({
            "payment.amount": payment.amount, "payment.txn_code": payment.txn_code,
            "payment.method": payment.method.value, "payment.status": payment.status.value,
        })
    # Missing/None -> empty string (Req 4.3).
    return {k: ("" if v is None else str(v)) for k, v in ctx.items()}


def render(text: Optional[str], context: Mapping[str, str]) -> str:
    """Substitute {key}; unknown key -> "" ; no token survives (Req 4.2, 4.3, 4.4)."""
    return _PLACEHOLDER.sub(lambda m: context.get(m.group(1), ""), text or "")


# ---------------- Channel senders (Req 6) ----------------

class ChannelSender(Protocol):
    channel: NotificationChannel
    def is_configured(self) -> bool: ...
    def destination(self, member: Member) -> Optional[str]: ...
    def send(self, *, to: str, subject: str, body: str) -> str: ...


class WhatsAppSender:
    channel = NotificationChannel.whatsapp

    def is_configured(self) -> bool:                                     # Req 6.5
        return bool(settings.WHATSAPP_API_URL and settings.WHATSAPP_API_TOKEN)

    def destination(self, member: Member) -> Optional[str]:
        return member.phone or None

    def send(self, *, to: str, subject: str, body: str) -> str:          # Req 6.7
        resp = httpx.post(
            settings.WHATSAPP_API_URL,
            headers={"Authorization": f"Bearer {settings.WHATSAPP_API_TOKEN}"},
            json={"to": to, "type": "text", "text": {"body": body}},
            timeout=PROVIDER_TIMEOUT,                                    # Req 6.2
        )
        resp.raise_for_status()                                          # error -> failed (Req 6.4)
        data = resp.json() if resp.content else {}
        return str(data.get("id") or data.get("message_id") or "whatsapp")[:120]


class EmailSender:
    channel = NotificationChannel.email

    def is_configured(self) -> bool:                                     # Req 6.5
        return bool(settings.SMTP_HOST and settings.SMTP_FROM)

    def destination(self, member: Member) -> Optional[str]:
        return member.email or None

    def send(self, *, to: str, subject: str, body: str) -> str:          # Req 6.6
        msg = EmailMessage()
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to
        msg["Subject"] = subject or ""
        msg.set_content(body)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=PROVIDER_TIMEOUT) as s:
            s.ehlo()
            if settings.SMTP_USER:
                s.starttls()
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return f"smtp:{uuid.uuid4().hex[:16]}"


DEFAULT_SENDERS: dict[NotificationChannel, ChannelSender] = {
    NotificationChannel.whatsapp: WhatsAppSender(),
    NotificationChannel.email: EmailSender(),
}


# ---------------- Dispatch (Req 5.7, 6) ----------------

def dispatch(
    db: Session, gym_id: int, *,
    member: Member, template: NotificationTemplate,
    gym: Optional[Gym] = None,
    membership: Optional[Membership] = None, payment: Optional[Payment] = None,
    senders: Mapping[NotificationChannel, ChannelSender] = DEFAULT_SENDERS,
) -> Notification:
    """Render, deliver through the template's channel, persist exactly ONE row."""
    if gym is None:
        gym = db.get(Gym, gym_id)
    ctx = build_context(member=member, gym=gym, membership=membership, payment=payment)
    subject = render(template.subject, ctx)
    body = render(template.body, ctx)

    note = Notification(
        gym_id=gym_id, member_id=member.id,                     # Req 1.4, 5.7
        channel=template.channel, event_type=template.event_type,
        status=NotificationStatus.queued,                       # transitions below
        payload={"to": None, "subject": subject, "body": body},
    )
    sender = senders[template.channel]

    if not sender.is_configured():                              # Dry-run (Req 6.1)
        note.status = NotificationStatus.sent
        note.provider_ref = f"dryrun:{template.channel.value}:{uuid.uuid4().hex[:12]}"
        note.sent_at = datetime.now(timezone.utc)
    else:
        to = sender.destination(member)
        note.payload = {**note.payload, "to": to}
        if not to:                                              # Missing contact (Req 6.8)
            note.status = NotificationStatus.failed
            note.error = f"Member has no {template.channel.value} contact"[:ERROR_MAX]
        else:
            try:
                note.provider_ref = sender.send(to=to, subject=subject, body=body)
                note.status = NotificationStatus.sent           # Success (Req 6.3)
                note.sent_at = datetime.now(timezone.utc)
            except Exception as exc:                            # Never raise (Req 6.4)
                note.status = NotificationStatus.failed
                note.error = str(exc)[:ERROR_MAX]

    db.add(note)
    db.flush()                                                  # service flushes; router commits
    return note


# ---------------- Template resolution & CRUD (Req 3, 5) ----------------

def resolve_template(
    db: Session, gym_id: int, *,
    template_id: Optional[int] = None,
    event_type: Optional[str] = None, channel: Optional[NotificationChannel] = None,
) -> Optional[NotificationTemplate]:
    if template_id is not None:                                 # by id, gym-scoped (Req 5.2)
        return db.scalar(
            select(NotificationTemplate).where(
                NotificationTemplate.id == template_id,
                NotificationTemplate.gym_id == gym_id,
            )
        )
    return db.scalar(                                           # active (event,channel) (Req 3.8, 5.3)
        select(NotificationTemplate)
        .where(
            NotificationTemplate.gym_id == gym_id,
            NotificationTemplate.event_type == event_type,
            NotificationTemplate.channel == channel,
            NotificationTemplate.is_active.is_(True),
        )
        .order_by(NotificationTemplate.updated_at.desc(), NotificationTemplate.id.desc())
    )


def get_template(db: Session, gym_id: int, template_id: int) -> Optional[NotificationTemplate]:
    return db.scalar(
        select(NotificationTemplate).where(
            NotificationTemplate.id == template_id, NotificationTemplate.gym_id == gym_id
        )
    )


def list_templates(db: Session, gym_id: int) -> list[NotificationTemplate]:   # Req 3.4
    return list(db.scalars(
        select(NotificationTemplate)
        .where(NotificationTemplate.gym_id == gym_id)
        .order_by(NotificationTemplate.event_type, NotificationTemplate.channel)
    ))


def create_template(db: Session, gym_id: int, data) -> NotificationTemplate:   # Req 3.1
    tpl = NotificationTemplate(
        gym_id=gym_id, event_type=data.event_type, channel=data.channel,
        subject=data.subject, body=data.body, is_active=True,
    )
    db.add(tpl)
    db.flush()
    return tpl


def update_template(db: Session, tpl: NotificationTemplate, data) -> NotificationTemplate:
    for field, value in data.model_dump(exclude_unset=True).items():   # Req 3.5, 3.6
        setattr(tpl, field, value)
    db.flush()                                 # TimestampMixin.onupdate refreshes updated_at
    return tpl


def delete_template(db: Session, tpl: NotificationTemplate) -> None:    # Req 3.7
    db.delete(tpl)
    db.flush()


# ---------------- Context getters (gym-scoped) ----------------

def get_membership(db: Session, gym_id: int, membership_id: int) -> Optional[Membership]:
    return db.scalar(select(Membership).where(
        Membership.id == membership_id, Membership.gym_id == gym_id))


def get_payment(db: Session, gym_id: int, payment_id: int) -> Optional[Payment]:
    return db.scalar(select(Payment).where(
        Payment.id == payment_id, Payment.gym_id == gym_id))


# ---------------- Expiry reminders (Req 7) ----------------

def clamp_window(within_days: Optional[int]) -> int:                   # Req 7.1
    if within_days is None:
        return DEFAULT_WINDOW
    return min(90, max(1, within_days))


def select_expiring(db: Session, gym_id: int, within_days: int) -> list[tuple[Membership, Member]]:
    today = date.today()
    horizon = today + timedelta(days=within_days)
    return db.execute(                                                 # Req 7.2
        select(Membership, Member)
        .join(Member, Member.id == Membership.member_id)
        .where(
            Membership.gym_id == gym_id,
            Membership.status == MembershipStatus.active,
            Membership.end_date >= today,
            Membership.end_date <= horizon,
        )
        .order_by(Membership.end_date.asc())
    ).all()


def run_expiry_reminders(
    db: Session, gym_id: int, *,
    template: NotificationTemplate, within_days: int,
    senders: Mapping[NotificationChannel, ChannelSender] = DEFAULT_SENDERS,
) -> tuple[int, int]:
    """One membership_expiry dispatch per selected membership. Returns (selected, created)."""
    gym = db.get(Gym, gym_id)
    rows = select_expiring(db, gym_id, within_days)
    created = 0
    for membership, member in rows:                                   # Req 7.3
        dispatch(db, gym_id, member=member, template=template, gym=gym,
                 membership=membership, senders=senders)
        created += 1
    return len(rows), created                                         # Req 7.6


# ---------------- Log listing (Req 8) ----------------

def to_row(note: Notification, member_name: Optional[str]) -> dict:
    return {
        "id": note.id, "gym_id": note.gym_id, "member_id": note.member_id,
        "member_name": member_name, "channel": note.channel, "event_type": note.event_type,
        "status": note.status, "provider_ref": note.provider_ref, "error": note.error,
        "sent_at": note.sent_at, "created_at": note.created_at,
    }


def list_notifications(
    db: Session, gym_id: int, *,
    status: Optional[NotificationStatus] = None, channel: Optional[NotificationChannel] = None,
    event_type: Optional[str] = None, member_id: Optional[int] = None,
    page: int = 1, page_size: int = 20,
) -> tuple[list[dict], int]:
    stmt = (
        select(Notification, Member.name)
        .join(Member, Member.id == Notification.member_id, isouter=True)
        .where(Notification.gym_id == gym_id)                         # Req 8.1
    )
    if status is not None:
        stmt = stmt.where(Notification.status == status)             # Req 8.4
    if channel is not None:
        stmt = stmt.where(Notification.channel == channel)
    if event_type is not None:
        stmt = stmt.where(Notification.event_type == event_type)
    if member_id is not None:
        stmt = stmt.where(Notification.member_id == member_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Notification.created_at.desc())                # Req 8.2
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return [to_row(n, name) for n, name in rows], total
```

#### Dispatch exactly-one-row guarantee

`dispatch` constructs one `Notification`, computes its terminal `status` in memory (`queued` default → `sent` or `failed`), then does a single `db.add` + `db.flush`. No branch adds a second row, and the dry-run / success / failure paths each set a terminal status before flush, so the persisted row is always `sent` or `failed` — never left `queued` (Requirements 5.7, 6.1, 6.3, 6.4). If template or member resolution fails, the router returns 404 **before** calling `dispatch`, so no row is written (Requirements 5.4, 5.5).

#### Channel-sender abstraction

Each sender encapsulates exactly three concerns, which keeps the only I/O in one place and makes the policy (dry-run vs real vs failed) live in `dispatch`:

- `is_configured()` — reads only its own credentials, so WhatsApp and email are independent (Requirement 6.5).
- `destination(member)` — the channel's contact field (`member.phone` / `member.email`), or `None` when absent (Requirement 6.8).
- `send(...)` — the single network/SMTP call with a 5-second timeout, returning a provider reference or raising (Requirements 6.2, 6.6, 6.7).

Because `dispatch`/`run_expiry_reminders` accept a `senders` mapping (default `DEFAULT_SENDERS`), tests inject fakes:

- a **dry-run** assertion needs no sender at all (unconfigured → the real senders return `is_configured() == False` when settings are empty);
- a **success** fake returns a fixed ref; a **failure** fake raises `TimeoutException`/`HTTPStatusError`;
- a **configured HTTP** path can be exercised end-to-end by pointing `WHATSAPP_API_URL` at a `localhost` stub server, so the real `httpx` code runs without reaching the internet.

### Routers — `app/api/v1/routers/notifications.py`

All endpoints are gated by `require_admin` (Requirement 10.3). The service `flush`es; the router `commit`s and writes the audit entry.

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.enums import NotificationChannel, NotificationStatus
from app.schemas.common import Page
from app.schemas.notification import (
    ManualSendRequest, NotificationOut, ReminderRunRequest, ReminderRunResult,
    TemplateCreate, TemplateOut, TemplateUpdate,
)
from app.services import notification as svc
from app.services.audit import log_action
from app.services.member import get_member

router = APIRouter(prefix="/notifications", tags=["notifications"],
                   dependencies=[Depends(require_admin)])   # Req 1.1, 10.3


# ----- Templates -----

@router.get("/templates", response_model=list[TemplateOut])
def list_templates(db: DbSession, current_user: CurrentUser):
    return svc.list_templates(db, current_user.gym_id)                 # Req 3.4


@router.post("/templates", response_model=TemplateOut, status_code=201)
def create_template(db: DbSession, current_user: CurrentUser, body: TemplateCreate):
    tpl = svc.create_template(db, current_user.gym_id, body)           # Req 3.1
    log_action(db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
               action="notification.template_create", entity="notification_template",
               entity_id=tpl.id, after={"event_type": tpl.event_type, "channel": tpl.channel.value})
    db.commit()
    db.refresh(tpl)
    return tpl


@router.put("/templates/{template_id}", response_model=TemplateOut)
def update_template(db: DbSession, current_user: CurrentUser, template_id: int, body: TemplateUpdate):
    tpl = svc.get_template(db, current_user.gym_id, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")   # Req 1.5
    svc.update_template(db, tpl, body)                                 # Req 3.5, 3.6
    log_action(db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
               action="notification.template_update", entity="notification_template",
               entity_id=tpl.id)
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(db: DbSession, current_user: CurrentUser, template_id: int):
    tpl = svc.get_template(db, current_user.gym_id, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")   # Req 1.5
    svc.delete_template(db, tpl)                                       # Req 3.7
    log_action(db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
               action="notification.template_delete", entity="notification_template",
               entity_id=template_id)
    db.commit()


# ----- Log -----

@router.get("", response_model=Page[NotificationOut])
def list_log(
    db: DbSession, current_user: CurrentUser,
    status_f: NotificationStatus | None = Query(default=None, alias="status"),
    channel: NotificationChannel | None = None,
    event_type: str | None = None,
    member_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),                  # Req 8.3
):
    items, total = svc.list_notifications(
        db, current_user.gym_id, status=status_f, channel=channel,
        event_type=event_type, member_id=member_id, page=page, page_size=page_size,
    )
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


# ----- Manual send -----

@router.post("/send", response_model=NotificationOut)
def send(db: DbSession, current_user: CurrentUser, body: ManualSendRequest):
    member = get_member(db, current_user.gym_id, body.member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")     # Req 5.5
    template = svc.resolve_template(
        db, current_user.gym_id,
        template_id=body.template_id, event_type=body.event_type, channel=body.channel)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No matching template") # Req 5.4
    membership = payment = None
    if body.membership_id is not None:                                 # Req 5.6, 1.5
        membership = svc.get_membership(db, current_user.gym_id, body.membership_id)
        if membership is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    if body.payment_id is not None:
        payment = svc.get_payment(db, current_user.gym_id, body.payment_id)
        if payment is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    note = svc.dispatch(db, current_user.gym_id, member=member, template=template,
                        membership=membership, payment=payment)        # Req 5.7
    log_action(db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
               action="notification.send", entity="notification", entity_id=note.id,
               after={"channel": note.channel.value, "status": note.status.value})
    db.commit()                                                        # Req 5.8
    db.refresh(note)
    return svc.to_row(note, member.name)


# ----- Run reminders -----

@router.post("/run-reminders", response_model=ReminderRunResult)
def run_reminders(db: DbSession, current_user: CurrentUser, body: ReminderRunRequest):
    window = svc.clamp_window(body.within_days)                        # Req 7.1
    template = svc.resolve_template(
        db, current_user.gym_id, event_type="membership_expiry", channel=body.channel)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,                 # Req 7.5
                            "No active membership_expiry template for this channel")
    selected, created = svc.run_expiry_reminders(
        db, current_user.gym_id, template=template, within_days=window)
    log_action(db, gym_id=current_user.gym_id, actor_user_id=current_user.id,
               action="notification.run_reminders", entity="notification",
               after={"selected": selected, "created": created, "channel": body.channel.value})
    db.commit()
    return ReminderRunResult(memberships_selected=selected, notifications_created=created,
                             channel=body.channel, within_days=window)  # Req 7.6
```

Route order is unambiguous: `/templates*` static paths and `/send`, `/run-reminders` never collide with the collection root `""` (`GET /notifications` — the log).

#### Router registration — `app/api/v1/router.py`

Add `notifications` to the imports and `api_router.include_router(notifications.router)` in the reserved notifications slot (the `# notifications, ai` comment), so every route is reachable under `/api/v1/notifications` (Requirements 10.1, 10.2).

### API Endpoints

| Method & path | Auth | Purpose | Requirements |
|---|---|---|---|
| `GET /api/v1/notifications/templates` | `require_admin` | List the gym's templates | 3.4 |
| `POST /api/v1/notifications/templates` | `require_admin` | Create a template (`is_active=true`) | 3.1, 3.2, 3.3 |
| `PUT /api/v1/notifications/templates/{id}` | `require_admin` | Update fields / toggle `is_active` | 3.5, 3.6, 1.5 |
| `DELETE /api/v1/notifications/templates/{id}` | `require_admin` | Delete a template | 3.7, 1.5 |
| `GET /api/v1/notifications?status=&channel=&event_type=&member_id=&page=&page_size=` | `require_admin` | Paginated, filtered log | 8.1–8.5 |
| `POST /api/v1/notifications/send` | `require_admin` | Manual send to one member | 5.1–5.8 |
| `POST /api/v1/notifications/run-reminders` | `require_admin` | On-demand expiry reminders | 7.1–7.6 |

### Seeding — `app/db/seed.py`

Add a per-pair idempotent seeder, invoked inside the existing `run()` for the bootstrap gym. It checks each `(event_type, channel)` pair and inserts only the missing ones, so partial states are filled and repeat runs create no duplicates (Requirements 9.1–9.4).

```python
from app.models.enums import NotificationChannel
from app.models.notification import NotificationTemplate

_NOTIFICATION_TEMPLATES = {
    "welcome": {
        "subject": "Welcome to {gym.name}!",
        "body": "Hi {member.name}, welcome to {gym.name}! Your member code is {member.code}.",
    },
    "membership_expiry": {
        "subject": "Your {gym.name} membership is expiring",
        "body": "Hi {member.name}, your membership expires on {membership.end_date}. Renew to keep training.",
    },
    "payment_receipt": {
        "subject": "Payment received — {gym.name}",
        "body": "Hi {member.name}, we received your payment of {payment.amount} ({payment.txn_code}). Thank you!",
    },
}

def _seed_notification_templates(db, gym_id: int) -> None:
    for event_type, content in _NOTIFICATION_TEMPLATES.items():
        for channel in (NotificationChannel.whatsapp, NotificationChannel.email):
            exists = (
                db.query(NotificationTemplate)
                .filter(
                    NotificationTemplate.gym_id == gym_id,
                    NotificationTemplate.event_type == event_type,
                    NotificationTemplate.channel == channel,
                )
                .first()
            )
            if exists is None:                                   # Req 9.3, 9.4
                db.add(NotificationTemplate(
                    gym_id=gym_id, event_type=event_type, channel=channel,
                    subject=content["subject"], body=content["body"], is_active=True,  # Req 9.2
                ))
```

Six pairs (3 event types × 2 channels) yield six starter templates (Requirement 9.1). The call `_seed_notification_templates(db, gym.id)` is placed before the existing `db.commit()` in `run()`.

## Frontend Design

### Feature API module — `src/features/notifications/api.ts`

Thin typed wrappers over the shared `api` Axios instance, following `features/reports/api.ts` and `features/attendance/api.ts`.

```typescript
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export type Channel = "whatsapp" | "email";
export type EventType = "welcome" | "membership_expiry" | "payment_receipt";
export type NotificationStatus = "queued" | "sent" | "failed";

export interface NotificationTemplate {
  id: number; gym_id: number; event_type: EventType; channel: Channel;
  subject: string | null; body: string; is_active: boolean;
  created_at: string; updated_at: string;
}
export interface TemplateInput {
  event_type: EventType; channel: Channel; subject?: string | null; body: string;
}
export interface NotificationLog {
  id: number; gym_id: number; member_id: number | null; member_name: string | null;
  channel: Channel; event_type: string; status: NotificationStatus;
  provider_ref: string | null; error: string | null; sent_at: string | null; created_at: string;
}
export interface LogFilters {
  status?: NotificationStatus; channel?: Channel; event_type?: EventType;
  member_id?: number; page?: number; page_size?: number;
}
export interface ManualSend {
  member_id: number; template_id?: number; event_type?: EventType; channel?: Channel;
  membership_id?: number; payment_id?: number;
}
export interface ReminderRunResult {
  memberships_selected: number; notifications_created: number;
  channel: Channel; within_days: number;
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const { data } = await api.get<NotificationTemplate[]>("/notifications/templates");
  return data;
}
export async function createTemplate(input: TemplateInput): Promise<NotificationTemplate> {
  const { data } = await api.post<NotificationTemplate>("/notifications/templates", input);
  return data;
}
export async function updateTemplate(id: number, input: Partial<TemplateInput> & { is_active?: boolean }) {
  const { data } = await api.put<NotificationTemplate>(`/notifications/templates/${id}`, input);
  return data;
}
export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/notifications/templates/${id}`);
}
export async function listNotifications(params: LogFilters): Promise<Page<NotificationLog>> {
  const { data } = await api.get<Page<NotificationLog>>("/notifications", { params });
  return data;
}
export async function sendNotification(input: ManualSend): Promise<NotificationLog> {
  const { data } = await api.post<NotificationLog>("/notifications/send", input);
  return data;
}
export async function runReminders(input: { within_days: number; channel: Channel }): Promise<ReminderRunResult> {
  const { data } = await api.post<ReminderRunResult>("/notifications/run-reminders", input);
  return data;
}
```

The member picker for manual send reuses the existing `searchMembers` from `features/attendance/api.ts` (hits `GET /attendance/member-search`).

### Notifications page — new `src/pages/Notifications.tsx` (replaces the placeholder)

Routing: in `src/app/router.tsx`, replace `{ path: "notifications", element: <Placeholder title="Notifications" phase="Phase 7" /> }` with `<NotificationsPage />` (Requirement 11.1). The sidebar entry is already gated to `roles: ["admin"]`, so no nav change is needed and the entry stays hidden for non-admins (Requirement 11.7).

The page follows the `Members.tsx` list/modal pattern (load/loading/error/empty states, `Card`, table, pager, `Modal`). It is organized into stacked `Card` sections selected by a lightweight tab switch:

1. **Log** (default) — `listNotifications({ status, channel, event_type, member_id, page, page_size })` rendered as a table: created time, member name, event type, channel (`Badge`), status (`Badge` tone success/`sent`, danger/`failed`, neutral/`queued`), provider ref / error. A filter row of `Select`s (status, channel, event type) plus a member search typeahead resets to page 1 on change; the pager uses the `Page` envelope exactly like `AttendanceHistory.tsx` (Requirements 11.2, 8.x).
2. **Templates** — `listTemplates()` in a table with an "Add template" button opening a `Modal` form (event type, channel, subject, body) that calls `createTemplate` / `updateTemplate`; an activate/deactivate toggle calls `updateTemplate(id, { is_active })`; a delete action calls `deleteTemplate` (Requirement 11.3).
3. **Manual send** — a `Modal`/form: member typeahead (reused search), event type, channel, optional membership/payment id; submits `sendNotification` and shows the returned row's `status` + `provider_ref` (Requirement 11.4).
4. **Run reminders** — a small form (within-days number, channel `Select`) whose button calls `runReminders` and renders the returned `memberships_selected` / `notifications_created` counts (Requirement 11.5).

Every mutating action wraps the call in `try/catch` using `apiErrorMessage(err)`; on failure it shows the message inline and leaves the form state intact so the admin's input is preserved (Requirement 11.6).

## Error Handling

| Condition | Backend behavior | Frontend behavior |
|---|---|---|
| Non-admin role on any endpoint | 403 via `require_admin`, no action (1.1) | `apiErrorMessage` surfaces 403; entry hidden anyway (11.7) |
| Missing/invalid token | 401 from `get_current_user` (1.2) | Axios refresh-or-logout flow |
| Cross-gym template/notification/member/membership/payment id | 404, no change (1.5, 5.5) | Error message, inputs preserved (11.6) |
| Invalid template event_type / oversized subject or body | 422 from Pydantic, nothing persisted (3.2, 3.3) | Form error, input preserved (11.6) |
| Manual send resolves no template | 404, no row created (5.4) | Error banner on the send form |
| Unconfigured channel | Dry-run: `sent`, `provider_ref` `dryrun:…`, no network (6.1) | Row shows `sent` with dry-run ref |
| Configured provider error / timeout | `failed`, `error` ≤500 chars, **no exception** (6.4) | Row shows `failed` + error; request still 200 |
| Configured channel, member lacks contact | `failed` + explanatory error, no network (6.8) | Row shows `failed` + reason |
| Run-reminders with no active `membership_expiry` template | 404, no rows (7.5) | Error banner on the reminders form |
| List load fails | n/a | `ErrorState` + retry |

A provider failure is confined to `dispatch`: it is caught, recorded on the row, and the endpoint returns 200 with the `failed` record (Requirements 5.8, 6.4).

## Security, RBAC, and Multi-Tenancy

- **Admin-only (1.1, 10.3):** the router-level `dependencies=[Depends(require_admin)]` rejects every non-admin with 403 before any handler runs, so no template or notification state changes. Missing/invalid tokens yield 401 from `get_current_user` (1.2).
- **Tenancy (1.3, 1.4, 1.5):** every read filters by `current_user.gym_id` (templates, log, context getters, reminder scan). Every write sets `gym_id` to `current_user.gym_id`. Any `template_id`, `member_id`, `membership_id`, or `payment_id` resolving outside the gym returns 404 and writes nothing. Resolution-by-id never leaks another gym's template because `resolve_template`/`get_template` both constrain `gym_id`.
- **Secrets:** provider credentials come only from `settings` (env). The `payload` JSON stores the rendered `to`/`subject`/`body` for audit, never credentials. The WhatsApp token is sent only in the `Authorization` header to the configured URL.
- **Audit (via `log_action`):** create/update/delete template, manual send, and run-reminders each write one `audit_logs` entry in the same transaction the router commits.

## Testing Strategy

**Dual approach.** Property-based tests (minimum 100 iterations each, tagged `Feature: notifications, Property {n}: {text}`) cover the universal backend logic in [Correctness Properties](#correctness-properties). Senders are injected fakes so dry-run, success, and failure paths run with no real network; a small integration test points `WHATSAPP_API_URL` at a `localhost` stub to exercise the real `httpx` + timeout path. Example/edge tests cover the response shape of manual send (5.8), the default channel (`whatsapp`) when omitted (7.4), and the `membership_expiry`-missing 404 (7.5). Structural items — router registration under `/api/v1` (10.1, 10.2), reuse of existing tables / no migration (2.1, 2.2), and enum-pinned status/channel values (2.3) — are verified by an integration/route test and review. Frontend criteria (Requirement 11) are verified with component/example tests (tab render, filter→reload, template CRUD modal, manual-send result display, run-reminders counts, error-preserves-input); they are not property tests.

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Access is admin-only and token-gated

For any notifications endpoint and any authenticated user whose role is not `admin`, the request returns HTTP 403 and leaves the `notifications` and `notification_templates` row counts unchanged; a request with no valid access token returns HTTP 401.

**Validates: Requirements 1.1, 1.2, 10.3**

### Property 2: Reads are gym-scoped

For any backing set of templates and notifications spread across multiple gyms, every template returned by the template listing and every notification returned by the log has `gym_id` equal to the authenticated administrator's `gym_id`.

**Validates: Requirements 1.3, 3.4**

### Property 3: Persisted rows are gym-scoped and new templates are active

For any template creation and any notification dispatch, the persisted row's `gym_id` equals the acting administrator's `gym_id`, and every created template has `is_active` equal to true.

**Validates: Requirements 1.4, 3.1**

### Property 4: Cross-gym references are rejected without side effects

For any template, notification, member, membership, or payment identifier whose `gym_id` differs from the administrator's `gym_id`, the referencing endpoint returns HTTP 404 and the `notifications` and `notification_templates` row counts are unchanged.

**Validates: Requirements 1.5, 5.5**

### Property 5: Invalid template input is rejected and persists nothing

For any template create or update whose `event_type` is not one of `welcome`, `membership_expiry`, `payment_receipt`, or whose `body` exceeds 2000 characters, or whose `subject` exceeds 200 characters, the endpoint returns HTTP 422 and no template row is created or modified.

**Validates: Requirements 3.2, 3.3**

### Property 6: Template update and toggle persist exactly the submitted changes

For any template owned by the administrator's gym and any subset of submitted fields, reading the template back reflects each submitted value (including `is_active`), every unsubmitted field is unchanged, and `updated_at` is greater than or equal to its value before the update.

**Validates: Requirements 3.5, 3.6**

### Property 7: Template deletion removes the record

For any template owned by the administrator's gym, deleting it causes a subsequent fetch to find no record and decreases the gym's template count by exactly one.

**Validates: Requirements 3.7**

### Property 8: Template resolution honors ownership, active flag, and selector

For any gym whose templates mix active and inactive records: resolving by a `template_id` owned by the gym returns that template regardless of its `is_active` flag; resolving by `(event_type, channel)` returns only a template of the gym whose `is_active` is true and whose `event_type` and `channel` match; when no such template exists, resolution returns nothing.

**Validates: Requirements 3.8, 5.1, 5.2, 5.3**

### Property 9: Rendering substitutes context, blanks unknowns, and leaves no tokens

For any template subject and body and any context built from the Context Sources, each `{key}` placeholder whose key is present is replaced by that context value, each placeholder whose key is absent is replaced by an empty string, and the rendered subject and body contain no residual `{key}` placeholder token.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 10: Supplied owned context sources are available to rendering

For any manual send that supplies a `membership_id` or `payment_id` owned by the administrator's gym, the corresponding membership and payment fields are present in the rendering context, so a template referencing those keys renders their values rather than empty strings.

**Validates: Requirements 5.6**

### Property 11: A resolved send writes exactly one terminal row; a failed resolution writes none

For any manual send that resolves to a member and a template within the gym, exactly one `Notification` row is written, scoped to the administrator's `gym_id`, carrying the template's `channel` and `event_type` and a status in `{sent, failed}`; for any manual send whose template or member does not resolve within the gym, the endpoint returns HTTP 404 and no `Notification` row is written.

**Validates: Requirements 5.4, 5.7**

### Property 12: An unconfigured channel dispatches as a dry-run

For any notification dispatched on a channel whose credentials are not all present, no provider call is made, the row's `status` is `sent`, its `provider_ref` begins with `dryrun:`, and its `sent_at` is set to the dispatch time.

**Validates: Requirements 6.1**

### Property 13: A configured channel that succeeds records a sent delivery

For any notification dispatched on a configured channel whose provider call succeeds, the row's `status` is `sent`, its `provider_ref` holds the reference returned by the provider, and its `sent_at` is set to the completion time.

**Validates: Requirements 6.3**

### Property 14: A configured provider failure records a failure and never raises

For any notification dispatched on a configured channel whose provider call raises an error or exceeds the 5-second timeout, dispatch returns normally without propagating an exception, the row's `status` is `failed`, and the stored `error` is at most 500 characters.

**Validates: Requirements 6.4**

### Property 15: A configured channel with no destination contact fails without a network call

For any notification dispatched on a configured channel where the target member lacks that channel's contact value (phone for `whatsapp`, email for `email`), no provider call is made, the row's `status` is `failed`, and `error` holds an explanatory message.

**Validates: Requirements 6.8**

### Property 16: Channel configuration is evaluated independently

For any combination of present and absent WhatsApp credentials (`WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`) and email credentials (`SMTP_HOST`, `SMTP_FROM`), each channel's configured state depends only on its own credentials, so one channel can be configured while the other is not.

**Validates: Requirements 6.5**

### Property 17: The reminder window defaults to 7 and clamps to 1 through 90

For any supplied window value, the effective window equals 7 when the value is omitted, and otherwise equals the value bounded to no less than 1 and no more than 90.

**Validates: Requirements 7.1**

### Property 18: Reminder selection matches the active, gym-scoped, in-window predicate

For any backing set of memberships across gyms, statuses, and end dates, the run selects exactly those memberships whose `gym_id` equals the administrator's gym, whose `status` is `active`, and whose `end_date` falls between the current date and the current date plus the effective window, inclusive.

**Validates: Requirements 7.2**

### Property 19: Reminders dispatch one membership_expiry per selection and report truthful counts

For any backing set of memberships, the run dispatches exactly one `membership_expiry` notification for each selected membership, and the returned result reports `memberships_selected` equal to the number of selected memberships and `notifications_created` equal to the number of `Notification` rows written by the run.

**Validates: Requirements 7.3, 7.6**

### Property 20: The notification log is gym-scoped, filtered, date-descending, and paginated

For any backing data, any filter subset over `status`, `channel`, `event_type`, and `member_id`, and any pagination arguments, the log response contains only notifications whose `gym_id` equals the administrator's gym and that match every applied filter, ordered by `created_at` descending, with `items` no longer than `page_size`, `total` equal to the count of matching rows, and `pages` equal to `ceil(total / page_size)`.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 21: Template seeding is complete and idempotent

For any gym and any number of seed runs of one or more, there is exactly one active template for each of the six `(event_type, channel)` pairs drawn from `{welcome, membership_expiry, payment_receipt}` and `{whatsapp, email}`, no duplicates are created across runs, and any pre-existing template for a pair is left unchanged.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4**
