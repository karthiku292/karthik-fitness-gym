"""Audit logging helper."""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def log_action(
    db: Session,
    *,
    gym_id: int,
    actor_user_id: Optional[int],
    action: str,
    entity: str,
    entity_id: Optional[int] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    ip: Optional[str] = None,
) -> None:
    """Record a sensitive action. Caller is responsible for commit."""
    db.add(
        AuditLog(
            gym_id=gym_id,
            actor_user_id=actor_user_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            before=before,
            after=after,
            ip=ip,
        )
    )
