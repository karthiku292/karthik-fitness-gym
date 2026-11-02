"""Member self-service portal endpoints. All data is scoped to the
currently logged-in member — never another member's records."""
from datetime import date

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.models.attendance import Attendance
from app.models.member import Member
from app.models.membership import Membership, MembershipPlan
from app.models.payment import Payment
from app.models.enums import MembershipStatus
from app.schemas.member import MemberOut
from app.schemas.payment import PaymentOut
from app.schemas.portal import PortalAttendance, PortalMembership

router = APIRouter(prefix="/me", tags=["portal"])


def _member(db, user) -> Member:
    m = db.scalar(
        select(Member).where(Member.gym_id == user.gym_id, Member.user_id == user.id)
    )
    if m is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No member profile is linked to this account. Please contact the gym.",
        )
    return m


@router.get("/profile", response_model=MemberOut)
def my_profile(db: DbSession, current_user: CurrentUser):
    return _member(db, current_user)


@router.get("/membership", response_model=PortalMembership | None)
def my_membership(db: DbSession, current_user: CurrentUser):
    member = _member(db, current_user)
    m = db.scalar(
        select(Membership)
        .where(
            Membership.member_id == member.id,
            Membership.status.in_([MembershipStatus.active, MembershipStatus.paused]),
        )
        .order_by(Membership.end_date.desc())
    )
    if m is None:
        return None
    plan = db.get(MembershipPlan, m.plan_id)
    return PortalMembership(
        id=m.id,
        plan_id=m.plan_id,
        plan_name=plan.name if plan else "Plan",
        start_date=m.start_date,
        end_date=m.end_date,
        status=m.status.value,
        days_left=(m.end_date - date.today()).days,
    )


@router.get("/payments", response_model=list[PaymentOut])
def my_payments(db: DbSession, current_user: CurrentUser):
    member = _member(db, current_user)
    return list(
        db.scalars(
            select(Payment)
            .where(Payment.member_id == member.id)
            .order_by(Payment.created_at.desc())
        ).all()
    )


@router.get("/attendance", response_model=list[PortalAttendance])
def my_attendance(db: DbSession, current_user: CurrentUser):
    member = _member(db, current_user)
    return list(
        db.scalars(
            select(Attendance)
            .where(Attendance.member_id == member.id)
            .order_by(Attendance.check_in_at.desc())
            .limit(60)
        ).all()
    )
