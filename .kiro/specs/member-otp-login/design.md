# Design Document

## Overview

This design adds passwordless, phone-first login for gym members to the existing single-gym Gym Management System. It introduces two additive endpoints under the existing `/api/v1/auth` prefix — `POST /auth/otp/request` and `POST /auth/otp/verify` — backed by a new `otp_codes` table, a new `app/services/otp.py` service, and additive Pydantic schemas in `app/schemas/auth.py`. On the frontend, `pages/Login.tsx` becomes mode-aware (Member phone+OTP vs. Staff email+password) and the zustand store in `src/lib/auth.ts` gains `otpRequest` / `otpVerify` actions. The existing `/auth/login`, `/auth/refresh`, `/auth/me`, and `/auth/change-password` endpoints and their password authentication are left untouched.

The design reuses existing building blocks: `hash_password` / `verify_password` (bcrypt) in `app/core/security.py` for code hashing, `_issue_tokens` in `app/api/v1/routers/auth.py` for the JWT token shape, `WhatsAppSender` in `app/services/notification.py` for delivery, and `create_member` / `generate_member_code` plus the `{phone}@members.local` email pattern (already used by `members.py::set_member_credentials`) for account provisioning.

The feature is fully testable locally with no provider configured: the WhatsApp channel runs as a simulated dry-run when unconfigured, and the raw code is surfaced through a `dev_code` response field only when the provider is unconfigured **and** `ENVIRONMENT != production`. Delivery and the clock are injectable so request/verify/rate-limit/expiry/attempt behavior can be tested offline and without real time.

**Implementation language:** Python 3 (backend, SQLAlchemy 2.0 typed models, FastAPI) and TypeScript/React (frontend). No pseudocode — the Tasks phase does not need to ask for a language.

### Design goals and constraints

- **Secure by default:** only bcrypt hashes persisted; raw code never stored or logged; single-use + attempt cap + per-phone rate limits.
- **Single-gym tenancy:** every OTP read/write and every provisioned account is scoped to the Target_Gym (the bootstrapped gym resolved by slug).
- **Additive:** no change to the request contract or behavior of existing auth endpoints or password login.
- **Deterministic & offline-testable:** delivery and time are injected; the unconfigured dry-run + `dev_code` path enables end-to-end request→verify→token tests with no network and no real clock.

### End-to-end flow

```
Member (phone-first)                 Backend                              DB / Provider
--------------------                 -------                              -------------
POST /auth/otp/request {phone}  -->  normalize + validate (8..15 digits)
                                     resolve Target_Gym (slug)
                                     rate-limit checks (60s + 5/hr)
                                     generate 6-digit code
                                     bcrypt-hash + store OtpCode      -->  INSERT otp_codes (hash only)
                                     deliver via WhatsApp (or dry-run)-->  provider / simulated
<-- 200 {sent:true, dev_code?}       dev_code only if unconfigured+dev

POST /auth/otp/verify {phone,code}-> normalize
                                     select newest unconsumed/unexpired -->  SELECT otp_codes
                                     attempts>=5? -> 429
                                     verify_password(code, hash)
                                       mismatch -> attempts++ (commit) -->  UPDATE attempts; 400
                                       match    -> consumed=true
                                     resolve / provision Member_User  -->  SELECT/INSERT members, users
                                     is_active? (403 if not)
                                     last_login = now
<-- 200 Token{access,refresh}        _issue_tokens(user)
```

## Architecture

### Component map

| Layer | File | Change | Responsibility |
|-------|------|--------|----------------|
| Model | `app/models/otp.py` *(new)* | add | `OtpCode` ORM model + indexes |
| Model registry | `app/models/__init__.py` | edit | import `OtpCode` so `Base.metadata` includes `otp_codes` |
| Migration | `alembic/versions/20260103_0000_otp_codes.py` *(new)* | add | `checkfirst` create/drop of `otp_codes`, chained after `0002_branches` |
| Service | `app/services/otp.py` *(new)* | add | normalization, request/verify logic, rate limits, delivery seam, provisioning, typed errors |
| Schemas | `app/schemas/auth.py` | edit (additive) | `OtpRequestIn`, `OtpRequestOut`, `OtpVerifyIn` |
| Router | `app/api/v1/routers/auth.py` | edit (additive) | `POST /auth/otp/request`, `POST /auth/otp/verify`, error→HTTP mapping, DI for clock + deliverer |
| Frontend store | `frontend/src/lib/auth.ts` | edit (additive) | `otpRequest(phone)`, `otpVerify(phone, code)` actions |
| Frontend page | `frontend/src/pages/Login.tsx` | rewrite | mode-aware Member (phone+OTP) / Staff (email+password) |
| Frontend types | `frontend/src/lib/types.ts` | edit (additive) | `OtpRequestResponse` type |

### Separation of concerns (mirrors existing services)

