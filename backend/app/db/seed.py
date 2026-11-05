"""Bootstrap script: create the first gym (tenant) and an admin user.

Run with:  python -m app.db.seed
Idempotent — safe to run more than once.
"""
import logging
import re

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.branch import Branch
from app.models.enums import PlanType, UserRole
from app.models.gym import Gym
from app.models.membership import MembershipPlan
from app.models.user import User

logger = logging.getLogger("seed")

_ELITE_PERKS = [
    "Unlimited gym & equipment access",
    "All group classes (HIIT, strength, yoga)",
    "Personal locker & showers",
    "Monthly fitness assessment",
    "Diet & nutrition guidance",
    "Access 7 days a week",
]
_DEFAULT_PLANS = [
    dict(name="ELITE", type=PlanType.monthly, duration_days=30, price=2499,
         description="Full-access membership billed monthly."),
    dict(name="ELITE", type=PlanType.quarterly, duration_days=90, price=5999,
         description="Full-access membership for 3 months."),
    dict(name="ELITE", type=PlanType.half_yearly, duration_days=180, price=9999,
         description="Full-access membership for 6 months."),
    dict(name="ELITE", type=PlanType.yearly, duration_days=365, price=16999,
         description="Full-access membership for a full year — best value."),
]


_DEFAULT_BRANCHES = [
    dict(
        name="Jubilee Hills", city="Hyderabad",
        address="3rd Floor, Fitness Avenue, Jubilee Hills, Hyderabad",
        phone="+91 98765 43210", hours="Mon–Sat 5:00 AM – 10:00 PM",
        photo_url="https://images.unsplash.com/photo-1637666062717-1c6bcfa4a4df?auto=format&fit=crop&w=800&q=80",
        map_url="https://maps.google.com",
    ),
    dict(
        name="Gachibowli", city="Hyderabad",
        address="Plot 12, Tech Park Road, Gachibowli, Hyderabad",
        phone="+91 98765 43211", hours="Mon–Sat 5:00 AM – 10:00 PM",
        photo_url="https://images.unsplash.com/photo-1558611848-73f7eb4001a1?auto=format&fit=crop&w=800&q=80",
        map_url="https://maps.google.com",
    ),
]


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

        # Seed example branches only if this gym has none yet (admin edits these).
        if db.query(Branch).filter(Branch.gym_id == gym.id).count() == 0:
            for br in _DEFAULT_BRANCHES:
                db.add(Branch(gym_id=gym.id, is_active=True, **br))
            logger.info("Created %d example branches", len(_DEFAULT_BRANCHES))

        # Seed default membership plans only if this gym has none yet.
        plan_count = (
            db.query(MembershipPlan).filter(MembershipPlan.gym_id == gym.id).count()
        )
        if plan_count == 0:
            for p in _DEFAULT_PLANS:
                db.add(MembershipPlan(gym_id=gym.id, is_active=True, features=_ELITE_PERKS, **p))
            logger.info("Created %d default membership plans", len(_DEFAULT_PLANS))

        db.commit()
        logger.info("Bootstrap complete. Gym slug: %s", gym.slug)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
