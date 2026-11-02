"""Gym branding and configuration endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.gym import Gym
from app.models.membership import MembershipPlan
from app.schemas.gym import GymOut, GymPublic, GymUpdate
from app.schemas.membership import PlanOut

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/public/{slug}", response_model=GymPublic)
def public_branding(db: DbSession, slug: str):
    """Branding for the login screen, resolved by gym slug (no auth)."""
    gym = db.query(Gym).filter(Gym.slug == slug, Gym.is_active.is_(True)).first()
    if gym is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gym not found")
    return gym


@router.get("/public/{slug}/plans", response_model=list[PlanOut])
def public_plans(db: DbSession, slug: str):
    """Active membership plans for the public pricing page (no auth, read-only)."""
    gym = db.query(Gym).filter(Gym.slug == slug, Gym.is_active.is_(True)).first()
    if gym is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gym not found")
    return (
        db.query(MembershipPlan)
        .filter(MembershipPlan.gym_id == gym.id, MembershipPlan.is_active.is_(True))
        .order_by(MembershipPlan.price)
        .all()
    )


def _default_gym(db) -> Gym:
    """The primary (single-tenant) gym, resolved without needing a slug."""
    gym = db.query(Gym).filter(Gym.is_active.is_(True)).order_by(Gym.id).first()
    if gym is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gym not found")
    return gym


@router.get("/branding", response_model=GymPublic)
def default_branding(db: DbSession):
    """Public branding for the primary gym (no slug needed)."""
    return _default_gym(db)


@router.get("/plans", response_model=list[PlanOut])
def default_plans(db: DbSession):
    """Active plans for the primary gym (no slug needed)."""
    gym = _default_gym(db)
    return (
        db.query(MembershipPlan)
        .filter(MembershipPlan.gym_id == gym.id, MembershipPlan.is_active.is_(True))
        .order_by(MembershipPlan.price)
        .all()
    )


@router.get("", response_model=GymOut)
def get_settings(db: DbSession, current_user: CurrentUser):
    gym = db.get(Gym, current_user.gym_id)
    if gym is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gym not found")
    return gym


@router.put("", response_model=GymOut, dependencies=[Depends(require_admin)])
def update_settings(db: DbSession, current_user: CurrentUser, body: GymUpdate):
    gym = db.get(Gym, current_user.gym_id)
    if gym is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gym not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(gym, field, value)
    db.commit()
    db.refresh(gym)
    return gym
