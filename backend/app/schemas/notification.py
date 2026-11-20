"""Notification template, log, manual-send, and reminder-run schemas."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.enums import NotificationChannel, NotificationStatus

# Standardized Event Types (Req 3.2). Kept in the schema layer so the reused
# String(60) column needs no change.
EventType = Literal["welcome", "membership_expiry", "payment_receipt"]


class TemplateBase(BaseModel):
    event_type: EventType
    channel: NotificationChannel
    subject: Optional[str] = Field(default=None, max_length=200)   # Req 3.3
    body: str = Field(min_length=1, max_length=2000)               # Req 3.3


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    event_type: Optional[EventType] = None
    channel: Optional[NotificationChannel] = None
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None                               # Req 3.6


class TemplateOut(TemplateBase):
    id: int
    gym_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    """Log/row projection; member_name joined in for the table (Req 8)."""
    id: int
    gym_id: int
    member_id: Optional[int] = None
    member_name: Optional[str] = None
    channel: NotificationChannel
    event_type: str
    status: NotificationStatus
    provider_ref: Optional[str] = None
    error: Optional[str] = None
    sent_at: Optional[datetime] = None
    created_at: datetime


class ManualSendRequest(BaseModel):
    """member_id + exactly one of {template_id} or {event_type + channel}."""
    member_id: int
    template_id: Optional[int] = None
    event_type: Optional[EventType] = None
    channel: Optional[NotificationChannel] = None
    membership_id: Optional[int] = None                            # Req 5.6
    payment_id: Optional[int] = None                               # Req 5.6

    @model_validator(mode="after")
    def _one_selector(self):
        by_id = self.template_id is not None
        by_pair = self.event_type is not None and self.channel is not None
        if by_id == by_pair:
            raise ValueError(
                "Provide either 'template_id' or both 'event_type' and 'channel'."
            )
        return self


class ReminderRunRequest(BaseModel):
    within_days: int = Field(default=7)          # clamped to 1..90 in service (Req 7.1)
    channel: NotificationChannel = NotificationChannel.whatsapp   # Req 7.4


class ReminderRunResult(BaseModel):
    memberships_selected: int                    # Req 7.6
    notifications_created: int                   # Req 7.6
    channel: NotificationChannel
    within_days: int