Following `app/services/attendance.py` and `app/services/notification.py`, the OTP **service** holds all business logic as functions over `db` and flushes; the **router** owns HTTP concerns (status codes, response shaping, commit) and maps the service's typed exceptions to HTTP responses. One deliberate exception to "router commits" is documented below: `verify_otp` commits the attempt-counter increment itself on a wrong guess so the attempt cap survives a failed request (see Transaction boundaries).

## Components and Interfaces

### 1. Data model — `OtpCode` (`app/models/otp.py`)

```python
"""One-time passcode records for passwordless member login."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class OtpCode(Base, TimestampMixin):
    __tablename__ = "otp_codes"
    __table_args__ = (
        Index("ix_otp_codes_gym_phone", "gym_id", "phone"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    phone: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    gym = relationship("Gym")
```

- `TimestampMixin` supplies `created_at` / `updated_at` (used for ordering and the rate-limit windows), consistent with every other model (Req 7.1).
- FK to `gyms.id` with `ON DELETE CASCADE`; the `gym_id` column is indexed (via `index=True`) and `phone` is indexed, plus a composite `(gym_id, phone)` index for the selection and rate-limit queries (Req 7.2).
- Registered on the shared metadata by adding `from app.models.otp import OtpCode` and `"OtpCode"` to `app/models/__init__.py`, so `Base.metadata.create_all` includes `otp_codes` on fresh databases and in the in-memory test harness (Req 7.3).

### 2. Migration (`alembic/versions/20260103_0000_otp_codes.py`)

This is the project's first real schema-change migration. It follows the inspect-guarded `checkfirst=True` pattern established by `20260102_0000_branches.py`: a no-op on fresh databases (where `0001_initial`'s `create_all` already created the table) and a real `CREATE TABLE` on existing deployed databases.

```python
"""add otp_codes table

Creates the otp_codes table. Uses checkfirst so it is a no-op on fresh
databases (where 0001_initial's create_all already made it) and creates it
on existing deployed databases.

Revision ID: 0003_otp_codes
Revises: 0002_branches
Create Date: 2026-01-03 00:00:00
"""
from typing import Sequence, Union

from alembic import op

from app.models.otp import OtpCode

revision: str = "0003_otp_codes"
down_revision: Union[str, None] = "0002_branches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    OtpCode.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    OtpCode.__table__.drop(bind=op.get_bind(), checkfirst=True)
```

**Revision wiring:** the chain becomes `0001_initial → 0002_branches → 0003_otp_codes`. `down_revision = "0002_branches"` (Req 7.4). `Table.create(..., checkfirst=True)` performs an existence check and creates only if absent (Req 7.5); `Table.drop(..., checkfirst=True)` drops only if present (Req 7.6). Importing the model is sufficient to resolve its `__table__`; because the FK targets `gyms` (already present), no ordering concerns arise.

### 3. OTP service (`app/services/otp.py`)

#### 3.1 Constants, clock, and typed errors

```python
CODE_LENGTH = 6                     # 6-digit numeric code (Req 2.3)
CODE_TTL = timedelta(minutes=5)     # expiry window (Req 2.4)
MAX_ATTEMPTS = 5                    # per-code attempt cap (Req 4.4)
RESEND_COOLDOWN = timedelta(seconds=60)   # Req 3.1
HOURLY_WINDOW = timedelta(minutes=60)     # Req 3.2
HOURLY_LIMIT = 5                          # Req 3.2
MIN_DIGITS, MAX_DIGITS = 8, 15            # Req 2.2
MEMBER_EMAIL_DOMAIN = "members.local"     # Req 5.4

Clock = Callable[[], datetime]
def _utcnow() -> datetime: return datetime.now(timezone.utc)

class OtpError(Exception): ...
class InvalidPhoneError(OtpError): ...          # -> 422
class RateLimitedError(OtpError):               # -> 429 (+ Retry-After)
    def __init__(self, retry_after: int, message: str): ...
class GymUnavailableError(OtpError): ...        # -> 500
class InvalidCodeError(OtpError): ...           # -> 400 (invalid or expired / mismatch)
class TooManyAttemptsError(OtpError): ...       # -> 429
class AccountDisabledError(OtpError): ...        # -> 403
```

The service never raises `HTTPException`; it raises these framework-agnostic errors and the router maps them (keeps the service unit-testable without HTTP).

#### 3.2 Phone normalization (`normalize_phone`)

```python
def normalize_phone(raw: str) -> str:
    """Keep an optional leading '+' then digits only (Req 2.1)."""
    s = (raw or "").strip()
    plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    return ("+" + digits) if plus else digits
```

Pure and deterministic. `request_otp` additionally enforces the digit-count bound and raises `InvalidPhoneError` when the digit count is `< 8` or `> 15` (Req 2.2). `verify_otp` normalizes with the same function but does not length-reject — a malformed phone simply matches no active code and yields the invalid/expired outcome (Req 4.1).

#### 3.3 Target gym resolution (`resolve_target_gym`)

