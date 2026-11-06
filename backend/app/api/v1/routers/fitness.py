"""Workout & diet plans: staff create/assign, members view in their portal."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.fitness import DietAssignment, DietPlan, WorkoutAssignment, WorkoutPlan
from app.models.member import Member
from app.schemas.fitness import AssignIn, PlanIn, PlanOut

router = APIRouter(tags=["fitness"])


# ---------------- Workout plans ----------------
def _wout(p: WorkoutPlan) -> PlanOut:
    return PlanOut(
        id=p.id, gym_id=p.gym_id, name=p.name, description=p.description,
        details=(p.schedule or {}).get("text") if isinstance(p.schedule, dict) else None,
    )


@router.get("/workout-plans", response_model=list[PlanOut], dependencies=[Depends(require_admin)])
def list_workout_plans(db: DbSession, current_user: CurrentUser):
    rows = db.scalars(select(WorkoutPlan).where(WorkoutPlan.gym_id == current_user.gym_id).order_by(WorkoutPlan.id.desc())).all()
    return [_wout(p) for p in rows]


@router.post("/workout-plans", response_model=PlanOut, status_code=201, dependencies=[Depends(require_admin)])
def create_workout_plan(db: DbSession, current_user: CurrentUser, body: PlanIn):
    p = WorkoutPlan(gym_id=current_user.gym_id, name=body.name, description=body.description, schedule={"text": body.details or ""})
    db.add(p)
    db.commit()
    db.refresh(p)
    return _wout(p)


def _get_wplan(db, gym_id, pid) -> WorkoutPlan:
    p = db.scalar(select(WorkoutPlan).where(WorkoutPlan.id == pid, WorkoutPlan.gym_id == gym_id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout plan not found")
    return p


@router.put("/workout-plans/{pid}", response_model=PlanOut, dependencies=[Depends(require_admin)])
def update_workout_plan(db: DbSession, current_user: CurrentUser, pid: int, body: PlanIn):
    p = _get_wplan(db, current_user.gym_id, pid)
    p.name = body.name
    p.description = body.description
    p.schedule = {"text": body.details or ""}
    db.commit()
    db.refresh(p)
    return _wout(p)


@router.delete("/workout-plans/{pid}", status_code=204, dependencies=[Depends(require_admin)])
def delete_workout_plan(db: DbSession, current_user: CurrentUser, pid: int):
    p = _get_wplan(db, current_user.gym_id, pid)
    db.query(WorkoutAssignment).filter(WorkoutAssignment.plan_id == pid).delete(synchronize_session=False)
    db.delete(p)
    db.commit()


@router.post("/workout-plans/{pid}/assign", status_code=200, dependencies=[Depends(require_admin)])
def assign_workout(db: DbSession, current_user: CurrentUser, pid: int, body: AssignIn):
    _get_wplan(db, current_user.gym_id, pid)
    member = db.scalar(select(Member).where(Member.id == body.member_id, Member.gym_id == current_user.gym_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    # Deactivate previous active workout assignments for this member.
    for a in db.scalars(select(WorkoutAssignment).where(WorkoutAssignment.member_id == member.id, WorkoutAssignment.status == "active")).all():
        a.status = "replaced"
    db.add(WorkoutAssignment(gym_id=current_user.gym_id, member_id=member.id, plan_id=pid, assigned_by=current_user.id, status="active"))
    db.commit()
    return {"ok": True}


# ---------------- Diet plans ----------------
def _dout(p: DietPlan) -> PlanOut:
    text = None
    if isinstance(p.meals, dict):
        text = p.meals.get("text")
    return PlanOut(id=p.id, gym_id=p.gym_id, name=p.name, description=p.description, details=text)


@router.get("/diet-plans", response_model=list[PlanOut], dependencies=[Depends(require_admin)])
def list_diet_plans(db: DbSession, current_user: CurrentUser):
    rows = db.scalars(select(DietPlan).where(DietPlan.gym_id == current_user.gym_id).order_by(DietPlan.id.desc())).all()
    return [_dout(p) for p in rows]


@router.post("/diet-plans", response_model=PlanOut, status_code=201, dependencies=[Depends(require_admin)])
def create_diet_plan(db: DbSession, current_user: CurrentUser, body: PlanIn):
    p = DietPlan(gym_id=current_user.gym_id, name=body.name, description=body.description, meals={"text": body.details or ""})
    db.add(p)
    db.commit()
    db.refresh(p)
    return _dout(p)


def _get_dplan(db, gym_id, pid) -> DietPlan:
    p = db.scalar(select(DietPlan).where(DietPlan.id == pid, DietPlan.gym_id == gym_id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diet plan not found")
    return p


@router.put("/diet-plans/{pid}", response_model=PlanOut, dependencies=[Depends(require_admin)])
def update_diet_plan(db: DbSession, current_user: CurrentUser, pid: int, body: PlanIn):
    p = _get_dplan(db, current_user.gym_id, pid)
    p.name = body.name
    p.description = body.description
    p.meals = {"text": body.details or ""}
    db.commit()
    db.refresh(p)
    return _dout(p)


@router.delete("/diet-plans/{pid}", status_code=204, dependencies=[Depends(require_admin)])
def delete_diet_plan(db: DbSession, current_user: CurrentUser, pid: int):
    p = _get_dplan(db, current_user.gym_id, pid)
    db.query(DietAssignment).filter(DietAssignment.plan_id == pid).delete(synchronize_session=False)
    db.delete(p)
    db.commit()


@router.post("/diet-plans/{pid}/assign", status_code=200, dependencies=[Depends(require_admin)])
def assign_diet(db: DbSession, current_user: CurrentUser, pid: int, body: AssignIn):
    _get_dplan(db, current_user.gym_id, pid)
    member = db.scalar(select(Member).where(Member.id == body.member_id, Member.gym_id == current_user.gym_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    for a in db.scalars(select(DietAssignment).where(DietAssignment.member_id == member.id, DietAssignment.status == "active")).all():
        a.status = "replaced"
    db.add(DietAssignment(gym_id=current_user.gym_id, member_id=member.id, plan_id=pid, assigned_by=current_user.id, status="active"))
    db.commit()
    return {"ok": True}
