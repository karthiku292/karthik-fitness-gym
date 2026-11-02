"""Payment business logic: transaction IDs, recording, refunds, revenue, receipts."""
import io
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import PaymentMethod, PaymentStatus
from app.models.gym import Gym
from app.models.member import Member
from app.models.payment import Payment


def generate_txn_code(db: Session, gym_id: int) -> str:
    """Unique per-gym transaction id like TXN-20261030-0001."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TXN-{today}-"
    count_today = db.scalar(
        select(func.count())
        .select_from(Payment)
        .where(Payment.gym_id == gym_id, Payment.txn_code.like(f"{prefix}%"))
    ) or 0
    seq = count_today + 1
    while True:
        code = f"{prefix}{seq:04d}"
        exists = db.scalar(
            select(Payment.id).where(Payment.gym_id == gym_id, Payment.txn_code == code)
        )
        if not exists:
            return code
        seq += 1


def record_payment(
    db: Session,
    gym_id: int,
    *,
    member_id: int,
    amount: float,
    method: PaymentMethod,
    membership_id: Optional[int],
    pay_status: PaymentStatus,
    notes: Optional[str],
    razorpay_ref: Optional[str],
    created_by: Optional[int],
) -> Payment:
    member = db.scalar(
        select(Member).where(Member.id == member_id, Member.gym_id == gym_id)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

    payment = Payment(
        gym_id=gym_id,
        member_id=member_id,
        membership_id=membership_id,
        txn_code=generate_txn_code(db, gym_id),
        amount=amount,
        method=method,
        status=pay_status,
        paid_at=datetime.now(timezone.utc) if pay_status == PaymentStatus.paid else None,
        notes=notes,
        razorpay_ref=razorpay_ref,
        created_by=created_by,
    )
    db.add(payment)
    db.flush()
    return payment


def refund_payment(db: Session, payment: Payment, refunded_by: Optional[int]) -> Payment:
    if payment.status == PaymentStatus.refunded:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment already refunded")
    if payment.status != PaymentStatus.paid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only paid payments can be refunded")
    payment.status = PaymentStatus.refunded
    payment.refunded_by = refunded_by
    db.flush()
    return payment


def revenue_summary(db: Session, gym_id: int) -> dict:
    from datetime import datetime as _dt, time as _time, timedelta as _td

    today = date.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)

    def _start(d: date) -> _dt:
        return _dt.combine(d, _time.min, tzinfo=timezone.utc)

    def total_since(since: date) -> float:
        val = db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.gym_id == gym_id,
                Payment.status == PaymentStatus.paid,
                Payment.paid_at >= _start(since),
            )
        )
        return float(val or 0)

    today_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at >= _start(today),
            Payment.paid_at < _start(today + _td(days=1)),
        )
    )
    pending = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.gym_id == gym_id, Payment.status == PaymentStatus.pending
        )
    )

    # Group by month in Python so this works on both SQLite (dev) and Postgres (prod).
    paid_rows = db.execute(
        select(Payment.paid_at, Payment.amount).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at.is_not(None),
        )
    ).all()
    buckets: dict[str, dict] = {}
    for paid_at, amount in paid_rows:
        key = paid_at.strftime("%Y-%m")
        b = buckets.setdefault(key, {"period": key, "total": 0.0, "count": 0})
        b["total"] += float(amount or 0)
        b["count"] += 1
    by_month = [buckets[k] for k in sorted(buckets)][-12:]

    method_rows = db.execute(
        select(Payment.method, func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.gym_id == gym_id, Payment.status == PaymentStatus.paid)
        .group_by(Payment.method)
    ).all()
    by_method = {str(m.value if hasattr(m, "value") else m): float(t or 0) for m, t in method_rows}

    return {
        "today": float(today_total or 0),
        "this_month": total_since(month_start),
        "this_year": total_since(year_start),
        "pending": float(pending or 0),
        "by_month": by_month,
        "by_method": by_method,
    }


def build_receipt_pdf(db: Session, payment: Payment) -> bytes:
    """Generate a downloadable PDF receipt for a payment."""
    # Imported lazily so the app starts even if reportlab isn't installed.
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    gym = db.get(Gym, payment.gym_id)
    member = db.get(Member, payment.member_id)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 30 * mm

    c.setFillColorRGB(0.83, 0.69, 0.22)  # gold
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, y, (gym.name if gym else "Gym").upper())
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 10)
    y -= 8 * mm
    if gym and gym.address:
        c.drawString(20 * mm, y, gym.address)
        y -= 6 * mm

    c.setFont("Helvetica-Bold", 14)
    y -= 6 * mm
    c.drawString(20 * mm, y, "PAYMENT RECEIPT")
    c.setLineWidth(1)
    y -= 4 * mm
    c.line(20 * mm, y, width - 20 * mm, y)
    y -= 10 * mm

    def row(label: str, value: str):
        nonlocal y
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, label)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(80 * mm, y, value)
        y -= 8 * mm

    row("Transaction ID", payment.txn_code)
    row("Date", payment.paid_at.strftime("%d %b %Y, %H:%M") if payment.paid_at else "-")
    row("Member", f"{member.name} ({member.member_code})" if member else str(payment.member_id))
    row("Method", payment.method.value.upper())
    row("Status", payment.status.value.upper())
    if payment.notes:
        row("Notes", payment.notes[:60])

    y -= 4 * mm
    c.line(20 * mm, y, width - 20 * mm, y)
    y -= 12 * mm
    currency = (gym.currency if gym else "INR")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, y, "Amount Paid")
    c.drawRightString(width - 20 * mm, y, f"{currency} {float(payment.amount):,.2f}")

    y -= 20 * mm
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(20 * mm, y, "Thank you for your membership. This is a computer-generated receipt.")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()
