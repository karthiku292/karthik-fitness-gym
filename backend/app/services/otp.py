"""Passwordless member login (OTP) business logic.

Pure, framework-agnostic functions over ``db`` that ``flush`` and leave ``commit``
to the router, mirroring ``app/services/attendance.py`` and
``app/services/notification.py``. The service raises only the typed errors defined
here; the auth router maps each to an HTTP status (keeps the service unit-testable
without HTTP). Delivery and the clock are injected so request/verify/rate-limit/
expiry/attempt behavior can be tested offline and without real time.

The module is built incrementally across the task-3 slices:
  §3.1 constants, clock, typed errors, phone normalization, Target_Gym resolution
  §3.2 delivery seam (``DeliveryResult`` / ``OtpDeliverer`` / ``WhatsAppOtpDeliverer``)
  §3.3 ``request_otp`` + the per-phone rate-limit guard
  §3.4 account provisioning (``provision_or_resolve_member``)
  §3.5 ``verify_otp``
"""
from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Protocol
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.models.enums import UserRole
from app.models.gym import Gym
from app.models.member import Member
from app.models.otp import OtpCode
from app.models.user import User
from app.schemas.member import MemberCreate
from app.services.member import create_member
from app.services.notification import WhatsAppSender


# ---------------- §3.1 Constants ----------------

CODE_LENGTH = 6                             # 6-digit numeric code (Req 2.3)
CODE_TTL = timedelta(minutes=5)             # expiry window (Req 2.4)
MAX_ATTEMPTS = 5                            # per-code attempt cap (Req 4.4)
RESEND_COOLDOWN = timedelta(seconds=60)     # resend cooldown (Req 3.1)
HOURLY_WINDOW = timedelta(minutes=60)       # rolling hourly window (Req 3.2)
HOURLY_LIMIT = 5                            # max codes per phone per window (Req 3.2)
MIN_DIGITS, MAX_DIGITS = 8, 15              # accepted phone digit count (Req 2.2)
MEMBER_EMAIL_DOMAIN = "members.local"       # synthesized member email domain (Req 5.4)


# ---------------- §3.1 Clock (injectable) ----------------

Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    """Default clock: timezone-aware UTC now. Overridden in tests for determinism."""
    return datetime.now(timezone.utc)


# ---------------- §3.1 Typed errors (router maps each to HTTP) ----------------

class OtpError(Exception):
    """Base class for every OTP service error."""


class InvalidPhoneError(OtpError):
    """Phone digit count is out of range -> HTTP 422 (Req 2.2)."""


class RateLimitedError(OtpError):
    """A per-phone request limit was exceeded -> HTTP 429 + Retry-After (Req 3.1, 3.2, 3.3).

    ``retry_after`` is the whole number of seconds the caller should wait before
    retrying; ``message`` names the limit that was exceeded (Req 3.3).
    """

    def __init__(self, retry_after: int, message: str):
        super().__init__(message)
        self.retry_after = retry_after


class GymUnavailableError(OtpError):
    """The Target_Gym could not be resolved -> HTTP 500 (Req 1.6)."""


class InvalidCodeError(OtpError):
    """No active code, or a code mismatch -> HTTP 400 (Req 4.3, 4.5)."""


class TooManyAttemptsError(OtpError):
    """The selected code has reached the attempt cap -> HTTP 429 (Req 4.4)."""


class AccountDisabledError(OtpError):
    """The resolved member account is inactive -> HTTP 403 (Req 5.9)."""


# ---------------- §3.2 Phone normalization ----------------

def normalize_phone(raw: str) -> str:
    """Reduce a submitted phone to an optional leading ``+`` then digits only (Req 2.1).

    Spaces and separator characters are stripped; a single leading ``+`` is kept
    when present. Pure, deterministic, and idempotent (normalizing an already
    normalized value returns it unchanged). Length is NOT enforced here — callers
    apply their own rule (``request_otp`` rejects out-of-range digit counts; the
    verify path simply matches no active code).
    """
    s = (raw or "").strip()
    plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    return ("+" + digits) if plus else digits


# ---------------- §3.3 Target gym resolution ----------------

