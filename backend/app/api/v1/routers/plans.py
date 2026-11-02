"""Membership plan endpoints (admin manages, staff can read)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.membership import MembershipPlan
from app.schemas.membership import PlanCreate, PlanOut, PlanUpdate

router = APIRouter(prefix="/plans", tags=["membership-plans"])


@router.get("", response_model=list[PlanOut])
def list_plans(
    db: DbSession,
    current_user: CurrentUser,
    active_only: bool = Query(default=False),
):
    stmt = select(MembershipPlan).where(MembershipPlan.gym_id == current_user.gym_id)
    if active_only:
        stmt = stmt.where(MembershipPlan.is_active.is_(True))
    return list(db.scalars(stmt.order_by(MembershipPlan.price)).all())


@router.post(
    "",
    response_model=PlanOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_plan(db: DbSession, current_user: CurrentUser, body: PlanCreate):
    plan = MembershipPlan(gym_id=current_user.gym_id, **body.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.put("/{plan_id}", response_model=PlanOut, dependencies=[Depends(require_admin)])
def update_plan(db: DbSession, current_user: CurrentUser, plan_id: int, body: PlanUpdate):
    plan = db.scalar(
        select(MembershipPlan).where(
            MembershipPlan.id == plan_id, MembershipPlan.gym_id == current_user.gym_id
        )
    )
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    db.commit()
    db.refresh(plan)
    return plan


@router.delete(
    "/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def deactivate_plan(db: DbSession, current_user: CurrentUser, plan_id: int):
    """Soft-delete: plans are deactivated, never hard-deleted (referential safety)."""
    plan = db.scalar(
        select(MembershipPlan).where(
            MembershipPlan.id == plan_id, MembershipPlan.gym_id == current_user.gym_id
        )
    )
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    plan.is_active = False
    db.commit()
