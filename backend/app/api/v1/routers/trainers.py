"""Trainer management (admin) + public trainer listing for the website."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.gym import Gym
from app.models.trainer import Trainer
from app.schemas.trainer import TrainerCreate, TrainerOut, TrainerPublic, TrainerUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/trainers", tags=["trainers"])


@router.get("/public", response_model=list[TrainerPublic])
def public_trainers(db: DbSession):
    """Active trainers for the public website (no auth), primary gym."""
    gym = db.query(Gym).filter(Gym.is_active.is_(True)).order_by(Gym.id).first()
    if gym is None:
        return []
    return list(
        db.scalars(
            select(Trainer)
            .where(Trainer.gym_id == gym.id, Trainer.is_active.is_(True))
            .order_by(Trainer.id)
        ).all()
    )


@router.get("", response_model=list[TrainerOut], dependencies=[Depends(require_admin)])
def list_trainers(db: DbSession, current_user: CurrentUser):
    return list(
        db.scalars(
            select(Trainer).where(Trainer.gym_id == current_user.gym_id).order_by(Trainer.id)
        ).all()
    )


@router.post(
    "",
    response_model=TrainerOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_trainer(db: DbSession, current_user: CurrentUser, body: TrainerCreate):
    trainer = Trainer(gym_id=current_user.gym_id, is_active=True, **body.model_dump())
    db.add(trainer)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="trainer.create",
        entity="trainer",
    )
    db.commit()
    db.refresh(trainer)
    return trainer


def _get(db, gym_id: int, trainer_id: int) -> Trainer:
    t = db.scalar(select(Trainer).where(Trainer.id == trainer_id, Trainer.gym_id == gym_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer not found")
    return t


@router.put("/{trainer_id}", response_model=TrainerOut, dependencies=[Depends(require_admin)])
def update_trainer(db: DbSession, current_user: CurrentUser, trainer_id: int, body: TrainerUpdate):
    trainer = _get(db, current_user.gym_id, trainer_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(trainer, field, value)
    db.commit()
    db.refresh(trainer)
    return trainer


@router.post("/{trainer_id}/deactivate", response_model=TrainerOut, dependencies=[Depends(require_admin)])
def deactivate_trainer(db: DbSession, current_user: CurrentUser, trainer_id: int):
    trainer = _get(db, current_user.gym_id, trainer_id)
    trainer.is_active = False
    db.commit()
    db.refresh(trainer)
    return trainer
