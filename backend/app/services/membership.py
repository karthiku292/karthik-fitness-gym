"""Membership lifecycle: assignment, expiry calc, renewal, pause, extend."""
from datetime import date, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import MemberStatus, MembershipStatus
from app.models.member import Member
from app.models.membership import Membership, MembershipPlan, Renewal


def _plan(db: Session, gym_id: int, plan_id: int) -> MembershipPlan:
    plan = db.scalar(
        select(MembershipPlan).where(
            MembershipPlan.id == plan_id, MembershipPlan.gym_id == gym_id
        )
    )
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership plan not found")
    return plan


def _member(db: Session, gym_id: int, member_id: int) -> Member:
    member = db.scalar(
        select(Member).where(Member.id == member_id, Member.gym_id == gym_id)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


def active_membership(db: Session, gym_id: int, member_id: int) -> Optional[Membership]:
    return db.scalar(
        select(Membership)
        .where(
            Membership.gym_id == gym_id,
            Membership.member_id == member_id,
            Membership.status.in_(
                [MembershipStatus.active, MembershipStatus.paused]
            ),
        )
        .order_by(Membership.end_date.desc())
    )


def sync_member_status(db: Session, member: Member) -> None:
    """Reflect the member's current membership state onto Member.status."""
    m = active_membership(db, member.gym_id, member.id)
    if m is None:
        member.status = MemberStatus.expired
    elif m.status == MembershipStatus.active and m.end_date >= date.today():
        member.status = MemberStatus.active
    elif m.status == MembershipStatus.paused:
        member.status = MemberStatus.active
    else:
        member.status = MemberStatus.expired


def assign_membership(
    db: Session,
    gym_id: int,
    member_id: int,
    plan_id: int,
    start_date: Optional[date] = None,
    auto_renew: bool = False,
) -> Membership:
    member = _member(db, gym_id, member_id)
    plan = _plan(db, gym_id, plan_id)

    # Cancel any existing active/paused membership before assigning a new one.
    existing = active_membership(db, gym_id, member_id)
    if existing is not None:
        existing.status = MembershipStatus.cancelled

    start = start_date or date.today()
    end = start + timedelta(days=plan.duration_days)
    membership = Membership(
        gym_id=gym_id,
        member_id=member_id,
        plan_id=plan_id,
        start_date=start,
        end_date=end,
        status=MembershipStatus.active,
        auto_renew=auto_renew,
    )
    db.add(membership)
    db.flush()
    sync_member_status(db, member)
    return membership


def renew_membership(
    db: Session,
    gym_id: int,
    membership: Membership,
    plan_id: Optional[int] = None,
    start_from: Optional[date] = None,
    renewed_by: Optional[int] = None,
) -> tuple[Membership, Renewal]:
    plan = _plan(db, gym_id, plan_id or membership.plan_id)
    previous_end = membership.end_date
    base = start_from or max(date.today(), previous_end)
    new_end = base + timedelta(days=plan.duration_days)

    membership.plan_id = plan.id
    membership.end_date = new_end
    membership.status = MembershipStatus.active

    renewal = Renewal(
        gym_id=gym_id,
        membership_id=membership.id,
        plan_id=plan.id,
        previous_end=previous_end,
        new_end=new_end,
        amount=plan.price,
        renewed_by=renewed_by,
    )
    db.add(renewal)
    db.flush()

    member = _member(db, gym_id, membership.member_id)
    sync_member_status(db, member)
    return membership, renewal


def pause_membership(
    db: Session, gym_id: int, membership: Membership, pause_date: Optional[date] = None
) -> Membership:
    if membership.status != MembershipStatus.active:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only an active membership can be paused"
        )
    membership.status = MembershipStatus.paused
    membership.paused_at = pause_date or date.today()
    db.flush()
    sync_member_status(db, _member(db, gym_id, membership.member_id))
    return membership


def resume_membership(db: Session, gym_id: int, membership: Membership) -> Membership:
    if membership.status != MembershipStatus.paused or membership.paused_at is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Membership is not paused"
        )
    # Extend the end date by the number of days spent paused.
    paused_days = (date.today() - membership.paused_at).days
    if paused_days > 0:
        membership.end_date = membership.end_date + timedelta(days=paused_days)
        membership.pause_days_used += paused_days
    membership.status = MembershipStatus.active
    membership.paused_at = None
    db.flush()
    sync_member_status(db, _member(db, gym_id, membership.member_id))
    return membership


def extend_membership(
    db: Session, gym_id: int, membership: Membership, days: int
) -> Membership:
    membership.end_date = membership.end_date + timedelta(days=days)
    if membership.end_date >= date.today():
        membership.status = MembershipStatus.active
    db.flush()
    sync_member_status(db, _member(db, gym_id, membership.member_id))
    return membership


def expire_due_memberships(db: Session, gym_id: Optional[int] = None) -> int:
    """Mark active memberships past their end date as expired. Returns count."""
    stmt = select(Membership).where(
        Membership.status == MembershipStatus.active,
        Membership.end_date < date.today(),
    )
    if gym_id is not None:
        stmt = stmt.where(Membership.gym_id == gym_id)
    due = db.scalars(stmt).all()
    for m in due:
        m.status = MembershipStatus.expired
        member = db.get(Member, m.member_id)
        if member:
            sync_member_status(db, member)
    return len(due)
