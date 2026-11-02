"""Payment records. Never stores card numbers, CVV, or raw credentials."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import PaymentMethod, PaymentStatus


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("gym_id", "txn_code", name="uq_payment_gym_txn"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    gym_id: Mapped[int] = mapped_column(
        ForeignKey("gyms.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    membership_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("memberships.id", ondelete="SET NULL")
    )
    txn_code: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod))
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus), default=PaymentStatus.paid, index=True
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    razorpay_ref: Mapped[Optional[str]] = mapped_column(String(80))
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500))
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    refunded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    member = relationship("Member")