```python
def _bootstrap_slug() -> str:
    # same slug rule the bootstrap seed uses (default BOOTSTRAP_GYM_NAME "My Gym" -> "my-gym")
    s = re.sub(r"[^a-z0-9]+", "-", settings.BOOTSTRAP_GYM_NAME.strip().lower())
    return s.strip("-") or "gym"

def resolve_target_gym(db: Session) -> Gym:
    gym = db.scalar(select(Gym).where(Gym.slug == _bootstrap_slug()))
    if gym is None:
        raise GymUnavailableError("Gym is not available")
    return gym
```

Resolves the single bootstrapped gym by slug (Req 1.3); on failure raises `GymUnavailableError` **before any write**, so the endpoints answer 500 and persist nothing (Req 1.6). The slug rule mirrors `app/db/seed.py::_slug`; a follow-up refactor may promote that helper to a shared util, but the rule is duplicated deliberately here to avoid importing the seed module (which binds the production engine at import).

#### 3.4 Delivery seam (injectable, member-independent)

To satisfy "store only the hash" **including the notification log payload** (Req 6.1), OTP delivery does **not** go through `notification.dispatch` (which persists a `Notification` row whose payload contains the rendered body, and which requires a `member_id` that may not exist yet for a brand-new phone). Instead a thin, member-independent deliverer wraps the existing `WhatsAppSender`:

```python
@dataclass
class DeliveryResult:
    configured: bool
    simulated: bool
    provider_ref: str

class OtpDeliverer(Protocol):
    def is_configured(self) -> bool: ...
    def send(self, *, phone: str, code: str, gym: Gym) -> DeliveryResult: ...

class WhatsAppOtpDeliverer:
    def __init__(self, sender: Optional[WhatsAppSender] = None):
        self._sender = sender or WhatsAppSender()
    def is_configured(self) -> bool:
        return self._sender.is_configured()            # both WHATSAPP_* settings set (Req 2.5/2.6)
    def send(self, *, phone, code, gym) -> DeliveryResult:
        if not self.is_configured():
            return DeliveryResult(False, True, f"dryrun:whatsapp:{uuid4().hex[:12]}")  # Req 2.6
        ref = self._sender.send(to=phone, subject="",
                                body=f"Your {gym.name} login code is {code}. It expires in 5 minutes.")
        return DeliveryResult(True, False, ref)          # Req 2.5
```

The raw code is passed only to the provider call and is never persisted or returned by the deliverer. Tests inject a `RecordingDeliverer` that captures `(phone, code)` in memory and reports a configurable `is_configured()` — no network, fully deterministic.

#### 3.5 `request_otp`

```python
@dataclass
class OtpRequestResult:
    sent: bool
    dev_code: Optional[str]      # set only when unconfigured + non-production
    delivery: DeliveryResult

def request_otp(db: Session, *, phone: str, deliverer: OtpDeliverer,
                now: Clock = _utcnow) -> OtpRequestResult:
    gym = resolve_target_gym(db)                       # 500 if unresolved (Req 1.6)
    normalized = normalize_phone(phone)
    digits = normalized.lstrip("+")
    if not (MIN_DIGITS <= len(digits) <= MAX_DIGITS):
        raise InvalidPhoneError("Enter a valid mobile number.")   # 422 (Req 2.2)

    _enforce_rate_limits(db, gym.id, normalized, now())           # 429 before any write (Req 3)

    code = f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"  # 6-digit (Req 2.3)
    row = OtpCode(gym_id=gym.id, phone=normalized,
                  code_hash=hash_password(code),                  # bcrypt hash only (Req 2.4, 6.1)
                  expires_at=now() + CODE_TTL, attempts=0, consumed=False)
    db.add(row); db.flush()

    result = deliverer.send(phone=normalized, code=code, gym=gym) # Req 2.5 / 2.6
    expose = (not result.configured) and settings.ENVIRONMENT != "production"  # Req 2.7-2.9, 6.3
    return OtpRequestResult(sent=True, dev_code=(code if expose else None), delivery=result)
```

Rate-limit helper (counts existing rows for the phone in the Target_Gym; no writes):

```python
def _enforce_rate_limits(db, gym_id, phone, now):
    base = select(OtpCode).where(OtpCode.gym_id == gym_id, OtpCode.phone == phone)
    last = db.scalar(base.order_by(OtpCode.created_at.desc()))
    if last and (now - last.created_at) < RESEND_COOLDOWN:        # Req 3.1
        wait = int((RESEND_COOLDOWN - (now - last.created_at)).total_seconds()) + 1
        raise RateLimitedError(wait, "Please wait before requesting another code.")
    recent = db.scalar(select(func.count()).select_from(OtpCode).where(
        OtpCode.gym_id == gym_id, OtpCode.phone == phone,
        OtpCode.created_at >= now - HOURLY_WINDOW))
    if (recent or 0) >= HOURLY_LIMIT:                             # Req 3.2
        raise RateLimitedError(3600, "Too many code requests. Try again later.")
```

The rate-limit messages name which limit was exceeded (Req 3.3). Both checks run **before** `OtpCode` creation, so a rejected request writes nothing (Req 3.1, 3.2).

