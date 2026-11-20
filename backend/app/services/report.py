"""Reports analytics: read-only, gym-scoped aggregation with Python-side bucketing.

All time-series bucketing is performed in Python (mirroring ``payment.revenue_summary``),
so results are identical on SQLite (dev) and PostgreSQL (prod). Aggregation functions
take ``(db: Session, gym_id: int)``, return plain ``dict`` / ``list[dict]``, and never
mutate state (no ``add`` / ``commit`` / ``delete`` / ``log_action``).

This module holds the shared date/bucketing helpers; the individual aggregation
functions (``dashboard_summary``, ``revenue_trend``, ``signup_trend``,
``attendance_trend``, ``revenue_by_plan``) are added alongside them.
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.attendance import Attendance
from app.models.enums import MemberStatus, PaymentStatus
from app.models.member import Member
from app.models.membership import Membership, MembershipPlan
from app.models.payment import Payment
from app.services.payment import revenue_summary


def _start(d: date) -> datetime:
    """Midnight UTC for a date (the same month boundary ``revenue_summary`` uses)."""
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _last_n_month_keys(today: date, n: int) -> list[str]:
    """n consecutive 'YYYY-MM' keys ending in today's month, oldest -> newest."""
    keys, y, m = [], today.year, today.month
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(keys))


def _last_n_day_keys(today: date, n: int) -> list[str]:
    """n consecutive 'YYYY-MM-DD' keys ending today, oldest -> newest."""
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def dashboard_summary(db: Session, gym_id: int) -> dict:
    """Five gym-scoped Dashboard KPIs (Req 1): member counts, this-month revenue,
    and the pending-payment count. Read-only; an empty gym yields zeros."""

    def _count(*where) -> int:
        return db.scalar(select(func.count()).select_from(Member).where(*where)) or 0

    total = _count(Member.gym_id == gym_id)
    active = _count(Member.gym_id == gym_id, Member.status == MemberStatus.active)
    expired = _count(Member.gym_id == gym_id, Member.status == MemberStatus.expired)

    pending_count = db.scalar(
        select(func.count()).select_from(Payment).where(
            Payment.gym_id == gym_id, Payment.status == PaymentStatus.pending
        )
    ) or 0

    # Reuse the reference computation so monthly_revenue can never drift (Req 1.4).
    monthly_revenue = revenue_summary(db, gym_id)["this_month"]

    return {
        "total_members": total,
        "active_members": active,
        "expired": expired,
        "monthly_revenue": float(monthly_revenue),
        "pending_payments": int(pending_count),
    }


def revenue_trend(db: Session, gym_id: int) -> list[dict]:
    """Monthly paid-revenue trend for the trailing 12 months (Req 2).

    Fetches gym-scoped ``paid`` payments with a non-null ``paid_at``, buckets them by
    ``%Y-%m`` in Python (SQLite/Postgres parity), and emits one point per month key
    from ``_last_n_month_keys(today, 12)``. Months with no revenue are zero-filled, so
    the series is continuous and ordered oldest -> newest. Read-only."""
    keys = _last_n_month_keys(date.today(), 12)
    rows = db.execute(
        select(Payment.paid_at, Payment.amount).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at.is_not(None),
        )
    ).all()
    buckets: dict[str, float] = {}
    for paid_at, amount in rows:
        key = paid_at.strftime("%Y-%m")
        buckets[key] = buckets.get(key, 0.0) + float(amount or 0)
    return [{"month": k, "revenue": round(buckets.get(k, 0.0), 2)} for k in keys]


def signup_trend(db: Session, gym_id: int) -> list[dict]:
    """Monthly new-member signup trend for the trailing 12 months (Req 3).

    Fetches gym-scoped members' ``joining_date``, buckets them by ``%Y-%m`` in Python
    (SQLite/Postgres parity), and emits one point per month key from
    ``_last_n_month_keys(today, 12)`` with a ``signups`` count. Months with no new
    members are zero-filled, so the series is continuous and ordered oldest -> newest.
    Read-only."""
    keys = _last_n_month_keys(date.today(), 12)
    rows = db.execute(
        select(Member.joining_date).where(Member.gym_id == gym_id)
    ).all()
    buckets: dict[str, int] = {}
    for (joining_date,) in rows:
        if joining_date is None:
            continue
        key = joining_date.strftime("%Y-%m")
        buckets[key] = buckets.get(key, 0) + 1
    return [{"month": k, "signups": buckets.get(k, 0)} for k in keys]


