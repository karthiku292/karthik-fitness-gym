"""Workout plans, diet plans, assignments, and progress tracking."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class WorkoutPlan(Base, TimestampMixin):
    __tablename__ = "workout_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    trainer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("trainers.id"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500))
    # schedule: {"monday": [{"exercise","sets","reps","instructions"}], ...}
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)


class WorkoutAssignment(Base, TimestampMixin):
    __tablename__ = "workout_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    plan_id: Mapped[int] = mapped_column(ForeignKey("workout_plans.id"))
    assigned_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")
    progress: Mapped[dict] = mapped_column(JSON, default=dict)

    plan = relationship("WorkoutPlan")


class DietPlan(Base, TimestampMixin):
    __tablename__ = "diet_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    trainer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("trainers.id"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500))
    # meals: [{"meal","time","items","calories","protein","carbs","fats"}]
    meals: Mapped[list] = mapped_column(JSON, default=list)


class DietAssignment(Base, TimestampMixin):
    __tablename__ = "diet_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    plan_id: Mapped[int] = mapped_column(ForeignKey("diet_plans.id"))
    assigned_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")

    plan = relationship("DietPlan")


class MemberProgress(Base, TimestampMixin):
    __tablename__ = "member_progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    recorded_at: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    weight: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    body_fat: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    measurements: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    recorded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
