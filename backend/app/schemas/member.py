"""Member schemas."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import MemberStatus


class MemberBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[EmailStr] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    gender: Optional[str] = Field(default=None, max_length=20)
    dob: Optional[date] = None
    photo_url: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=300)
    emergency_contact: Optional[str] = Field(default=None, max_length=60)
    assigned_trainer_id: Optional[int] = None


class MemberCreate(MemberBase):
    joining_date: Optional[date] = None


class MemberUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[EmailStr] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    gender: Optional[str] = Field(default=None, max_length=20)
    dob: Optional[date] = None
    photo_url: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=300)
    emergency_contact: Optional[str] = Field(default=None, max_length=60)
    assigned_trainer_id: Optional[int] = None
    status: Optional[MemberStatus] = None


class MemberOut(MemberBase):
    id: int
    gym_id: int
    member_code: str
    joining_date: date
    status: MemberStatus
    user_id: Optional[int] = None

    model_config = {"from_attributes": True}


class MemberCredentialsIn(BaseModel):
    """Admin sets or resets a member's portal login (by phone number)."""
    phone: str = Field(min_length=4, max_length=30)
    password: str = Field(min_length=8)