> **Timezone note:** `created_at` is written by `server_default=func.now()`. On SQLite it is naive; the service compares against an injected `now`. Tests inject a clock that returns values comparable to stored `created_at` (and, for the service-level rate-limit/expiry tests, set `created_at` explicitly), keeping comparisons deterministic across SQLite and Postgres.

#### 3.6 `verify_otp`

```python
def verify_otp(db: Session, *, phone: str, code: str, now: Clock = _utcnow) -> User:
    gym = resolve_target_gym(db)                       # 500 if unresolved (Req 1.6)
    normalized = normalize_phone(phone)                # same rule as request (Req 4.1)

    row = db.scalar(select(OtpCode).where(             # newest unconsumed, unexpired (Req 4.2)
        OtpCode.gym_id == gym.id, OtpCode.phone == normalized,
        OtpCode.consumed.is_(False), OtpCode.expires_at > now()
    ).order_by(OtpCode.created_at.desc(), OtpCode.id.desc()))
    if row is None:
        raise InvalidCodeError("That code is invalid or has expired.")   # 400 (Req 4.3)
    if row.attempts >= MAX_ATTEMPTS:
        raise TooManyAttemptsError("Too many attempts. Request a new code.")  # 429 (Req 4.4)
    if not verify_password(code, row.code_hash):
        row.attempts += 1
        db.commit()                                    # durable increment, then reject (Req 4.5)
        raise InvalidCodeError("That code is invalid.")                   # 400
    row.consumed = True                                # single-use (Req 4.6)
    db.flush()

    user = provision_or_resolve_member(db, gym.id, normalized, now())     # Req 5
    if not user.is_active:
        raise AccountDisabledError("Account is disabled")                 # 403 (Req 5.9)
    user.last_login = now()                            # Req 5.10
    db.flush()
    return user                                        # router commits + issues tokens (Req 4.7)
```

Outcome ordering is significant: the max-attempts gate is evaluated **on the selected row before** comparing the code, so once a code reaches 5 attempts the next verify returns 429 rather than 400 (Req 4.4 vs 4.5). The three failure outcomes exposed are **invalid-or-expired (400)**, **invalid (400)**, and **too-many-attempts (429)** — none reveals the stored code or hash (Req 6.4).

#### 3.7 Account provisioning (`provision_or_resolve_member`)

Reuses `generate_member_code` and the `{phone}@members.local` pattern (mirroring `members.py::set_member_credentials`). Resolution order guarantees at most one profile and one user per phone per gym (Req 5.8):

```python
def provision_or_resolve_member(db, gym_id, phone, now) -> User:
    # 1) Existing Member_User for this phone (by linked profile phone or user.phone)
    user = db.scalar(
        select(User).join(Member, Member.user_id == User.id, isouter=True)
        .where(User.gym_id == gym_id, User.role == UserRole.member,
               or_(Member.phone == phone, User.phone == phone)))
    if user is not None:
        return user                                    # Req 5.1

    # 2) Member_Profile without a linked user
    member = db.scalar(select(Member).where(
        Member.gym_id == gym_id, Member.phone == phone, Member.user_id.is_(None)))

    if member is None:                                 # 3) neither exists -> create profile
        member = create_member(db, gym_id, MemberCreate(name=phone, phone=phone))  # Req 5.3, 5.7

    user = User(gym_id=gym_id, role=UserRole.member, is_active=True,   # Req 5.2/5.3/5.4
                email=_unique_member_email(db, gym_id, phone),         # Req 5.4, 5.5
                phone=phone, full_name=member.name,
                password_hash=hash_password(secrets.token_urlsafe(32)))  # unusable (Req 5.6)
    db.add(user); db.flush()
    member.user_id = user.id                           # link (Req 5.2)
    db.flush()
    return user

def _unique_member_email(db, gym_id, phone) -> str:
    base = f"{phone}@{MEMBER_EMAIL_DOMAIN}"
    if not db.scalar(select(User.id).where(User.gym_id == gym_id, User.email == base)):
        return base
    for n in range(1, 1000):                           # satisfy (gym_id, email) unique (Req 5.5)
        cand = f"{phone}.{n}@{MEMBER_EMAIL_DOMAIN}"
        if not db.scalar(select(User.id).where(User.gym_id == gym_id, User.email == cand)):
            return cand
    return f"{phone}.{uuid4().hex[:8]}@{MEMBER_EMAIL_DOMAIN}"
```

`create_member` already assigns a per-gym-unique `member_code` via `generate_member_code` and sets `status=active`; the OTP service passes `name=phone` (admins can rename later) and `phone=normalized` (Req 5.7). New users get `role=member`, `is_active=true`, `gym_id=Target_Gym`, and the synthesized/unique email (Req 5.4, 5.5), with a random, unshared password hash so the retired member-password path cannot authenticate them (Req 5.6).

#### 3.8 Transaction boundaries

