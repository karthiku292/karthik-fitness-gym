"""Branch / location management (admin) + public listing for the website."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.branch import Branch
from app.models.gym import Gym
from app.schemas.gym import BranchCreate, BranchOut, BranchPublic, BranchUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("/public", response_model=list[BranchPublic])
def public_branches(db: DbSession):
    """Active branches for the public website (no auth), primary gym."""
    gym = db.query(Gym).filter(Gym.is_active.is_(True)).order_by(Gym.id).first()
    if gym is None:
        return []
    return list(
        db.scalars(
            select(Branch)
            .where(Branch.gym_id == gym.id, Branch.is_active.is_(True))
            .order_by(Branch.id)
        ).all()
    )


@router.get("", response_model=list[BranchOut], dependencies=[Depends(require_admin)])
def list_branches(db: DbSession, current_user: CurrentUser):
    return list(
        db.scalars(
            select(Branch).where(Branch.gym_id == current_user.gym_id).order_by(Branch.id)
        ).all()
    )


@router.post(
    "",
    response_model=BranchOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_branch(db: DbSession, current_user: CurrentUser, body: BranchCreate):
    branch = Branch(gym_id=current_user.gym_id, is_active=True, **body.model_dump())
    db.add(branch)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="branch.create",
        entity="branch",
    )
    db.commit()
    db.refresh(branch)
    return branch


def _get(db, gym_id: int, branch_id: int) -> Branch:
    b = db.scalar(select(Branch).where(Branch.id == branch_id, Branch.gym_id == gym_id))
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    return b


@router.put("/{branch_id}", response_model=BranchOut, dependencies=[Depends(require_admin)])
def update_branch(db: DbSession, current_user: CurrentUser, branch_id: int, body: BranchUpdate):
    branch = _get(db, current_user.gym_id, branch_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(branch, field, value)
    db.commit()
    db.refresh(branch)
    return branch


@router.delete(
    "/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def delete_branch(db: DbSession, current_user: CurrentUser, branch_id: int):
    branch = _get(db, current_user.gym_id, branch_id)
    db.delete(branch)
    db.commit()
