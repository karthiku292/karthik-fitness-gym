"""Create (or promote/reset) an admin user with your own email.

Usage:
  python -m app.db.create_admin --email you@example.com --password "YourPass123!" --name "Your Name"

If a user with that email already exists in the gym, their role is set to
admin, the account is activated, and the password is reset to the one given.
"""
import argparse
import logging

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.enums import UserRole
from app.models.gym import Gym
from app.models.user import User

logger = logging.getLogger("create_admin")


def run(email: str, password: str, name: str, gym_slug: str) -> None:
    if len(password) < 8:
        raise SystemExit("Password must be at least 8 characters.")

    db = SessionLocal()
    try:
        gym = db.query(Gym).filter(Gym.slug == gym_slug).first()
        if gym is None:
            raise SystemExit(
                f"No gym with slug '{gym_slug}'. Run `python -m app.db.seed` first."
            )

        user = (
            db.query(User)
            .filter(User.gym_id == gym.id, User.email == email)
            .first()
        )
        if user is None:
            user = User(
                gym_id=gym.id,
                email=email,
                full_name=name,
                password_hash=hash_password(password),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(user)
            action = "created"
        else:
            user.role = UserRole.admin
            user.is_active = True
            user.full_name = name or user.full_name
            user.password_hash = hash_password(password)
            action = "updated"

        db.commit()
        print(f"Admin {action}: {email} (gym '{gym.name}')")
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Create or promote an admin user.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="Administrator")
    parser.add_argument("--gym-slug", default="my-gym")
    args = parser.parse_args()
    run(args.email, args.password, args.name, args.gym_slug)