- **request:** rate-limit checks precede the single `OtpCode` insert; the router commits after a successful return. A rejected request (422/429/500) performs no write.
- **verify, wrong code:** the service increments `attempts` and **commits immediately**, then raises `InvalidCodeError`. This is required because `get_db` closes the session without rolling back, so an uncommitted increment would be discarded and the attempt cap would never engage.
- **verify, success:** the service flushes `consumed`, provisioning rows, and `last_login`; the router commits once and issues tokens. If provisioning raises (e.g., `AccountDisabledError`), the router does not commit the provisioning writes; the code was marked consumed and that flush is rolled back on close — acceptable because a disabled account must not advance, and the member will request a fresh code if later re-enabled.

### 4. Schemas (`app/schemas/auth.py`, additive)

```python
class OtpRequestIn(BaseModel):
    phone: str = Field(min_length=3, max_length=32)

class OtpRequestOut(BaseModel):
    sent: bool
    dev_code: Optional[str] = None       # only in dev + unconfigured provider
    retry_after: Optional[int] = None    # reserved; populated in the 429 body (see below)

class OtpVerifyIn(BaseModel):
    phone: str = Field(min_length=3, max_length=32)
    code: str = Field(min_length=4, max_length=10)
```

`Token`, `RefreshRequest`, `UserOut`, `ChangePasswordRequest` are unchanged (Req 1.2). Verify returns the existing `Token` (Req 1.5).

### 5. Endpoints (`app/api/v1/routers/auth.py`, additive)

Two dependencies make the clock and deliverer injectable (overridable in tests via `app.dependency_overrides`), without touching the existing handlers:

```python
def get_clock() -> otp_service.Clock:
    return otp_service._utcnow

def get_otp_deliverer() -> otp_service.OtpDeliverer:
    return otp_service.WhatsAppOtpDeliverer()

@router.post("/otp/request", response_model=OtpRequestOut)
def otp_request(db: DbSession, body: OtpRequestIn,
                deliverer=Depends(get_otp_deliverer), now=Depends(get_clock)):
    try:
        result = otp_service.request_otp(db, phone=body.phone, deliverer=deliverer, now=now)
    except otp_service.InvalidPhoneError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    except otp_service.RateLimitedError as e:
        return JSONResponse(status_code=429,
            content={"detail": str(e), "retry_after": e.retry_after},
            headers={"Retry-After": str(e.retry_after)})
    except otp_service.GymUnavailableError:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Gym is not available")
    db.commit()
    return OtpRequestOut(sent=True, dev_code=result.dev_code)   # 200 (Req 2.10)

@router.post("/otp/verify", response_model=Token)
def otp_verify(db: DbSession, body: OtpVerifyIn, now=Depends(get_clock)):
    try:
        user = otp_service.verify_otp(db, phone=body.phone, code=body.code, now=now)
    except otp_service.InvalidCodeError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except otp_service.TooManyAttemptsError as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(e))
    except otp_service.AccountDisabledError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")
    except otp_service.GymUnavailableError:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Gym is not available")
    db.commit()
    return _issue_tokens(user)                                  # existing shape (Req 1.5, 4.7)
```

The rate-limit rejection returns a JSON body `{detail, retry_after}` plus a `Retry-After` header so the frontend can render a countdown. The two new routes mount at `/api/v1/auth/otp/request` and `/api/v1/auth/otp/verify` (Req 1.1); nothing else in the router changes (Req 1.2). `JSONResponse` is imported from `fastapi.responses`.

### 6. Frontend — auth store (`src/lib/auth.ts`, additive)

```ts
interface OtpRequestResponse { sent: boolean; dev_code?: string | null; retry_after?: number | null; }

interface AuthState {
  // ...existing: tokens, user, loading, login, loadMe, refresh, logout
  otpRequest: (phone: string) => Promise<OtpRequestResponse>;
  otpVerify: (phone: string, code: string) => Promise<void>;
}

async otpRequest(phone) {
  const { data } = await raw.post<OtpRequestResponse>("/auth/otp/request", { phone });
  return data;                                   // Login page surfaces dev_code / retry_after
},
async otpVerify(phone, code) {
  const { data } = await raw.post<Tokens>("/auth/otp/verify", { phone, code });
  set({ tokens: data });                         // store tokens (Req 8.8)
  await get().loadMe();                          // load current user (Req 8.8)
},
```

`login` (email+password), `loadMe`, `refresh`, and `logout` are unchanged (Req 1.2). Actions post JSON to the two endpoints (Req 8.7).

### 7. Frontend — login page (`src/pages/Login.tsx`, rewrite)

A `mode` state (`"member" | "staff"`) toggles two forms on one page:

