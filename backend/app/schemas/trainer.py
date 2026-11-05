"""Trainer schemas (admin-managed, shown on the public site)."""
from typing import Optional

from pydantic import BaseModel, Field


class TrainerBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    specialization: Optional[str] = Field(default=None, max_length=160)
    bio: Optional[str] = Field(default=None, max_length=1000)
    photo_url: Optional[str] = Field(default=None, max_length=500)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=160)
    hourly_rate: Optional[float] = Field(default=None, ge=0)


class TrainerCreate(TrainerBase):
    pass


class TrainerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    specialization: Optional[str] = Field(default=None, max_length=160)
    bio: Optional[str] = Field(default=None, max_length=1000)
    photo_url: Optional[str] = Field(default=None, max_length=500)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=160)
    hourly_rate: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class TrainerOut(TrainerBase):
    id: int
    gym_id: int
    is_active: bool

    model_config = {"from_attributes": True}


class TrainerPublic(BaseModel):
    id: int
    name: str
    specialization: Optional[str] = None
    bio: Optional[str] = None
    photo_url: Optional[str] = None

    model_config = {"from_attributes": True}
