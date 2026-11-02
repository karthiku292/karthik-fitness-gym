"""Payment schemas. Never accepts card numbers, CVV, or raw credentials."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.enums import PaymentMethod, PaymentStatus


class PaymentCreate(BaseModel):
    member_id: int
    amount: float = Field(gt=0)
    method: PaymentMethod
    membership_id: Optional[int] = None
    status: PaymentStatus = PaymentStatus.paid
    notes: Optional[str] = Field(default=None, max_length=500)
    razorpay_ref: Optional[str] = Field(default=None, max_length=80)


class PaymentOut(BaseModel):
    id: int
    gym_id: int
    member_id: int
    membership_id: Optional[int] = None
    txn_code: str
    amount: float
    method: PaymentMethod
    status: PaymentStatus
    paid_at: Optional[datetime] = None
    razorpay_ref: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaymentWithMember(PaymentOut):
    member_name: Optional[str] = None
    member_code: Optional[str] = None


class RefundRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class RevenuePoint(BaseModel):
    period: str
    total: float
    count: int


class RevenueSummary(BaseModel):
    today: float
    this_month: float
    this_year: float
    pending: float
    by_month: list[RevenuePoint]
    by_method: dict[str, float]


class CollectRange(BaseModel):
    start: Optional[date] = None
    end: Optional[date] = None