- **Member mode (default, phone-first):** step 1 collects a mobile number and calls `otpRequest`; on success it advances to step 2 (6-digit code entry) and, in dev, shows `dev_code` (Req 8.1, 8.2, 8.9). Step 2 has a code input, a **Verify** action calling `otpVerify`, and a **Resend** action that re-calls `otpRequest` (disabled during a `retry_after` countdown derived from the 429 `Retry-After`/`retry_after`). On verify success it navigates to `/portal` (Req 8.3). No password field appears in member mode (Req 8.6).
- **Staff mode:** the existing email+password form calling `login`; on success it navigates to `/app` (Req 8.4, 8.5).
- A mode control (link/segmented toggle) switches between the two (Req 8.4).
- Errors from request/verify set an inline message and preserve entered input (phone, code, and step) instead of resetting the form (Req 8.10); messages use the existing `apiErrorMessage` helper, which already renders the string `detail` our 400/422/429/403 responses return.

Dev detection uses Vite's `import.meta.env.DEV` to decide whether to render the `dev_code` hint; the value is only present in responses when the backend also deems it safe, so the gate is defense-in-depth, not the primary control.

### 8. Frontend — portal (`/portal`, unchanged behavior)

`ProtectedRoute` + `PortalLayout` already load the current user via `/auth/me` and render `MemberPortalPage`, which calls the `/api/v1/me/*` portal endpoints. An OTP-provisioned `Member_User` has `role=member` and a linked `Member` profile, so `portal.py::_member` resolves it and returns only that member's records (Req 9.1). The portal already surfaces active plans as read-only and offers no online enrollment/payment action, satisfying Req 9.2 and 9.3 with no change; this phase only confirms the OTP-provisioned user resolves through `/me`.

## Data Models

`otp_codes` table (created by `Base.metadata.create_all` on fresh DBs and by `0003_otp_codes` on existing DBs):

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer PK | no | |
| `gym_id` | integer FK→`gyms.id` ON DELETE CASCADE | no | indexed; part of `(gym_id, phone)` index |
| `phone` | varchar(30) | no | Normalized_Phone; indexed |
| `code_hash` | varchar(255) | no | bcrypt hash of the 6-digit code — never the raw code |
| `expires_at` | timestamptz | no | `created_at + 5 min` |
| `attempts` | integer | no | default 0; incremented on each wrong guess; cap 5 |
| `consumed` | boolean | no | default false; set true on a correct guess (single-use) |
| `created_at` | timestamptz | no | `TimestampMixin`; drives ordering + rate-limit windows |
| `updated_at` | timestamptz | no | `TimestampMixin` |

Indexes: `ix_otp_codes_gym_id` (FK column), `ix_otp_codes_phone`, composite `ix_otp_codes_gym_phone (gym_id, phone)`.

## Error Handling

The service raises framework-agnostic typed errors; the router maps each to an HTTP status. The matrices below are the complete status contract for the two endpoints.

### `POST /api/v1/auth/otp/request`

| Condition | Service signal | HTTP | Body / headers | Requirement |
|-----------|----------------|------|----------------|-------------|
| Code issued | `OtpRequestResult(sent=True, …)` | 200 | `{sent:true, dev_code?}` | 2.10, 2.7–2.9 |
| Phone digits `<8` or `>15` | `InvalidPhoneError` | 422 | `{detail}`; no row written | 2.2 |
| Within 60s of last accepted request | `RateLimitedError(cooldown)` | 429 | `{detail, retry_after}` + `Retry-After`; no row | 3.1, 3.3 |
| ≥5 requests in last 60 min | `RateLimitedError(hourly)` | 429 | `{detail, retry_after}` + `Retry-After`; no row | 3.2, 3.3 |
| Target_Gym unresolved | `GymUnavailableError` | 500 | `{detail}`; no row, no account change | 1.6 |

### `POST /api/v1/auth/otp/verify`

| Condition | Service signal | HTTP | Body | Requirement |
|-----------|----------------|------|------|-------------|
| Correct code, active account | returns `User` | 200 | `Token{access,refresh,token_type}` | 4.7, 1.5 |
| No unconsumed/unexpired code | `InvalidCodeError` | 400 | `{detail:"invalid or expired"}` | 4.3, 6.4 |
| Code mismatch (attempts `<5`) | `InvalidCodeError` (after `attempts++` committed) | 400 | `{detail:"invalid"}` | 4.5, 6.4 |
| Selected code `attempts >= 5` | `TooManyAttemptsError` | 429 | `{detail:"too many attempts"}` | 4.4, 6.4 |
| Resolved user `is_active=false` | `AccountDisabledError` | 403 | `{detail:"Account is disabled"}` | 5.9 |
| Target_Gym unresolved | `GymUnavailableError` | 500 | `{detail}`; no account change | 1.6 |
| Missing `phone`/`code` field | Pydantic validation | 422 | standard FastAPI error array | — |

## Security

