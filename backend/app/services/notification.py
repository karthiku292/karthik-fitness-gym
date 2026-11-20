"""Notification logic: template resolution, rendering, channel dispatch, reminders, log.

Pure functions over ``db`` + ``gym_id`` that ``flush`` and leave ``commit`` to the
router, mirroring ``app/services/attendance.py``. The module is built incrementally
across tasks: the shared constants, the rendering layer (``build_context`` +
``render``), the channel senders, ``dispatch``, template resolution/CRUD, the
gym-scoped context getters, the expiry reminders, and the gym-scoped notification
log listing (``to_row`` + ``list_notifications``).
"""
from __future__ import annotations

import re
import smtplib
import uuid
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
    """Render, deliver through the template's channel, persist exactly ONE row.

    The terminal ``status`` is computed in memory (``queued`` default ->
    ``sent``/``failed``) before a single ``db.add`` + ``db.flush``. A missing
    destination short-circuits before any network call, an unconfigured channel
    runs as a dry-run, and a provider failure is captured as ``failed`` and never
    re-raised to the caller (Req 5.7, 6.1, 6.3, 6.4, 6.8).
    """
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
    """Resolve a template for a send: by id (gym-scoped) or the active
    ``(event_type, channel)`` match (gym-scoped), newest first (Req 5.2, 5.3, 3.8)."""
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
    """Fetch a single template by id, scoped to the gym (Req 1.5, 3.5, 3.7)."""
    return db.scalar(
        select(NotificationTemplate).where(
            NotificationTemplate.id == template_id, NotificationTemplate.gym_id == gym_id
        )
    )


def list_templates(db: Session, gym_id: int) -> list[NotificationTemplate]:   # Req 3.4
    """List the gym's templates, ordered by event type then channel."""
    return list(db.scalars(
        select(NotificationTemplate)
        .where(NotificationTemplate.gym_id == gym_id)
        .order_by(NotificationTemplate.event_type, NotificationTemplate.channel)
    ))


def create_template(db: Session, gym_id: int, data) -> NotificationTemplate:   # Req 3.1
    """Create a gym-scoped template; new templates start active."""
    tpl = NotificationTemplate(
        gym_id=gym_id, event_type=data.event_type, channel=data.channel,
        subject=data.subject, body=data.body, is_active=True,
    )
    db.add(tpl)
    db.flush()
    return tpl


def update_template(db: Session, tpl: NotificationTemplate, data) -> NotificationTemplate:
    """Apply exactly the submitted fields, including the ``is_active`` toggle (Req 3.5, 3.6)."""
    for field, value in data.model_dump(exclude_unset=True).items():   # Req 3.5, 3.6
        setattr(tpl, field, value)
    db.flush()                                 # TimestampMixin.onupdate refreshes updated_at
    return tpl


def delete_template(db: Session, tpl: NotificationTemplate) -> None:    # Req 3.7
    """Remove a template record."""
    db.delete(tpl)
    db.flush()


# ---------------- Context getters (gym-scoped) ----------------

def get_membership(db: Session, gym_id: int, membership_id: int) -> Optional[Membership]:
    """Fetch an optional context membership, scoped to the gym (Req 1.5, 5.6)."""
    return db.scalar(select(Membership).where(
        Membership.id == membership_id, Membership.gym_id == gym_id))


def get_payment(db: Session, gym_id: int, payment_id: int) -> Optional[Payment]:
    """Fetch an optional context payment, scoped to the gym (Req 1.5, 5.6)."""
    return db.scalar(select(Payment).where(
        Payment.id == payment_id, Payment.gym_id == gym_id))


# ---------------- Expiry reminders (Req 7) ----------------

def clamp_window(within_days: Optional[int]) -> int:
    """Clamp the reminder window to ``[1, 90]``, defaulting to ``DEFAULT_WINDOW`` (Req 7.1).

    A missing window (``None``) falls back to the 7-day default; any supplied
    value is bounded into ``1..90`` so the runner is safe for any caller.
    """
    if within_days is None:
        return DEFAULT_WINDOW
    return min(90, max(1, within_days))


def select_expiring(
    db: Session, gym_id: int, within_days: int
) -> list[tuple[Membership, Member]]:
    """Gym-scoped active memberships expiring within the window, soonest first.

    Follows ``app/services/membership.py`` (see ``expire_due_memberships``) by
    treating ``MembershipStatus.active`` as the active state, and selects rows
    whose ``end_date`` falls in ``[today, today + within_days]`` (Req 7.2).
    """
    today = date.today()
    horizon = today + timedelta(days=within_days)
    return db.execute(
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
    db: Session, gym_id: int, within_days: Optional[int] = None, *,
    senders: Mapping[NotificationChannel, ChannelSender] = DEFAULT_SENDERS,
    channel: NotificationChannel = NotificationChannel.whatsapp,
) -> tuple[int, int]:
    """Dispatch one ``membership_expiry`` reminder per expiring membership.

    Clamps the window to ``[1, 90]``, selects the gym's active memberships that
    expire within it, resolves the active ``membership_expiry`` template for
    ``channel``, and dispatches exactly one notification per selected membership.
    Returns ``(memberships_selected, notifications_created)`` (Req 7.1, 7.2, 7.3,
    7.6). When no active template exists for the channel nothing is dispatched
    and ``(selected, 0)`` is returned, leaving the caller to decide how to react.
    """
    window = clamp_window(within_days)                              # Req 7.1
    rows = select_expiring(db, gym_id, window)                      # Req 7.2
    template = resolve_template(
        db, gym_id, event_type="membership_expiry", channel=channel)
    if template is None:
        return len(rows), 0
    gym = db.get(Gym, gym_id)
    created = 0
    for membership, member in rows:                                # Req 7.3
        dispatch(
            db, gym_id, member=member, template=template, gym=gym,
            membership=membership, senders=senders,
        )
        created += 1
    return len(rows), created                                      # Req 7.6


# ---------------- Log listing (Req 8) ----------------

def to_row(note: Notification, member_name: Optional[str]) -> dict:
    """Project a Notification plus its joined member display name into a log row.

    Shaped to match ``NotificationOut``: the joined ``member_name`` is passed in
    (and may be ``None`` for a row with no member) rather than read off the ORM
    object, so the projection never triggers a lazy load (Req 8.5).
    """
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
    """Gym-scoped notification log: optional filters, newest first, paginated.

    Returns ``(rows, total)`` where ``rows`` are ``to_row`` projections for the
    requested page and ``total`` is the full count under the applied filters, so
    the router can build a ``Page[NotificationOut]`` envelope (``page_size`` is
    clamped to ``1..100`` at the router boundary, mirroring
    ``app/services/attendance.py``'s ``list_history``). ``Member`` is left-outer
    joined so notifications with no member still appear with ``member_name=None``.
    Filters (``status`` / ``channel`` / ``event_type`` / ``member_id``) apply only
    when supplied, and ``total`` is counted over the same filtered statement so the
    envelope stays consistent (Req 8.1, 8.2, 8.4, 8.5).
    """
    stmt = (
        select(Notification, Member.name)
        .join(Member, Member.id == Notification.member_id, isouter=True)
        .where(Notification.gym_id == gym_id)                        # Req 8.1
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
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [to_row(n, name) for n, name in rows], total
