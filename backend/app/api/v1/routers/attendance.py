"""Attendance endpoints: QR check-in, history, today metric, member search, admin QR."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentUser, DbSession, require_admin, require_staff
from app.models.enums import AttendanceMethod
from app.schemas.attendance import (
    AttendanceRow,
    AttendanceTodayOut,
    CheckInRequest,
    CheckInResult,
    MemberLookupOut,
    QRTokenOut,
)
from app.schemas.common import Page
from app.services import attendance as svc
from app.services.audit import log_action
from app.services.member import get_member

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/check-in", response_model=CheckInResult, dependencies=[Depends(require_staff)])
def check_in(db: DbSession, current_user: CurrentUser, body: CheckInRequest):
    if body.token:
        member = svc.resolve_member_by_token(db, current_user.gym_id, body.token)
        method = AttendanceMethod.qr
        err = "QR code not recognised for this gym"
    else:
        member = get_member(db, current_user.gym_id, body.member_id)  # gym-scoped
        method = AttendanceMethod.manual
        err = "Member not found"
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, err)  # Req 2.4, 2.5

    att, created = svc.check_in(
        db, current_user.gym_id, member, method=method, verified_by=current_user.id
    )
    if created:  # Req 4.1 / 4.2
        log_action(
            db,
            gym_id=current_user.gym_id,
            actor_user_id=current_user.id,
            action="attendance.check_in",
            entity="attendance",
            entity_id=att.id,
            after={"member_id": member.id, "method": method.value},
        )
    db.commit()  # single txn (Req 8.3)
    db.refresh(att)
    return CheckInResult(created=created, attendance=AttendanceRow(**svc.to_row(att, member)))


@router.get("", response_model=Page[AttendanceRow], dependencies=[Depends(require_staff)])
def history(
    db: DbSession,
    current_user: CurrentUser,
    on_date: date | None = Query(default=None, alias="date"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    items, total = svc.list_history(
        db, current_user.gym_id, on_date=on_date, page=page, page_size=page_size
    )
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.get("/today", response_model=AttendanceTodayOut, dependencies=[Depends(require_staff)])
def today(db: DbSession, current_user: CurrentUser):
    return AttendanceTodayOut(attendance_today=svc.count_today(db, current_user.gym_id))


@router.get(
    "/member-search",
    response_model=list[MemberLookupOut],
    dependencies=[Depends(require_staff)],
)
def member_search(db: DbSession, current_user: CurrentUser, q: str | None = None):
    return svc.search_members(db, current_user.gym_id, q)


@router.get(
    "/members/{member_id}/qr",
    response_model=QRTokenOut,
    dependencies=[Depends(require_admin)],
)
def admin_get_qr(db: DbSession, current_user: CurrentUser, member_id: int):
    if get_member(db, current_user.gym_id, member_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    row = svc.get_or_create_token(db, current_user.gym_id, member_id)  # Req 1.3
    db.commit()
    return row


@router.post(
    "/members/{member_id}/qr/regenerate",
    response_model=QRTokenOut,
    dependencies=[Depends(require_admin)],
)
def admin_regen_qr(db: DbSession, current_user: CurrentUser, member_id: int):
    if get_member(db, current_user.gym_id, member_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    row = svc.regenerate_token(db, current_user.gym_id, member_id)  # Req 1.5
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="attendance.qr_regenerate",
        entity="qr_token",
        entity_id=row.id,
    )
    db.commit()
    return row
