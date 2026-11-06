"""Aggregate all v1 routers."""
from fastapi import APIRouter

from app.api.v1.routers import (
    auth,
    branches,
    fitness,
    members,
    memberships,
    payments,
    plans,
    portal,
    settings,
    trainers,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(settings.router)
api_router.include_router(branches.router)
api_router.include_router(members.router)
api_router.include_router(plans.router)
api_router.include_router(memberships.router)
api_router.include_router(payments.router)
api_router.include_router(portal.router)
api_router.include_router(trainers.router)
api_router.include_router(fitness.router)

# Future phases register their routers here:
# attendance, reports, notifications, ai
