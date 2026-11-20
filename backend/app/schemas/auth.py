"""Auth-related Pydantic schemas."""
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import UserRole


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    gym_id: int
    email: EmailStr
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: UserRole
    is_active: bool

    model_config = {"from_attributes": True}


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


# --- Member OTP login (passwordless) ---


class OtpRequestIn(BaseModel):
    phone: str = Field(min_length=3, max_length=32)


class OtpRequestOut(BaseModel):
    sent: bool
    dev_code: Optional[str] = None  # only in dev + unconfigured provider
    retry_after: Optional[int] = None  # populated in the 429 rate-limit body


class OtpVerifyIn(BaseModel):
    phone: str = Field(min_length=3, max_length=32)
    code: str = Field(min_length=4, max_length=10)
