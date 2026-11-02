"""Membership plans, member memberships, and renewal history."""
from datetime import date
from typing import Optional

from sqlalchemy import JSON, Date, Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import MembershipStatus, PlanType


class MembershipPlan(Base, TimestampMixin):
    __tablename__ = "membership_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[PlanType] = mapped_column(Enum(PlanType), default=PlanType.monthly)
    duration_days: Mapped[int] = mapped_column(nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500))
    features: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(default=True)


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    plan_id: Mapped[int] = mapped_column(ForeignKey("membership_plans.id"))
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[MembershipStatus] = mapped_column(
        Enum(MembershipStatus), default=MembershipStatus.active, index=True
    )
    paused_at: Mapped[Optional[date]] = mapped_column(Date)
    pause_days_used: Mapped[int] = mapped_column(default=0)
    auto_renew: Mapped[bool] = mapped_column(default=False)

    member = relationship("Member")
    plan = relationship("MembershipPlan")


class Renewal(Base, TimestampMixin):
    __tablename__ = "renewals"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    membership_id: Mapped[int] = mapped_column(
        ForeignKey("memberships.id", ondelete="CASCADE")
    )
    plan_id: Mapped[int] = mapped_column(ForeignKey("membership_plans.id"))
    previous_end: Mapped[date] = mapped_column(Date)
    new_end: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    renewed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
