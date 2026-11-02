"""Payment endpoints: record, list, refund, revenue summary, PDF receipt."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession, require_admin
from app.models.enums import PaymentMethod, PaymentStatus
from app.models.member import Member
from app.models.payment import Payment
from app.schemas.common import Page
from app.schemas.payment import (
    PaymentCreate,
    PaymentOut,
    PaymentWithMember,
    RefundRequest,
    RevenueSummary,
)
from app.services import payment as svc
from app.services.audit import log_action

router = APIRouter(prefix="/payments", tags=["payments"])


def _with_member(db, gym_id: int, p: Payment) -> PaymentWithMember:
    m = db.get(Member, p.member_id)
    data = PaymentWithMember.model_validate(p)
    if m:
        data.member_name = m.name
        data.member_code = m.member_code
    return data


@router.get("/summary", response_model=RevenueSummary, dependencies=[Depends(require_admin)])
def summary(db: DbSession, current_user: CurrentUser):
    return svc.revenue_summary(db, current_user.gym_id)


@router.get("", response_model=Page[PaymentWithMember], dependencies=[Depends(require_admin)])
def list_payments(
    db: DbSession,
    current_user: CurrentUser,
    member_id: int | None = None,
    status_filter: PaymentStatus | None = Query(default=None, alias="status"),
    method: PaymentMethod | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    stmt = select(Payment).where(Payment.gym_id == current_user.gym_id)
    if member_id is not None:
        stmt = stmt.where(Payment.member_id == member_id)
    if status_filter is not None:
        stmt = stmt.where(Payment.status == status_filter)
    if method is not None:
        stmt = stmt.where(Payment.method == method)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Payment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = [_with_member(db, current_user.gym_id, p) for p in rows]
    pages = (total + page_size - 1) // page_size
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.post(
    "",
    response_model=PaymentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_payment(db: DbSession, current_user: CurrentUser, body: PaymentCreate):
    payment = svc.record_payment(
        db,
        current_user.gym_id,
        member_id=body.member_id,
        amount=body.amount,
        method=body.method,
        membership_id=body.membership_id,
        pay_status=body.status,
        notes=body.notes,
        razorpay_ref=body.razorpay_ref,
        created_by=current_user.id,
    )
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="payment.record",
        entity="payment",
        entity_id=payment.id,
        after={"txn": payment.txn_code, "amount": float(payment.amount), "method": payment.method.value},
    )
    db.commit()
    db.refresh(payment)
    return payment


def _get_payment(db, gym_id: int, payment_id: int) -> Payment:
    p = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.gym_id == gym_id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return p


@router.get("/{payment_id}", response_model=PaymentWithMember, dependencies=[Depends(require_admin)])
def get_payment(db: DbSession, current_user: CurrentUser, payment_id: int):
    return _with_member(db, current_user.gym_id, _get_payment(db, current_user.gym_id, payment_id))


@router.post("/{payment_id}/refund", response_model=PaymentOut, dependencies=[Depends(require_admin)])
def refund(db: DbSession, current_user: CurrentUser, payment_id: int, body: RefundRequest):
    payment = _get_payment(db, current_user.gym_id, payment_id)
    svc.refund_payment(db, payment, refunded_by=current_user.id)
    log_action(
        db,
        gym_id=current_user.gym_id,
        actor_user_id=current_user.id,
        action="payment.refund",
        entity="payment",
        entity_id=payment.id,
        after={"reason": body.reason},
    )
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/{payment_id}/receipt", dependencies=[Depends(require_admin)])
def receipt(db: DbSession, current_user: CurrentUser, payment_id: int):
    payment = _get_payment(db, current_user.gym_id, payment_id)
    pdf = svc.build_receipt_pdf(db, payment)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt-{payment.txn_code}.pdf"'},
    )
