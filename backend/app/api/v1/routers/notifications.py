"""Notifications endpoints: admin-only template CRUD, log, manual send, reminders.

Every route is gated by ``require_admin`` at the router level and strictly
gym-scoped via ``current_user.gym_id`` (Req 1.1, 10.3). The service layer
``flush``es; each mutating handler calls ``svc`` then ``log_action`` then
``db.commit()`` in a single transaction, mirroring ``app/services/attendance.py``
and ``app/api/v1/routers/attendance.py``.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.enums import NotificationChannel, NotificationStatus
from app.schemas.common import Page
from app.schemas.notification import (
    ManualSendRequest,
    NotificationOut,
    ReminderRunRequest,
    ReminderRunResult,
    TemplateCreate,
    TemplateOut,
    TemplateUpdate,
)
from app.services import notification as svc
from app.services.audit import log_action
from app.services.member import get_member

router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
    dependencies=[Depends(require_admin)],  # Req 1.1, 10.3
)


# ----- Templates -----

@router.get("/templates", response_model=list[TemplateOut])
def list_templates(db: DbSession, current_user: CurrentUser):
    return svc.list_templates(db, current_user.gym_id)  # Req 3.4


@router.post(
    "/templates",
    response_model=TemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def create_template(db: DbSession, current_user: CurrentUser, body: TemplateCreate):
    tpl = svc.create_template(db, current_user.gym_id, body)  # Req 3.1
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="notification.template_create",
        entity="notification_template",
        entity_id=tpl.id,
        after={"event_type": tpl.event_type, "channel": tpl.channel.value},
    )
    db.commit()
    db.refresh(tpl)
    return tpl


@router.put("/templates/{template_id}", response_model=TemplateOut)
def update_template(
    db: DbSession, current_user: CurrentUser, template_id: int, body: TemplateUpdate
):
    tpl = svc.get_template(db, current_user.gym_id, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")  # Req 1.5
    svc.update_template(db, tpl, body)  # Req 3.5, 3.6
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="notification.template_update",
        entity="notification_template",
        entity_id=tpl.id,
    )
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(db: DbSession, current_user: CurrentUser, template_id: int):
    tpl = svc.get_template(db, current_user.gym_id, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")  # Req 1.5
    svc.delete_template(db, tpl)  # Req 3.7
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="notification.template_delete",
        entity="notification_template",
        entity_id=template_id,
    )
    db.commit()


# ----- Log -----

@router.get("", response_model=Page[NotificationOut])
def list_log(
    db: DbSession,
    current_user: CurrentUser,
    status_f: NotificationStatus | None = Query(default=None, alias="status"),
    channel: NotificationChannel | None = None,
    event_type: str | None = None,
    member_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),  # Req 8.3
):
    items, total = svc.list_notifications(
        db,
        current_user.gym_id,
        status=status_f,
        channel=channel,
        event_type=event_type,
        member_id=member_id,
        page=page,
        page_size=page_size,
    )  # Req 8.1, 8.2, 8.4, 8.5
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


# ----- Manual send -----

@router.post("/send", response_model=NotificationOut)
def send(db: DbSession, current_user: CurrentUser, body: ManualSendRequest):
    member = get_member(db, current_user.gym_id, body.member_id)  # gym-scoped
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")  # Req 5.5
    template = svc.resolve_template(
        db,
        current_user.gym_id,
        template_id=body.template_id,
        event_type=body.event_type,
        channel=body.channel,
    )  # Req 5.1, 5.2, 5.3
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No matching template")  # Req 5.4
    membership = payment = None
    if body.membership_id is not None:  # Req 5.6, 1.5
        membership = svc.get_membership(db, current_user.gym_id, body.membership_id)
        if membership is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    if body.payment_id is not None:
        payment = svc.get_payment(db, current_user.gym_id, body.payment_id)
        if payment is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    note = svc.dispatch(
        db,
        current_user.gym_id,
        member=member,
        template=template,
        membership=membership,
        payment=payment,
    )  # Req 5.7
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="notification.send",
        entity="notification",
        entity_id=note.id,
        after={"channel": note.channel.value, "status": note.status.value},
    )
    db.commit()  # Req 5.8
    db.refresh(note)
    return svc.to_row(note, member.name)


# ----- Run reminders -----

@router.post("/run-reminders", response_model=ReminderRunResult)
def run_reminders(db: DbSession, current_user: CurrentUser, body: ReminderRunRequest):
    window = svc.clamp_window(body.within_days)  # Req 7.1 (effective window reported back)
    # Resolve the membership_expiry template up front so an absent one 404s
    # before any dispatch (Req 7.5); run_expiry_reminders re-resolves internally.
    template = svc.resolve_template(
        db, current_user.gym_id, event_type="membership_expiry", channel=body.channel
    )
    if template is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No active membership_expiry template for this channel",
        )  # Req 7.5
    selected, created = svc.run_expiry_reminders(
        db, current_user.gym_id, body.within_days, channel=body.channel
    )  # Req 7.1, 7.2, 7.3, 7.4, 7.6
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="notification.run_reminders",
        entity="notification",
        after={"selected": selected, "created": created, "channel": body.channel.value},
    )
    db.commit()
    return ReminderRunResult(
        memberships_selected=selected,
        notifications_created=created,
        channel=body.channel,
        within_days=window,
    )  # Req 7.6
