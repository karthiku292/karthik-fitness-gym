"""Assistant endpoint: admin-only, gym-scoped, stateless question answering.

Mirrors the read-only shape of ``app/api/v1/routers/reports.py``: router-level
``require_admin`` gating (Req 1.1, 8.3), gym scope via ``current_user.gym_id``
(Req 1.3), and no ``commit`` / no audit write so a request persists nothing
(Req 2.1). 401 comes from ``get_current_user`` (Req 1.2), 403 from
``require_admin`` (Req 1.1), and 422 from the ``AskRequest`` schema validators
(Req 4.2, 4.3, 4.4) — all before the handler body runs.
"""
from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, DbSession, require_admin
from app.schemas.assistant import AskRequest, AskResponse
from app.services import assistant as svc

router = APIRouter(
    prefix="/assistant",
    tags=["assistant"],
    dependencies=[Depends(require_admin)],          # Req 1.1, 8.3
)


@router.post("/ask", response_model=AskResponse)
def ask(db: DbSession, current_user: CurrentUser, body: AskRequest):
    # Read-only: no commit, no audit row -> nothing is persisted (Req 2.1).
    return svc.ask(
        db, current_user.gym_id, body.question, body.recent_messages,  # Req 1.3, 4.1, 5.2
    )
