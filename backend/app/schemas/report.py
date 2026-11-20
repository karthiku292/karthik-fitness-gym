"""Dashboard analytics report schemas (read-only response models)."""
from pydantic import BaseModel


class DashboardSummary(BaseModel):
    total_members: int
    active_members: int
    expired: int
    monthly_revenue: float
    pending_payments: int
    # Note: attendance_today is intentionally absent (Req 1.6); the Dashboard
    # keeps sourcing that card from /attendance/today.


class MonthlyRevenuePoint(BaseModel):
    month: str      # "YYYY-MM"
    revenue: float


class MonthlySignupPoint(BaseModel):
    month: str      # "YYYY-MM"
    signups: int


class DailyAttendancePoint(BaseModel):
    date: str       # "YYYY-MM-DD"
    count: int


class PlanRevenuePoint(BaseModel):
    plan: str       # plan name, or "Unassigned"
    revenue: float