def _bootstrap_slug() -> str:
    """Slug of the single bootstrapped gym, from ``settings.BOOTSTRAP_GYM_NAME``.

    Mirrors ``app/db/seed.py::_slug`` (default ``"My Gym"`` -> ``"my-gym"``). The
    rule is duplicated here deliberately rather than imported from the seed module,
    which binds the production engine at import time.
    """
    s = re.sub(r"[^a-z0-9]+", "-", settings.BOOTSTRAP_GYM_NAME.strip().lower())
    return s.strip("-") or "gym"


def resolve_target_gym(db: Session) -> Gym:
    """Resolve the single bootstrapped gym by slug (Req 1.3).

    Raises ``GymUnavailableError`` when absent, so request/verify answer HTTP 500
    and persist nothing. Callers invoke this BEFORE any write (Req 1.6).
    """
    gym = db.scalar(select(Gym).where(Gym.slug == _bootstrap_slug()))
    if gym is None:
        raise GymUnavailableError("Gym is not available")
    return gym


# ---------------- §3.4 Delivery seam (injectable, member-independent) ----------------

@dataclass
class DeliveryResult:
    """Outcome of one OTP delivery attempt, independent of any Member/Notification row.

    ``configured`` is whether the provider was actually configured so a real send was
    attempted; ``simulated`` is whether delivery ran as a dry-run with no network call.
    ``request_otp`` reads ``configured`` to decide whether the ``dev_code`` may be
    surfaced. ``provider_ref`` is an opaque reference for the send — the
    provider message id for a real send, or a ``dryrun:whatsapp:…`` token for a
    dry-run. The raw code is deliberately NOT a field here: it is handed only to the
    provider call and is never returned or persisted (Req 6.1).
    """

    configured: bool
    simulated: bool
    provider_ref: str


class OtpDeliverer(Protocol):
    """Member-independent OTP delivery seam injected into ``request_otp``.

    Deliberately narrower than ``notification.ChannelSender`` and NOT routed through
    ``notification.dispatch``: dispatch persists a ``Notification`` whose payload holds
    the rendered body (which would embed the raw code) and needs a ``member_id`` that
    may not exist yet for a brand-new phone. This seam takes only the strings it needs
    and reports the outcome back to the caller without writing anything (Req 6.1).
    Injectable so tests can swap in a recording deliverer and endpoints can override it.
    """

    def is_configured(self) -> bool: ...
    def send(self, *, phone: str, code: str, gym: Gym) -> DeliveryResult: ...


class WhatsAppOtpDeliverer:
    """Default deliverer: send the code over WhatsApp, or dry-run when unconfigured.

    Wraps ``notification.WhatsAppSender`` for the configured check and the actual
    provider call, but bypasses ``notification.dispatch`` so the raw code never lands
    in a persisted notification payload (Req 6.1). The underlying sender is injectable
    so tests can substitute a fake.
    """

    def __init__(self, sender: Optional[WhatsAppSender] = None):
        self._sender = sender or WhatsAppSender()

    def is_configured(self) -> bool:
        """True only when both WhatsApp settings are set (delegates to the sender)."""
        return self._sender.is_configured()

    def send(self, *, phone: str, code: str, gym: Gym) -> DeliveryResult:
        """Deliver the code to ``phone``; dry-run (no network) when unconfigured.

        Unconfigured -> a simulated send: no provider network call, a
        ``dryrun:whatsapp:…`` reference, and ``configured=False`` (Req 2.6). Configured
        -> a real WhatsApp send whose provider reference is returned with
        ``configured=True`` (Req 2.5). The code is passed only to the provider call and
        is never persisted or returned by this seam (Req 6.1).
        """
        if not self.is_configured():                                    # Req 2.6
            return DeliveryResult(
                configured=False, simulated=True,
                provider_ref=f"dryrun:whatsapp:{uuid4().hex[:12]}",
            )
        ref = self._sender.send(                                        # Req 2.5
            to=phone, subject="",
            body=f"Your {gym.name} login code is {code}. It expires in 5 minutes.",
        )
        return DeliveryResult(configured=True, simulated=False, provider_ref=ref)


