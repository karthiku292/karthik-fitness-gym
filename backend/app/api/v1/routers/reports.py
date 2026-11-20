"""Reports endpoints: admin-only, read-only dashboard KPIs and chart series.

All five routes are gym-scoped (``current_user.gym_id``), gated by ``require_admin``,
and delegate to ``app.services.report``. They perform no commit or audit — reads only.
"""
from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, DbSession, require_admin
from app.schemas.report import (
    DailyAttendancePoint,
    DashboardSummary,
    MonthlyRevenuePoint,
    MonthlySignupPoint,
    PlanRevenuePoint,
)
from app.services import report as svc

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary", response_model=DashboardSummary, dependencies=[Depends(require_admin)])
def summary(db: DbSession, current_user: CurrentUser):
    return svc.dashboard_summary(db, current_user.gym_id)


@router.get(
    "/revenue-trend",
    response_model=list[MonthlyRevenuePoint],
    dependencies=[Depends(require_admin)],
)
def revenue_trend(db: DbSession, current_user: CurrentUser):
    return svc.revenue_trend(db, current_user.gym_id)


@router.get(
    "/signup-trend",
    response_model=list[MonthlySignupPoint],
    dependencies=[Depends(require_admin)],
)
def signup_trend(db: DbSession, current_user: CurrentUser):
    return svc.signup_trend(db, current_user.gym_id)


@router.get(
    "/attendance-trend",
    response_model=list[DailyAttendancePoint],
    dependencies=[Depends(require_admin)],
)
def attendance_trend(db: DbSession, current_user: CurrentUser):
    return svc.attendance_trend(db, current_user.gym_id)


@router.get(
    "/revenue-by-plan",
    response_model=list[PlanRevenuePoint],
    dependencies=[Depends(require_admin)],
)
def revenue_by_plan(db: DbSession, current_user: CurrentUser):
    return svc.revenue_by_plan(db, current_user.gym_id)
