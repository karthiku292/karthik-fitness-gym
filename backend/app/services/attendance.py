"""Attendance business logic: QR token lifecycle, idempotent check-in, history, metrics."""
import secrets
from datetime import date
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.attendance import Attendance, QRToken
from app.models.enums import AttendanceMethod
from app.models.member import Member

TOKEN_BYTES = 48  # secrets.token_urlsafe(48) -> exactly 64 url-safe chars


def _new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def generate_unique_token(db: Session) -> str:
    """Opaque 64-char token, unique across qr_tokens (Req 1.1, 1.7)."""
    while True:
        tok = _new_token()
        if not db.scalar(select(QRToken.id).where(QRToken.token == tok)):
            return tok


def get_or_create_token(db: Session, gym_id: int, member_id: int) -> QRToken:
    """Fetch the member's token; create one if absent (Req 1.1-1.3)."""
    row = db.scalar(
        select(QRToken).where(
            QRToken.gym_id == gym_id, QRToken.member_id == member_id
        )
    )
    if row is None:
        row = QRToken(gym_id=gym_id, member_id=member_id, token=generate_unique_token(db))
        db.add(row)
        db.flush()
    return row  # existing rows returned unchanged (Req 1.2, 1.8)


def regenerate_token(db: Session, gym_id: int, member_id: int) -> QRToken:
    """Rotate the token in place and stamp rotated_at (Req 1.4-1.6)."""
    row = get_or_create_token(db, gym_id, member_id)
    row.token = generate_unique_token(db)      # old value no longer resolves (Req 1.6)
    row.rotated_at = func.now()
    db.flush()
    return row


def resolve_member_by_token(db: Session, gym_id: int, token: str) -> Optional[Member]:
    """Gym-scoped token -> member, or None (Req 2.1, 2.4, 7.1)."""
    qr = db.scalar(
        select(QRToken).where(QRToken.gym_id == gym_id, QRToken.token == token)
    )
    if qr is None:
        return None
    return db.scalar(
        select(Member).where(Member.id == qr.member_id, Member.gym_id == gym_id)
    )


def check_in(
    db: Session, gym_id: int, member: Member, *, method: AttendanceMethod, verified_by: int
) -> tuple[Attendance, bool]:
    """Idempotent one-per-day check-in. Returns (row, created)."""
    today = date.today()

    existing = db.scalar(
        select(Attendance).where(
            Attendance.member_id == member.id,
            Attendance.attendance_date == today,
            Attendance.gym_id == gym_id,
        )
    )
    if existing is not None:
        return existing, False                       # Req 3.2

    row = Attendance(
        gym_id=gym_id, member_id=member.id, attendance_date=today,
        method=method, verified_by=verified_by,
    )
    try:
        with db.begin_nested():                       # SAVEPOINT around the insert
            db.add(row)
            db.flush()                                # uq_attendance_day enforced here
    except IntegrityError:
        # Concurrent insert won the race (Req 3.3): resolve to the surviving row.
        row = db.scalar(
            select(Attendance).where(
                Attendance.member_id == member.id,
                Attendance.attendance_date == today,
                Attendance.gym_id == gym_id,
            )
        )
        return row, False
    return row, True                                  # Req 3.1


def to_row(att: Attendance, member: Member) -> dict:
    return {
        "id": att.id, "member_id": member.id, "member_name": member.name,
        "member_code": member.member_code, "attendance_date": att.attendance_date,
        "check_in_at": att.check_in_at, "method": att.method, "verified_by": att.verified_by,
    }


def list_history(
    db: Session, gym_id: int, *, on_date: Optional[date], page: int, page_size: int
) -> tuple[list[dict], int]:
    """Gym-scoped, check_in_at desc, optional date filter (Req 5.1-5.4)."""
    stmt = (
        select(Attendance, Member)
        .join(Member, Member.id == Attendance.member_id)
        .where(Attendance.gym_id == gym_id)
    )
    if on_date is not None:
        stmt = stmt.where(Attendance.attendance_date == on_date)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Attendance.check_in_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [to_row(a, m) for a, m in rows], total


def count_today(db: Session, gym_id: int) -> int:
    """Today's check-in count for the gym; 0 when none (Req 6.1, 6.2)."""
    return db.scalar(
        select(func.count()).select_from(Attendance).where(
            Attendance.gym_id == gym_id, Attendance.attendance_date == date.today()
        )
    ) or 0


def search_members(db: Session, gym_id: int, q: Optional[str], limit: int = 20) -> list[Member]:
    """Reuse member-search logic, gym-scoped, capped (Req 2.3)."""
    from app.services.member import list_members
    items, _ = list_members(db, gym_id, search=q, page=1, page_size=limit)
    return items
