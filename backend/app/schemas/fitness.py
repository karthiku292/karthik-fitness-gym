"""Workout & diet plan schemas."""
from typing import Optional

from pydantic import BaseModel, Field


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    details: Optional[str] = None  # long-form plan text (stored in JSON column)


class PlanOut(BaseModel):
    id: int
    gym_id: int
    name: str
    description: Optional[str] = None
    details: Optional[str] = None


class AssignIn(BaseModel):
    member_id: int
