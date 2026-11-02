"""Membership plan, membership, and renewal schemas."""
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.enums import MembershipStatus, PlanType


# ---------- Plans ----------
class PlanBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: PlanType = PlanType.monthly
    duration_days: int = Field(gt=0)
    price: float = Field(ge=0)
    description: Optional[str] = Field(default=None, max_length=500)
    features: List[str] = Field(default_factory=list)
    is_active: bool = True


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    type: Optional[PlanType] = None
    duration_days: Optional[int] = Field(default=None, gt=0)
    price: Optional[float] = Field(default=None, ge=0)
    description: Optional[str] = Field(default=None, max_length=500)
    features: Optional[List[str]] = None
    is_active: Optional[bool] = None


class PlanOut(PlanBase):
    id: int
    gym_id: int

    model_config = {"from_attributes": True}


# ---------- Memberships ----------
class MembershipCreate(BaseModel):
    member_id: int
    plan_id: int
    start_date: Optional[date] = None
    auto_renew: bool = False


class MembershipOut(BaseModel):
    id: int
    gym_id: int
    member_id: int
    plan_id: int
    start_date: date
    end_date: date
    status: MembershipStatus
    paused_at: Optional[date] = None
    pause_days_used: int
    auto_renew: bool

    model_config = {"from_attributes": True}


class RenewRequest(BaseModel):
    plan_id: Optional[int] = None  # defaults to current plan
    start_from: Optional[date] = None  # defaults to max(today, current end)


class PauseRequest(BaseModel):
    pause_date: Optional[date] = None


class ExtendRequest(BaseModel):
    days: int = Field(gt=0)
    reason: Optional[str] = Field(default=None, max_length=300)


class RenewalOut(BaseModel):
    id: int
    membership_id: int
    plan_id: int
    previous_end: date
    new_end: date
    amount: float
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
