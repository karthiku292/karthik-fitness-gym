"""Aggregate all v1 routers."""
from fastapi import APIRouter

from app.api.v1.routers import (
    assistant,
    attendance,
    auth,
    branches,
    fitness,
    members,
    memberships,
    notifications,
    payments,
    plans,
    portal,
    reports,
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
api_router.include_router(attendance.router)
api_router.include_router(reports.router)
api_router.include_router(notifications.router)
api_router.include_router(assistant.router)
