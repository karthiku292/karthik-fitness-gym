"""Import all models so Alembic and Base.metadata see them."""
from app.models.gym import Gym
from app.models.user import User
from app.models.member import Member
from app.models.trainer import Trainer
from app.models.membership import MembershipPlan, Membership, Renewal
from app.models.payment import Payment
from app.models.attendance import Attendance, QRToken
from app.models.fitness import (
    WorkoutPlan,
    WorkoutAssignment,
    DietPlan,
    DietAssignment,
    MemberProgress,
)
from app.models.notification import Notification, NotificationTemplate
from app.models.audit import AuditLog

__all__ = [
    "Gym",
    "User",
    "Member",
    "Trainer",
    "MembershipPlan",
    "Membership",
    "Renewal",
    "Payment",
    "Attendance",
    "QRToken",
    "WorkoutPlan",
    "WorkoutAssignment",
    "DietPlan",
    "DietAssignment",
    "MemberProgress",
    "Notification",
    "NotificationTemplate",
    "AuditLog",
]
