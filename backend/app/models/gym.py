"""Gym (tenant root) model."""
from typing import Optional

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Gym(Base, TimestampMixin):
    __tablename__ = "gyms"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    primary_color: Mapped[str] = mapped_column(String(9), default="#080808")
    accent_color: Mapped[str] = mapped_column(String(9), default="#B794F6")
    address: Mapped[Optional[str]] = mapped_column(String(300))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(160))
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    timezone: Mapped[str] = mapped_column(String(60), default="Asia/Kolkata")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(default=True)