# Module default so endpoints/tests can inject or override delivery, mirroring
# ``notification.DEFAULT_SENDERS``. The auth router's ``get_otp_deliverer`` dependency
# returns this, and tests swap in a recording deliverer via ``dependency_overrides``.
DEFAULT_DELIVERER: OtpDeliverer = WhatsAppOtpDeliverer()


# ---------------- §3.5 request_otp + per-phone rate-limit guard ----------------

@dataclass
class OtpRequestResult:
    """Outcome of a ``request_otp`` call; the router maps it to ``OtpRequestOut``.

    ``sent`` is always ``True`` on a normal return — every rejection raises a typed
    error instead. ``dev_code`` carries the raw code ONLY when the provider was
    unconfigured and the environment is non-production (Req 2.7-2.9, 6.3); it is
    ``None`` otherwise so the router omits the field. ``delivery`` is the
    ``DeliveryResult`` from the seam, kept so the router/tests can inspect whether
    delivery was configured or simulated without re-deriving it.
    """

    sent: bool
    dev_code: Optional[str]
    delivery: DeliveryResult


def _as_aware_utc(dt: datetime) -> datetime:
    """Coerce any datetime to a timezone-aware UTC value for safe comparison.

    ``OtpCode.created_at`` is written by ``TimestampMixin``'s ``server_default=
    func.now()``: on SQLite that lands as a NAIVE UTC timestamp, while on Postgres
    (``timestamptz``) it is tz-aware. The injected clock (``_utcnow``) is tz-aware.
    Subtracting a naive from an aware datetime raises ``TypeError``, which would 500
    a simple repeat OTP request on local SQLite. Routing both operands through here
    first keeps the cooldown/window math identical across SQLite and Postgres: a
    naive value is assumed UTC (true for ``func.now()``), an aware value is converted
    to UTC.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _enforce_rate_limits(db: Session, gym_id: int, phone: str, now: datetime) -> None:
    """Reject an abusive request for ``(gym_id, phone)`` BEFORE any write (Req 3).

    Read-only: issues only SELECTs against ``otp_codes`` and raises
    ``RateLimitedError`` (whose message names the exceeded limit, Req 3.3) so a
    rejected request persists nothing (Req 3.1, 3.2). Two per-phone limits apply:

      * a 60-second resend cooldown measured from the newest row's ``created_at``
        (Req 3.1), with ``retry_after`` set to the whole seconds still to wait;
      * a cap of 5 codes within the rolling 60-minute window (Req 3.2).

    All timestamp arithmetic passes through ``_as_aware_utc`` so the comparisons are
    timezone-robust on naive-``created_at`` SQLite as well as tz-aware Postgres.
    """
    now = _as_aware_utc(now)
    base = select(OtpCode).where(OtpCode.gym_id == gym_id, OtpCode.phone == phone)

    # Resend cooldown: compare against the most recent row for this phone (Req 3.1).
    last = db.scalar(base.order_by(OtpCode.created_at.desc(), OtpCode.id.desc()))
    if last is not None and last.created_at is not None:
        elapsed = now - _as_aware_utc(last.created_at)
        if elapsed < RESEND_COOLDOWN:
            wait = int((RESEND_COOLDOWN - elapsed).total_seconds()) + 1
            raise RateLimitedError(wait, "Please wait before requesting another code.")

    # Hourly cap: count rows created within the rolling window (Req 3.2).
    window_start = now - HOURLY_WINDOW
    recent = db.scalar(
        select(func.count())
        .select_from(OtpCode)
        .where(
            OtpCode.gym_id == gym_id,
            OtpCode.phone == phone,
            OtpCode.created_at >= window_start,
        )
    )
    if (recent or 0) >= HOURLY_LIMIT:
        raise RateLimitedError(
            int(HOURLY_WINDOW.total_seconds()),
            "Too many code requests. Please try again later.",
        )


def request_otp(
    db: Session,
    phone: str,
    *,
    deliverer: OtpDeliverer = DEFAULT_DELIVERER,
    now: Clock = _utcnow,
) -> OtpRequestResult:
    """Issue, persist, and deliver a fresh OTP for ``phone`` in the Target_Gym (§3.5).

    Ordered so a rejected request never writes a row:

      1. resolve the Target_Gym — ``GymUnavailableError`` (-> 500) before any write
         (Req 1.6);
      2. normalize the phone and reject a digit count outside ``8..15`` —
         ``InvalidPhoneError`` (-> 422) before any write (Req 2.1, 2.2);
      3. enforce the per-phone cooldown + hourly cap — ``RateLimitedError`` (-> 429)
         before any write (Req 3);
      4. generate a 6-digit numeric code and store exactly ONE ``OtpCode`` holding
         only its bcrypt hash, with ``expires_at = now + 5 min``, ``attempts = 0`` and
         ``consumed = False`` (Req 2.3, 2.4, 6.1);
      5. hand the raw code to the injected deliverer — a real provider send or an
         unconfigured dry-run (Req 2.5, 2.6);
      6. surface the raw code as ``dev_code`` ONLY when the provider was unconfigured
         AND the environment is non-production (Req 2.7-2.9, 6.3).

    The service flushes the single insert and leaves the ``commit`` to the router. The
    raw code is never persisted or logged — it lives only in memory for this call and
    is passed solely to the deliverer (Req 6.1, 6.2). ``now`` is an injected clock,
    read once here, so the stored ``expires_at`` and the rate-limit windows share one
    deterministic instant; ``deliverer`` defaults to the module's ``DEFAULT_DELIVERER``
    but is overridden in tests and by the router's dependency.

    The ``phone`` parameter is positional-or-keyword: callers may pass the raw phone
    positionally, and the auth router passes it as ``phone=...`` per the design.
    """
    gym = resolve_target_gym(db)                        # Req 1.6 — 500 before any write

    normalized = normalize_phone(phone)                 # Req 2.1
    digits = normalized.lstrip("+")
    if not (MIN_DIGITS <= len(digits) <= MAX_DIGITS):   # Req 2.2 — 422 before any write
        raise InvalidPhoneError("Enter a valid mobile number.")

    issued_at = _as_aware_utc(now())
    _enforce_rate_limits(db, gym.id, normalized, issued_at)   # Req 3 — 429 before any write

    code = f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"   # 6-digit (Req 2.3)
    row = OtpCode(
        gym_id=gym.id,
        phone=normalized,
        code_hash=hash_password(code),                  # bcrypt hash only (Req 2.4, 6.1)
        expires_at=issued_at + CODE_TTL,                # now + 5 min, tz-aware (Req 2.4)
        attempts=0,
        consumed=False,
    )
    db.add(row)
    db.flush()                                          # service flushes; router commits

    result = deliverer.send(phone=normalized, code=code, gym=gym)   # Req 2.5 / 2.6
    expose = (not result.configured) and settings.ENVIRONMENT != "production"  # Req 2.7-2.9, 6.3
    return OtpRequestResult(
        sent=True,
        dev_code=code if expose else None,
        delivery=result,
    )


# ---------------- §3.7 Account provisioning / resolution ----------------

def _unique_member_email(db: Session, gym_id: int, phone: str) -> str:
    """Return a ``@members.local`` email free of the per-gym unique-email constraint.

    ``users.email`` is NOT NULL and unique per gym (``uq_user_gym_email``), yet an
    OTP member has no real email, so one is synthesized from the Normalized_Phone,
    mirroring ``members.py::set_member_credentials``. The canonical
    ``{phone}@members.local`` is used when free (Req 5.4); on collision a numeric
    suffix ``{phone}.{n}@members.local`` is tried in ascending order until a free one
    is found (Req 5.5). The bounded loop cannot realistically be exhausted, but a
    UUID-suffixed address is returned as a final guard so this always yields a usable,
    collision-free value rather than looping unbounded.
    """
    base = f"{phone}@{MEMBER_EMAIL_DOMAIN}"
    if db.scalar(select(User.id).where(User.gym_id == gym_id, User.email == base)) is None:
        return base
    for n in range(1, 1000):                                        # Req 5.5
        candidate = f"{phone}.{n}@{MEMBER_EMAIL_DOMAIN}"
        if db.scalar(
            select(User.id).where(User.gym_id == gym_id, User.email == candidate)
        ) is None:
            return candidate
    return f"{phone}.{uuid4().hex[:8]}@{MEMBER_EMAIL_DOMAIN}"


def provision_or_resolve_member(
    db: Session, gym_id: int, phone: str, now: datetime
) -> User:
    """Resolve the member-role ``User`` for ``phone`` in the gym, creating one if absent.

    Invoked by ``verify_otp`` once a submitted code matches, with ``phone`` already
    normalized. The resolution order guarantees AT MOST one Member_Profile and one
    Member_User per Normalized_Phone within the Target_Gym (Req 5.8):

      1. an existing Member_User — a ``role=member`` user in the gym whose own phone, or
         whose linked Member_Profile's phone, equals ``phone`` — is returned unchanged
         (Req 5.1);
      2. otherwise an unlinked Member_Profile (``user_id IS NULL``) with the matching
         phone is adopted (Req 5.2);
      3. otherwise a new Member_Profile is created via ``member.create_member`` — which
         assigns a per-gym-unique ``member_code`` through ``generate_member_code`` and
         sets ``status=active`` — with ``name`` defaulted to the phone (Req 5.3, 5.7).

    In cases (2) and (3) a Member_User is created with ``role=member``, ``is_active=True``,
    the Target_Gym's ``gym_id``, the member's ``phone`` and ``name``, a unique
    ``@members.local`` email (Req 5.4, 5.5), and a bcrypt hash of a random secret as its
    ``password_hash`` so the retired member-password path can never authenticate it
    (Req 5.6); the profile is then linked back via ``member.user_id`` (Req 5.2).

    The caller owns the transaction: this function only ``flush``es its inserts and lets
    the router ``commit``. ``now`` is accepted for signature symmetry with the verify
    caller and is intentionally unused here — ``last_login`` is stamped by ``verify_otp``,
    not during provisioning.
    """
    # 1) Existing Member_User for this phone — matched by the user's own phone or by a
    #    linked profile's phone (outer join so a user without a profile still matches).
    user = db.scalar(
        select(User)
        .join(Member, Member.user_id == User.id, isouter=True)
        .where(
            User.gym_id == gym_id,
            User.role == UserRole.member,
            or_(Member.phone == phone, User.phone == phone),
        )
    )
    if user is not None:
        return user                                                 # Req 5.1

    # 2) An unlinked Member_Profile with this phone — adopt it below (Req 5.2);
    # 3) otherwise create a fresh profile (Req 5.3, 5.7). create_member sets the
    #    per-gym-unique member_code and status=active.
    member = db.scalar(
        select(Member).where(
            Member.gym_id == gym_id,
            Member.phone == phone,
            Member.user_id.is_(None),
        )
    )
    if member is None:
        member = create_member(db, gym_id, MemberCreate(name=phone, phone=phone))

    # Create the Member_User and link the profile to it (Req 5.2-5.6).
    user = User(
        gym_id=gym_id,
        role=UserRole.member,
        is_active=True,
        email=_unique_member_email(db, gym_id, phone),             # Req 5.4, 5.5
        phone=phone,
        full_name=member.name,
        password_hash=hash_password(secrets.token_urlsafe(32)),    # unusable password (Req 5.6)
    )
    db.add(user)
    db.flush()
    member.user_id = user.id                                        # link profile -> user (Req 5.2)
    db.flush()
    return user


# ---------------- §3.6 verify_otp ----------------

def verify_otp(
    db: Session,
    phone: str,
    code: str,
    *,
    now: Clock = _utcnow,
) -> User:
    """Verify a submitted OTP ``code`` for ``phone`` and return the member ``User`` (§3.6).

    Final slice of the OTP service. Outcome ordering is load-bearing and mirrors the
    design's verify status matrix:

      1. resolve the Target_Gym — ``GymUnavailableError`` (-> 500) before any work
         (Req 1.6);
      2. normalize the phone with the SAME rule as ``request_otp`` but WITHOUT a length
         reject: a malformed phone simply matches no active code and falls through to the
         invalid/expired outcome (Req 4.1);
      3. select the NEWEST unconsumed, unexpired ``OtpCode`` for ``(gym_id, phone)``,
         ordered ``created_at DESC, id DESC`` (Req 4.2, 1.4). ``None`` ->
         ``InvalidCodeError`` (-> 400) and no token (Req 4.3);
      4. if that row already reached the attempt cap (``attempts >= MAX_ATTEMPTS``) ->
         ``TooManyAttemptsError`` (-> 429), evaluated BEFORE the code is compared so a
         capped code locks out rather than reporting a plain mismatch (Req 4.4 vs 4.5);
      5. bcrypt-compare the submitted code against ``code_hash``. On mismatch, increment
         ``attempts`` and ``db.commit()`` the increment BEFORE raising ``InvalidCodeError``
         (-> 400) (Req 4.5). The mid-function commit is mandatory: ``get_db`` closes the
         session without rolling back, so an un-committed increment would be discarded and
         the attempt cap would never engage (design §3.8);
      6. on match, mark the row ``consumed=True`` (single-use, Req 4.6), then
         provision/resolve the member ``User`` (Req 5). A resolved account with
         ``is_active`` false -> ``AccountDisabledError`` (-> 403) and no token (Req 5.9);
         otherwise stamp ``last_login`` (Req 5.10) and return the user so the router can
         commit once and issue tokens through ``_issue_tokens`` (Req 4.7, 1.5).

    The submitted code is compared in memory only; no raised error carries the code or the
    stored hash (Req 6.4). ``now`` is an injected clock read once so the expiry check,
    provisioning, and ``last_login`` share one deterministic instant; expiry is compared
    through ``_as_aware_utc`` so the check is timezone-robust on naive-``expires_at``
    SQLite as well as tz-aware Postgres, consistent with §3.3's rate-limit math. ``phone``
    and ``code`` are positional-or-keyword; the auth router passes them as keywords.
    """
    gym = resolve_target_gym(db)                        # Req 1.6 — 500 before any work
    normalized = normalize_phone(phone)                 # Req 4.1 — same rule, no length reject
    now_dt = _as_aware_utc(now())                       # read the clock once (tz-aware UTC)

    # Newest unconsumed code for (gym, phone), newest first. The non-temporal predicates
    # run in SQL; expiry is evaluated in Python via ``_as_aware_utc`` so the comparison
    # does not depend on how SQLite binds a tz-aware parameter inside a WHERE clause
    # (consistent with §3.3). Taken newest-first among unconsumed rows, the first still
    # unexpired row is the selected code (Req 4.2, 1.4).
    candidates = db.scalars(
        select(OtpCode)
        .where(
            OtpCode.gym_id == gym.id,
            OtpCode.phone == normalized,
            OtpCode.consumed.is_(False),
        )
        .order_by(OtpCode.created_at.desc(), OtpCode.id.desc())
    )
    row = next(
        (
            r
            for r in candidates
            if r.expires_at is not None and _as_aware_utc(r.expires_at) > now_dt
        ),
        None,
    )
    if row is None:                                     # Req 4.3 — no active code -> 400, no token
        raise InvalidCodeError("That code is invalid or has expired.")

    if row.attempts >= MAX_ATTEMPTS:                    # Req 4.4 — cap gate BEFORE comparing -> 429
        raise TooManyAttemptsError("Too many attempts. Request a new code.")

    if not verify_password(code, row.code_hash):        # Req 4.5 — code mismatch
        row.attempts += 1
        db.commit()                                     # durable increment survives get_db close
        raise InvalidCodeError("That code is invalid.")

    row.consumed = True                                 # Req 4.6 — single-use
    db.flush()

    user = provision_or_resolve_member(db, gym.id, normalized, now_dt)   # Req 5
    if not user.is_active:                              # Req 5.9 — disabled -> 403, no token
        raise AccountDisabledError("Account is disabled")
    user.last_login = now_dt                            # Req 5.10
    db.flush()
    return user                                         # Req 4.7 — router commits + issues tokens
