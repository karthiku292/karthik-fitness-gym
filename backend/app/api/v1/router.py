"""Aggregate all v1 routers."""
from fastapi import APIRouter

from app.api.v1.routers import (
    auth,
    members,
    memberships,
    payments,
    plans,
    portal,
    settings,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(settings.router)
api_router.include_router(members.router)
api_router.include_router(plans.router)
api_router.include_router(memberships.router)
api_router.include_router(payments.router)
api_router.include_router(portal.router)

# Future phases register their routers here:
# attendance, trainers, workouts, diets, reports, notifications, ai
