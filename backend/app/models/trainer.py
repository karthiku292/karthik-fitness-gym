"""Trainer profile."""
from typing import Optional

from sqlalchemy import JSON, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Trainer(Base, TimestampMixin):
    __tablename__ = "trainers"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(160))
    specialization: Mapped[Optional[str]] = mapped_column(String(160))
    bio: Mapped[Optional[str]] = mapped_column(String(1000))
    photo_url: Mapped[Optional[str]] = mapped_column(String(500))
    availability: Mapped[dict] = mapped_column(JSON, default=dict)
    hourly_rate: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))
    is_active: Mapped[bool] = mapped_column(default=True)

    user = relationship("User")
