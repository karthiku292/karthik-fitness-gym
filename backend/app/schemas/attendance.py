"""Attendance and QR-token schemas."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AttendanceMethod, MemberStatus


class QRTokenOut(BaseModel):
    member_id: int
    token: str
    rotated_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class CheckInRequest(BaseModel):
    """Exactly one identifier. token -> method=qr; member_id -> method=manual."""
    token: Optional[str] = Field(default=None, min_length=1, max_length=64)
    member_id: Optional[int] = None

    @model_validator(mode="after")
    def _exactly_one(self):
        if bool(self.token) == bool(self.member_id):
            raise ValueError("Provide exactly one of 'token' or 'member_id'.")
        return self


class AttendanceRow(BaseModel):
    """Shared projection for check-in results and history rows (Req 5.3)."""
    id: int
    member_id: int
    member_name: str
    member_code: str
    attendance_date: date
    check_in_at: datetime
    method: AttendanceMethod
    verified_by: Optional[int] = None


class CheckInResult(BaseModel):
    created: bool               # True = new row this request; False = already checked in today
    attendance: AttendanceRow


class MemberLookupOut(BaseModel):
    id: int
    name: str
    member_code: str
    phone: Optional[str] = None
    status: MemberStatus
    model_config = {"from_attributes": True}


class AttendanceTodayOut(BaseModel):
    attendance_today: int