- **Hashing (Req 6.1):** only `hash_password(code)` (bcrypt) is persisted in `code_hash`. The raw code exists in memory only during `request_otp` and is passed solely to the deliverer. No column, no `Notification` row, and no log line stores the raw code. OTP delivery deliberately bypasses `notification.dispatch` so the raw code never lands in a persisted notification payload.
- **Logging (Req 6.2):** the service logs no code value in any environment. Any structured log line about delivery records only the provider ref / `simulated` flag and the normalized phone — never the code.
- **`dev_code` gating (Req 2.7–2.9, 6.3):** `dev_code` is returned **iff** the provider is unconfigured **and** `ENVIRONMENT != "production"`. In production, or whenever both `WHATSAPP_API_URL` and `WHATSAPP_API_TOKEN` are set, the field is omitted. This is the only path by which the raw code leaves the delivery provider.
- **Brute-force resistance (Req 3, 4.4–4.6):** per-code single-use (`consumed`) + a 5-attempt cap + a 5-minute TTL + per-phone 60-second cooldown and 5/hour cap. The global `slowapi` IP limiter (200/min, already in `main.py`) remains as defense-in-depth.
- **Unusable password (Req 5.6):** provisioned member users get `hash_password(secrets.token_urlsafe(32))`, a random secret that is never shared, so password login cannot succeed for OTP-provisioned accounts even though the backend password login endpoint is unchanged.
- **Tenancy (Req 1.3, 1.4):** every OTP read/write filters by `gym_id = Target_Gym.id`; provisioned members/users carry that `gym_id`.
- **No enumeration:** a successful request always answers `200 {sent:true}` regardless of whether the phone maps to an existing member, and verify failures use generic invalid/expired wording — neither reveals account existence or the stored secret (Req 6.4).
- **Token parity (Req 1.5):** verify issues tokens through the existing `_issue_tokens`, preserving `role` and `gym_id` claims; no new token logic.

## Testing Strategy

All tests run offline and deterministically on the existing in-memory SQLite harness (`backend/tests/conftest.py`), which already creates every model table from `Base.metadata` (so `otp_codes` is present once the model is registered), overrides `get_db`, disables the `slowapi` limiter, and zeroes integration credentials (so the provider is always unconfigured in tests → the dry-run + `dev_code` path is active).

**Determinism levers:**
- **Injected clock:** service functions accept `now`; tests pass a controllable clock and/or set `OtpCode.created_at`/`expires_at` directly to exercise cooldown windows, the hourly window, and expiry without sleeping.
- **Injected deliverer:** a `RecordingDeliverer` captures `(phone, code)` and reports a chosen `is_configured()`; no network. Endpoint tests override `get_otp_deliverer` / `get_clock` via `app.dependency_overrides`.
- **End-to-end without knowing the code:** because the harness leaves the provider unconfigured and `ENVIRONMENT` defaults to development, `request` returns `dev_code`; a test reads it and posts it to `verify` to get tokens — no reliance on the raw code internals.

**Dual approach:**
- **Property-based tests** (Hypothesis) for the universally-quantified logic below — normalization, length validation, record invariants, hash secrecy, rate limits, selection, attempt cap, single-use, provisioning uniqueness, and `dev_code` gating. Minimum 100 iterations per property; mock/inject delivery and clock so iterations stay cheap and offline.
- **Example/integration tests** for concrete flows and wiring: request→verify→token happy path via `dev_code`; wrong code → 400 with a durably incremented counter; expiry → 400; attempt lockout → 429; cooldown/hourly → 429 with `Retry-After`; disabled account → 403; existing-member resolution and new-member provisioning (exactly one profile + user); and a regression test asserting `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/change-password` are unchanged. A migration smoke test runs `0003_otp_codes` upgrade/downgrade twice to confirm the `checkfirst` no-op/idempotence.
- **Not property-tested:** the frontend React page and the portal rendering (example/interaction tests only), the live WhatsApp network call (integration concern, mocked), and the Alembic migration (smoke test, not PBT).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

These properties cover the testable backend logic of `app/services/otp.py` (normalization, request/verify, rate limits, provisioning). Each is universally quantified and verified with injected delivery and clock so iterations are offline and deterministic (minimum 100 iterations per property; tag format **Feature: member-otp-login, Property N: {title}**). Delivery wiring (2.5, 2.6), the migration (7.x), the frontend (8.x), and the unchanged portal (9.x) are covered by example/integration/smoke tests, not property tests.

### Property 1: Phone normalization is deterministic and canonical

For any raw phone string, `normalize_phone` returns the optional leading `+` followed only by the digits of the input in order (all spaces and separator characters removed), the result matches `^\+?\d+$` (or is empty when the input has no digits), and applying `normalize_phone` again returns the same value (idempotence).

**Validates: Requirements 2.1, 4.1**

### Property 2: Out-of-range phone numbers are rejected without persistence

For any phone whose normalized digit count is fewer than 8 or more than 15, `request_otp` raises `InvalidPhoneError` (mapped to HTTP 422) and creates no `OtpCode` row.

**Validates: Requirements 2.2**

### Property 3: A successful request persists exactly one canonical, hashed, gym-scoped, unconsumed code

