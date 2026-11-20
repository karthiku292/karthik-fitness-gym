"""Authentication endpoints: login, refresh, me, change password."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm

from app.core.deps import CurrentUser, DbSession
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    RefreshRequest,
    Token,
    UserOut,
)
from app.services import otp as otp_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(user: User) -> Token:
    extra = {"role": user.role.value, "gym_id": user.gym_id}
    return Token(
        access_token=create_access_token(str(user.id), extra),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/login", response_model=Token)
def login(db: DbSession, form: OAuth2PasswordRequestForm = Depends()):
    # OAuth2 form uses 'username' field. Members sign in with their phone
    # number; admins/staff with their email. Accept either identifier.
    ident = (form.username or "").strip()
    user = (
        db.query(User)
        .filter((User.email == ident) | (User.phone == ident))
        .first()
    )
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect phone number / email or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    return _issue_tokens(user)


@router.post("/refresh", response_model=Token)
def refresh(db: DbSession, body: RefreshRequest):
    payload = decode_token(body.refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    return _issue_tokens(user)


@router.get("/me", response_model=UserOut)
def me(current_user: CurrentUser):
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(db: DbSession, current_user: CurrentUser, body: ChangePasswordRequest):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    current_user.password_hash = hash_password(body.new_password)
    db.commit()


# --- Member OTP login (passwordless), additive ---
#
# Two new routes under the existing ``/auth`` prefix mount at
# ``/api/v1/auth/otp/request`` and ``/api/v1/auth/otp/verify`` (Req 1.1). The four
# handlers above and ``_issue_tokens`` are left untouched (Req 1.2). The OTP service
# holds all business logic and raises framework-agnostic typed errors; these handlers
# own the HTTP concerns — committing on success and mapping each typed error to the
# status in the design's two status matrices.
#
# The clock and the deliverer are provided through dependencies so tests can override
# them via ``app.dependency_overrides`` and exercise request/verify/rate-limit/expiry/
# attempt behavior offline and without real time.


def get_clock() -> otp_service.Clock:
    """Injectable clock dependency; returns the service's default UTC-now callable.

    Overridden in tests with a fixed callable so expiry and rate-limit windows are
    deterministic. The return value is a zero-arg callable the service invokes itself.
    """
    return otp_service._utcnow


def get_otp_deliverer() -> otp_service.OtpDeliverer:
    """Injectable OTP delivery seam; returns the module's default WhatsApp deliverer.

    Overridden in tests with a recording deliverer (configurable ``is_configured()``,
    captures the code in memory) so request flows run with no network.
    """
    return otp_service.DEFAULT_DELIVERER


@router.post("/otp/request", response_model=OtpRequestOut)
def otp_request(
    db: DbSession,
    body: OtpRequestIn,
    deliverer: otp_service.OtpDeliverer = Depends(get_otp_deliverer),
    now: otp_service.Clock = Depends(get_clock),
):
    """Issue and deliver a one-time passcode for the submitted phone (Req 1.1, 2).

    On success commits the single ``OtpCode`` row and returns ``{sent: true, dev_code?}``
    with HTTP 200 (Req 2.10); ``dev_code`` is present only when the service deems it
    safe (unconfigured provider + non-production). Typed errors map to HTTP per the
    design's request status matrix: an out-of-range phone -> 422 (Req 2.2); a per-phone
    limit -> 429 with ``{detail, retry_after}`` and a ``Retry-After`` header (Req 3); an
    unresolved Target_Gym -> 500 with no row written (Req 1.6).
    """
    try:
        result = otp_service.request_otp(db, body.phone, deliverer=deliverer, now=now)
    except otp_service.InvalidPhoneError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    except otp_service.RateLimitedError as e:
        # 429 carries the limit message plus the wait, both in the body and as the
        # standard Retry-After header so the frontend can render a countdown (Req 3.3).
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": str(e), "retry_after": e.retry_after},
            headers={"Retry-After": str(e.retry_after)},
        )
    except otp_service.GymUnavailableError:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Gym is not available"
        )
    db.commit()
    return OtpRequestOut(sent=True, dev_code=result.dev_code)


@router.post("/otp/verify", response_model=Token)
def otp_verify(
    db: DbSession,
    body: OtpVerifyIn,
    now: otp_service.Clock = Depends(get_clock),
):
    """Verify a submitted code and, on success, authenticate the member (Req 1.5, 4, 5).

    On a correct code for an active account, commits the consumed flag, provisioning
    writes, and ``last_login``, then returns the existing ``Token`` via
    ``_issue_tokens`` with HTTP 200 (Req 4.7, 1.5). Typed errors map to HTTP per the
    design's verify status matrix: no active code or a mismatch -> 400 (Req 4.3, 4.5);
    a code at the attempt cap -> 429 (Req 4.4); a disabled account -> 403 (Req 5.9); an
    unresolved Target_Gym -> 500 (Req 1.6). The wrong-code attempt increment is
    committed inside the service, so these ``detail`` strings never leak the code.
    """
    try:
        user = otp_service.verify_otp(db, body.phone, body.code, now=now)
    except otp_service.InvalidCodeError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except otp_service.TooManyAttemptsError as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(e))
    except otp_service.AccountDisabledError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")
    except otp_service.GymUnavailableError:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Gym is not available"
        )
    db.commit()
    return _issue_tokens(user)
