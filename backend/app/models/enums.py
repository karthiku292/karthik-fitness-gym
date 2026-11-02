"""Shared enumerations used across models and schemas."""
import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    trainer = "trainer"
    member = "member"


class MemberStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    expired = "expired"


class PlanType(str, enum.Enum):
    monthly = "monthly"
    quarterly = "quarterly"
    half_yearly = "half_yearly"
    yearly = "yearly"
    custom = "custom"


class MembershipStatus(str, enum.Enum):
    active = "active"
    expired = "expired"
    paused = "paused"
    cancelled = "cancelled"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    upi = "upi"
    card = "card"
    razorpay = "razorpay"


class PaymentStatus(str, enum.Enum):
    paid = "paid"
    pending = "pending"
    refunded = "refunded"


class AttendanceMethod(str, enum.Enum):
    qr = "qr"
    manual = "manual"


class NotificationChannel(str, enum.Enum):
    whatsapp = "whatsapp"
    email = "email"


class NotificationStatus(str, enum.Enum):
    queued = "queued"
    sent = "sent"
    failed = "failed"