def attendance_trend(db: Session, gym_id: int) -> list[dict]:
    """Daily attendance (check-in) trend for the trailing 30 days (Req 4).

    Fetches gym-scoped attendance rows whose ``attendance_date`` falls on or after
    ``window_start = today - 29 days`` (a value comparison against a Python-computed
    date, not a SQL date function, so SQLite/Postgres parity holds), buckets them by
    ISO date (``YYYY-MM-DD``) in Python, and emits one point per day key from
    ``_last_n_day_keys(today, 30)`` with a ``count``. Days with no check-ins are
    zero-filled, so the series is continuous and ordered oldest -> newest. Read-only."""
    today = date.today()
    keys = _last_n_day_keys(today, 30)
    window_start = today - timedelta(days=29)
    rows = db.execute(
        select(Attendance.attendance_date).where(
            Attendance.gym_id == gym_id,
            Attendance.attendance_date >= window_start,
        )
    ).all()
    buckets: dict[str, int] = {}
    for (att_date,) in rows:
        key = att_date.isoformat()
        buckets[key] = buckets.get(key, 0) + 1
    return [{"date": k, "count": buckets.get(k, 0)} for k in keys]


def revenue_by_plan(db: Session, gym_id: int) -> list[dict]:
    """Current-month paid revenue grouped by membership plan name (Req 5).

    Fetches gym-scoped ``paid`` payments whose ``paid_at`` falls within the current
    month using the *same* bound as ``revenue_summary``'s ``this_month``
    (``paid_at >= _start(month_start)``, a value comparison rather than a SQL date
    function). Because the predicate is identical, the per-plan revenues conserve:
    they sum to ``dashboard_summary(...)["monthly_revenue"]`` (Req 5.1, A2) and parity
    holds between SQLite and Postgres (Req 5.5).

    Each payment's ``amount`` is attributed to its plan's name, resolved through two
    gym-scoped maps (membership -> plan_id, plan_id -> name). A payment with no
    ``membership_id``, a membership outside this gym, or a plan that no longer exists
    falls into a single ``"Unassigned"`` bucket (Req 5.2, 5.3, A3); the ``.get(...)``
    defaults cover deleted/dangling references defensively. Entries are sorted by
    revenue descending, ties broken by plan name, and rounded to 2dp. When the gym has
    no current-month paid payments the breakdown is empty (Req 5.4). Read-only."""
    month_start = date.today().replace(day=1)
    payments = db.execute(
        select(Payment.amount, Payment.membership_id).where(
            Payment.gym_id == gym_id,
            Payment.status == PaymentStatus.paid,
            Payment.paid_at >= _start(month_start),  # same bound as revenue_summary.this_month
        )
    ).all()
    if not payments:
        return []

    # Both lookups are gym-scoped, so a payment can never resolve to another gym's plan.
    membership_to_plan = dict(
        db.execute(
            select(Membership.id, Membership.plan_id).where(Membership.gym_id == gym_id)
        ).all()
    )
    plan_name = dict(
        db.execute(
            select(MembershipPlan.id, MembershipPlan.name).where(
                MembershipPlan.gym_id == gym_id
            )
        ).all()
    )

    buckets: dict[str, float] = {}
    for amount, membership_id in payments:
        plan_id = membership_to_plan.get(membership_id) if membership_id is not None else None
        label = plan_name.get(plan_id, "Unassigned") if plan_id is not None else "Unassigned"
        buckets[label] = buckets.get(label, 0.0) + float(amount or 0)

    return sorted(
        ({"plan": k, "revenue": round(v, 2)} for k, v in buckets.items()),
        key=lambda e: (-e["revenue"], e["plan"]),
    )