For any phone whose normalized digit count is 8–15 and that is within the per-phone limits, `request_otp` creates exactly one `OtpCode` row in which: the issued code matches `^\d{6}$`; `code_hash` is not equal to the raw code and `verify_password(code, code_hash)` is true; `phone` equals the normalized phone; `gym_id` equals the Target_Gym id; `expires_at` equals `created_at + 5 minutes`; `attempts` is 0; `consumed` is false; and no persisted field anywhere equals the raw code.

**Validates: Requirements 1.4, 2.3, 2.4, 6.1**

### Property 4: `dev_code` is exposed only in development with an unconfigured provider

For any successful request, the response contains a non-null `dev_code` equal to the issued code if and only if the delivery provider is unconfigured **and** `ENVIRONMENT` is not `production`; in every other combination `dev_code` is absent and no response field contains the raw code.

**Validates: Requirements 2.7, 2.8, 2.9, 6.3**

### Property 5: The resend cooldown blocks a too-soon request without persistence

For any phone with a most-recent accepted request at time `t`, any subsequent `request_otp` at a time less than 60 seconds after `t` raises `RateLimitedError` (HTTP 429) and creates no new `OtpCode` row, while a request at 60 seconds or later (within the hourly cap) is accepted.

**Validates: Requirements 3.1**

### Property 6: The hourly cap blocks further requests within the window without persistence

For any phone that already has 5 `OtpCode` rows created within the preceding 60 minutes in the Target_Gym, the next `request_otp` raises `RateLimitedError` (HTTP 429) and creates no new row; rows created more than 60 minutes earlier do not count toward the cap.

**Validates: Requirements 3.2**

### Property 7: Verification selects the newest unconsumed, unexpired code for the phone in the gym

For any set of stored `OtpCode` rows, `verify_otp` selects the row with the greatest `created_at` among those whose `gym_id` equals the Target_Gym id, whose `phone` equals the normalized phone, whose `consumed` is false, and whose `expires_at` is later than the current time; rows in another gym, consumed rows, and expired rows are never selected.

**Validates: Requirements 4.2, 1.4**

### Property 8: With no active code, verification is rejected and issues no token

For any phone that has no unconsumed, unexpired code in the Target_Gym (none issued, all consumed, or all expired), `verify_otp` raises `InvalidCodeError` (HTTP 400) and issues no token.

**Validates: Requirements 4.3**

### Property 9: A wrong code increments the attempt counter and is rejected

For any active code with `attempts` below 5 and any submitted code that does not match the stored hash, `verify_otp` increments that row's `attempts` by exactly 1 (and the increment is durably committed), leaves `consumed` false, raises `InvalidCodeError` (HTTP 400), and issues no token.

**Validates: Requirements 4.5**

### Property 10: A code at the attempt cap is locked out

For any selected code whose `attempts` is 5 or greater, `verify_otp` raises `TooManyAttemptsError` (HTTP 429), issues no token, and leaves the row unconsumed and its `attempts` unchanged, even when the submitted code is the correct one.

**Validates: Requirements 4.4**

### Property 11: A correct code authenticates exactly once and cannot be reused

For any active code with `attempts` below 5, submitting the matching code sets the row's `consumed` to true, resolves an active member user, and yields an HTTP 200 token response; any later `verify_otp` using that same code is rejected with `InvalidCodeError` (HTTP 400) because the row is now consumed.

**Validates: Requirements 4.6, 4.7**

### Property 12: Repeated verification for a phone resolves a single member user and profile

For any phone, performing one or more successful verifications (each with a fresh code) in the Target_Gym results in at most one `Member` profile and at most one member `User` for that normalized phone, and every such verification returns the same user id — whether the account pre-existed as a linked member-user, pre-existed as an unlinked profile (then linked), or did not exist (then created).

**Validates: Requirements 5.1, 5.2, 5.3, 5.8**

### Property 13: A provisioned account satisfies the member invariants

For any phone with no prior account, a successful verification creates a `User` with `role = member`, `is_active = true`, `gym_id = Target_Gym`, and an `email` ending in `@members.local` that is unique under the per-gym `(gym_id, email)` constraint (distinct from any pre-existing `{phone}@members.local`), whose `password_hash` verifies against no guessable password (including the empty string and the phone itself), linked to a `Member` whose `member_code` is unique within the gym and whose `phone` equals the normalized phone.

**Validates: Requirements 5.4, 5.5, 5.6, 5.7**

### Property 14: A disabled account is refused a token

For any phone that resolves to a member user whose `is_active` is false, a verification with the correct code raises `AccountDisabledError` (HTTP 403) and issues no token.

**Validates: Requirements 5.9**

### Property 15: A successful verification stamps `last_login`

For any successful verification, the resolved user's `last_login` equals the verification-time value supplied by the injected clock.

**Validates: Requirements 5.10**

### Property 16: Failure responses never reveal the code or its hash

For any verification failure (invalid-or-expired, invalid, or too-many-attempts), the response body contains neither the raw submitted/issued code nor the stored `code_hash`, and the three outcomes are reported as distinct statuses (HTTP 400 for invalid or expired, HTTP 429 for too-many-attempts).

**Validates: Requirements 6.4**
