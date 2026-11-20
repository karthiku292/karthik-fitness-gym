"""One-time passcode records for passwordless member login."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class OtpCode(Base, TimestampMixin):
    __tablename__ = "otp_codes"
    __table_args__ = (
        Index("ix_otp_codes_gym_phone", "gym_id", "phone"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    phone: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    gym = relationship("Gym")
