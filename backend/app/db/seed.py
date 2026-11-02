"""Bootstrap script: create the first gym (tenant) and an admin user.

Run with:  python -m app.db.seed
Idempotent — safe to run more than once.
"""
import logging
import re

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.enums import UserRole
from app.models.gym import Gym
from app.models.user import User

logger = logging.getLogger("seed")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    return s.strip("-") or "gym"


def run() -> None:
    db = SessionLocal()
    try:
        gym = db.query(Gym).filter(Gym.slug == _slug(settings.BOOTSTRAP_GYM_NAME)).first()
        if gym is None:
            gym = Gym(
                name=settings.BOOTSTRAP_GYM_NAME,
                slug=_slug(settings.BOOTSTRAP_GYM_NAME),
            )
            db.add(gym)
            db.flush()
            logger.info("Created gym '%s' (id=%s)", gym.name, gym.id)

        admin = (
            db.query(User)
            .filter(User.gym_id == gym.id, User.email == settings.BOOTSTRAP_ADMIN_EMAIL)
            .first()
        )
        if admin is None:
            admin = User(
                gym_id=gym.id,
                email=settings.BOOTSTRAP_ADMIN_EMAIL,
                full_name="Administrator",
                password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(admin)
            logger.info("Created admin user %s", admin.email)

        db.commit()
        logger.info("Bootstrap complete. Gym slug: %s", gym.slug)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
