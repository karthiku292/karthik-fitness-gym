"""Gym (tenant) branding and settings schemas."""
from typing import Optional

from pydantic import BaseModel


class GymPublic(BaseModel):
    """Branding info safe to expose pre-login. Includes contact details and a
    free-form `settings` dict (tagline, hours, socials...) so each gym can fully
    brand their own copy."""

    id: int
    name: str
    slug: str
    logo_url: Optional[str] = None
    primary_color: str
    accent_color: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    currency: str = "INR"
    settings: dict = {}

    model_config = {"from_attributes": True}


class GymOut(GymPublic):
    timezone: str

    model_config = {"from_attributes": True}


class GymUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    settings: Optional[dict] = None


# ---------- Branches ----------
class BranchBase(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    hours: Optional[str] = None
    photo_url: Optional[str] = None
    map_url: Optional[str] = None


class BranchCreate(BranchBase):
    pass


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    hours: Optional[str] = None
    photo_url: Optional[str] = None
    map_url: Optional[str] = None
    is_active: Optional[bool] = None


class BranchOut(BranchBase):
    id: int
    gym_id: int
    is_active: bool

    model_config = {"from_attributes": True}


class BranchPublic(BranchBase):
    id: int

    model_config = {"from_attributes": True}
