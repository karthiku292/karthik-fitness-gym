"""Membership lifecycle endpoints: assign, renew, pause, resume, extend."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.enums import MembershipStatus
from app.models.membership import Membership, Renewal
from app.schemas.membership import (
    ExtendRequest,
    MembershipCreate,
    MembershipOut,
    PauseRequest,
    RenewalOut,
    RenewRequest,
)
from app.services import membership as svc
from app.services.audit import log_action

router = APIRouter(prefix="/memberships", tags=["memberships"])


def _get_membership(db, gym_id: int, membership_id: int) -> Membership:
    m = db.scalar(
        select(Membership).where(
            Membership.id == membership_id, Membership.gym_id == gym_id
        )
    )
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    return m


@router.get("/member/{member_id}", response_model=list[MembershipOut])
def member_memberships(db: DbSession, current_user: CurrentUser, member_id: int):
    rows = db.scalars(
        select(Membership)
        .where(
            Membership.gym_id == current_user.gym_id,
            Membership.member_id == member_id,
        )
        .order_by(Membership.start_date.desc())
    ).all()
    return list(rows)


@router.post(
    "",
    response_model=MembershipOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def assign(db: DbSession, current_user: CurrentUser, body: MembershipCreate):
    membership = svc.assign_membership(
        db,
        current_user.gym_id,
        body.member_id,
        body.plan_id,
        body.start_date,
        body.auto_renew,
    )
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="membership.assign",
        entity="membership",
        entity_id=membership.id,
        after={"member_id": body.member_id, "plan_id": body.plan_id},
    )
    db.commit()
    db.refresh(membership)
    return membership


@router.post(
    "/{membership_id}/renew",
    response_model=MembershipOut,
    dependencies=[Depends(require_admin)],
)
def renew(db: DbSession, current_user: CurrentUser, membership_id: int, body: RenewRequest):
    membership = _get_membership(db, current_user.gym_id, membership_id)
    membership, renewal = svc.renew_membership(
        db,
        current_user.gym_id,
        membership,
        plan_id=body.plan_id,
        start_from=body.start_from,
        renewed_by=current_user.id,
    )
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="membership.renew",
        entity="membership",
        entity_id=membership.id,
        after={"new_end": str(renewal.new_end), "amount": float(renewal.amount)},
    )
    db.commit()
    db.refresh(membership)
    return membership


@router.get("/{membership_id}/renewals", response_model=list[RenewalOut])
def renewal_history(db: DbSession, current_user: CurrentUser, membership_id: int):
    _get_membership(db, current_user.gym_id, membership_id)
    rows = db.scalars(
        select(Renewal)
        .where(Renewal.membership_id == membership_id)
        .order_by(Renewal.created_at.desc())
    ).all()
    return list(rows)


@router.post(
    "/{membership_id}/pause",
    response_model=MembershipOut,
    dependencies=[Depends(require_admin)],
)
def pause(db: DbSession, current_user: CurrentUser, membership_id: int, body: PauseRequest):
    membership = _get_membership(db, current_user.gym_id, membership_id)
    svc.pause_membership(db, current_user.gym_id, membership, body.pause_date)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="membership.pause",
        entity="membership",
        entity_id=membership.id,
    )
    db.commit()
    db.refresh(membership)
    return membership


@router.post(
    "/{membership_id}/resume",
    response_model=MembershipOut,
    dependencies=[Depends(require_admin)],
)
def resume(db: DbSession, current_user: CurrentUser, membership_id: int):
    membership = _get_membership(db, current_user.gym_id, membership_id)
    svc.resume_membership(db, current_user.gym_id, membership)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="membership.resume",
        entity="membership",
        entity_id=membership.id,
    )
    db.commit()
    db.refresh(membership)
    return membership


@router.post(
    "/{membership_id}/extend",
    response_model=MembershipOut,
    dependencies=[Depends(require_admin)],
)
def extend(db: DbSession, current_user: CurrentUser, membership_id: int, body: ExtendRequest):
    membership = _get_membership(db, current_user.gym_id, membership_id)
    svc.extend_membership(db, current_user.gym_id, membership, body.days)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="membership.extend",
        entity="membership",
        entity_id=membership.id,
        after={"days": body.days, "reason": body.reason},
    )
    db.commit()
    db.refresh(membership)
    return membership


@router.get("/upcoming-renewals", response_model=list[MembershipOut])
def upcoming_renewals(db: DbSession, current_user: CurrentUser, days: int = 7):
    """Active memberships expiring within the next `days` days."""
    from datetime import date, timedelta

    cutoff = date.today() + timedelta(days=days)
    rows = db.scalars(
        select(Membership)
        .where(
            Membership.gym_id == current_user.gym_id,
            Membership.status == MembershipStatus.active,
            Membership.end_date <= cutoff,
            Membership.end_date >= date.today(),
        )
        .order_by(Membership.end_date)
    ).all()
    return list(rows)
