"""Gym branch / location (one gym can have many branches)."""
from typing import Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String(300))
    city: Mapped[Optional[str]] = mapped_column(String(80))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    hours: Mapped[Optional[str]] = mapped_column(String(160))
    photo_url: Mapped[Optional[str]] = mapped_column(String(500))
    map_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(default=True)

    gym = relationship("Gym")
