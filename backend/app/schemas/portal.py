"""Schemas for the member self-service portal."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class PortalMembership(BaseModel):
    id: int
    plan_id: int
    plan_name: str
    start_date: date
    end_date: date
    status: str
    days_left: int


class PortalAttendance(BaseModel):
    attendance_date: date
    check_in_at: datetime

    model_config = {"from_attributes": True}
