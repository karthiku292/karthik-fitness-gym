"""Member management endpoints (admin)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentUser, DbSession, require_admin
from app.core.security import hash_password
from app.models.enums import MemberStatus, UserRole
from app.models.user import User
from app.schemas.common import Page
from app.schemas.member import MemberCreate, MemberCredentialsIn, MemberOut, MemberUpdate
from app.services import member as svc
from app.services.audit import log_action

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=Page[MemberOut], dependencies=[Depends(require_admin)])
def list_members(
    db: DbSession,
    current_user: CurrentUser,
    search: str | None = None,
    status_filter: MemberStatus | None = Query(default=None, alias="status"),
    trainer_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    items, total = svc.list_members(
        db,
        current_user.gym_id,
        search=search,
        status=status_filter,
        trainer_id=trainer_id,
        page=page,
        page_size=page_size,
    )
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.post(
    "",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_member(db: DbSession, current_user: CurrentUser, body: MemberCreate):
    member = svc.create_member(db, current_user.gym_id, body)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="member.create",
        entity="member",
        entity_id=member.id,
        after={"member_code": member.member_code, "name": member.name},
    )
    db.commit()
    db.refresh(member)
    return member


@router.get("/{member_id}", response_model=MemberOut, dependencies=[Depends(require_admin)])
def get_member(db: DbSession, current_user: CurrentUser, member_id: int):
    member = svc.get_member(db, current_user.gym_id, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


@router.put("/{member_id}", response_model=MemberOut, dependencies=[Depends(require_admin)])
def update_member(db: DbSession, current_user: CurrentUser, member_id: int, body: MemberUpdate):
    member = svc.get_member(db, current_user.gym_id, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    svc.update_member(db, member, body)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="member.update",
        entity="member",
        entity_id=member.id,
    )
    db.commit()
    db.refresh(member)
    return member


@router.post(
    "/{member_id}/credentials",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin)],
)
def set_member_credentials(
    db: DbSession, current_user: CurrentUser, member_id: int, body: MemberCredentialsIn
):
    """Create or reset a member's portal login (role=member).

    Members sign in with their phone number, so the phone is the login
    identifier. The users table still requires a unique email, so we keep the
    member's email if present or synthesize a stable placeholder.
    """
    member = svc.get_member(db, current_user.gym_id, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

    phone = body.phone.strip()

    # Phone must be unique within the gym (except for this member's own user).
    clash = (
        db.query(User)
        .filter(User.gym_id == current_user.gym_id, User.phone == phone)
        .first()
    )
    if clash and clash.id != member.user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That phone number is already used for another login",
        )

    if member.user_id:
        user = db.get(User, member.user_id)
    else:
        user = None

    if user is None:
        # users.email is NOT NULL + unique per gym. Use the member's email if
        # they have one, otherwise synthesize a unique placeholder from phone.
        email = member.email or f"{phone}@members.local"
        eclash = (
            db.query(User)
            .filter(User.gym_id == current_user.gym_id, User.email == email)
            .first()
        )
        if eclash:
            email = f"{phone}.{member.id}@members.local"
        user = User(
            gym_id=current_user.gym_id,
            email=email,
            phone=phone,
            full_name=member.name,
            role=UserRole.member,
            is_active=True,
            password_hash=hash_password(body.password),
        )
        db.add(user)
        db.flush()
        member.user_id = user.id
    else:
        user.phone = phone
        user.password_hash = hash_password(body.password)
        user.role = UserRole.member
        user.is_active = True

    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="member.credentials",
        entity="member",
        entity_id=member.id,
    )
    db.commit()
    return {"ok": True, "phone": phone}


@router.post(
    "/{member_id}/deactivate",
    response_model=MemberOut,
    dependencies=[Depends(require_admin)],
)
def deactivate_member(db: DbSession, current_user: CurrentUser, member_id: int):
    member = svc.get_member(db, current_user.gym_id, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    member.status = MemberStatus.inactive
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="member.deactivate",
        entity="member",
        entity_id=member.id,
    )
    db.commit()
    db.refresh(member)
    return member
