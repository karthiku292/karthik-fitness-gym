"""Member business logic: unique code generation, CRUD, search."""
from datetime import date
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.enums import MemberStatus
from app.models.member import Member
from app.schemas.member import MemberCreate, MemberUpdate


def generate_member_code(db: Session, gym_id: int) -> str:
    """Produce a unique per-gym member code like GM-000042."""
    count = db.scalar(
        select(func.count()).select_from(Member).where(Member.gym_id == gym_id)
    ) or 0
    seq = count + 1
    # Ensure uniqueness in case of gaps/races.
    while True:
        code = f"GM-{seq:06d}"
        exists = db.scalar(
            select(Member.id).where(
                Member.gym_id == gym_id, Member.member_code == code
            )
        )
        if not exists:
            return code
        seq += 1


def create_member(db: Session, gym_id: int, data: MemberCreate) -> Member:
    member = Member(
        gym_id=gym_id,
        member_code=generate_member_code(db, gym_id),
        name=data.name,
        phone=data.phone,
        email=str(data.email) if data.email else None,
        age=data.age,
        gender=data.gender,
        dob=data.dob,
        joining_date=data.joining_date or date.today(),
        photo_url=data.photo_url,
        address=data.address,
        emergency_contact=data.emergency_contact,
        assigned_trainer_id=data.assigned_trainer_id,
        status=MemberStatus.active,
    )
    db.add(member)
    db.flush()
    return member


def update_member(db: Session, member: Member, data: MemberUpdate) -> Member:
    payload = data.model_dump(exclude_unset=True)
    if "email" in payload and payload["email"] is not None:
        payload["email"] = str(payload["email"])
    for field, value in payload.items():
        setattr(member, field, value)
    db.flush()
    return member


def get_member(db: Session, gym_id: int, member_id: int) -> Optional[Member]:
    return db.scalar(
        select(Member).where(Member.id == member_id, Member.gym_id == gym_id)
    )


def list_members(
    db: Session,
    gym_id: int,
    *,
    search: Optional[str] = None,
    status: Optional[MemberStatus] = None,
    trainer_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Member], int]:
    stmt = select(Member).where(Member.gym_id == gym_id)
    if status is not None:
        stmt = stmt.where(Member.status == status)
    if trainer_id is not None:
        stmt = stmt.where(Member.assigned_trainer_id == trainer_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Member.name.ilike(like),
                Member.member_code.ilike(like),
                Member.phone.ilike(like),
                Member.email.ilike(like),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Member.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .all()
    )
    return list(rows), total
