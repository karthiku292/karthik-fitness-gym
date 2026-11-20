"""Recent-endpoint smoke coverage.

One smoke per newer feature endpoint, issued through the real app via the
in-process ``client`` fixture with the shared ``admin_token`` / ``trainer_token``
and ``auth`` fixtures from ``conftest.py``. Each asserts the endpoint is
reachable and returns its expected envelope offline, with every optional
integration credential zeroed by the harness.

Response shapes verified against the routers/schemas:
- ``GET /api/v1/attendance/today`` -> ``AttendanceTodayOut`` = ``{"attendance_today": int}``
  (``require_staff``: admin or trainer). (app/api/v1/routers/attendance.py)
- ``GET /api/v1/reports/summary`` -> ``DashboardSummary`` with ``total_members``
  (``require_admin``). (app/api/v1/routers/reports.py, app/schemas/report.py)
- ``GET /api/v1/notifications/templates`` -> ``list[TemplateOut]`` (JSON list,
  empty under the minimal seed; ``require_admin``). (app/api/v1/routers/notifications.py)
- ``POST /api/v1/assistant/ask`` body ``AskRequest`` (``{"question": <str>}``) ->
  ``AskResponse`` (``answer``/``ai_configured``/``source``/``model``); with
  ``OPENAI_API_KEY`` empty the service takes the local, no-network path, so
  ``ai_configured`` is ``False`` and ``source`` is ``"local"``.
  (app/api/v1/routers/assistant.py, app/services/assistant.py)

Covers Requirement 7 of the testing-ci-cd spec.
Design: Components and Interfaces section 2 (test_smoke_endpoints.py); Test Matrix.
"""
from __future__ import annotations


def test_attendance_today(client, auth, trainer_token):
    """GET /api/v1/attendance/today as staff (trainer) returns the day's count (Req 7.1)."""
    r = client.get("/api/v1/attendance/today", headers=auth(trainer_token))
    assert r.status_code == 200, r.text
    assert "attendance_today" in r.json()


def test_reports_summary(client, auth, admin_token):
    """GET /api/v1/reports/summary as admin returns a dashboard summary body (Req 7.2)."""
    r = client.get("/api/v1/reports/summary", headers=auth(admin_token))
    assert r.status_code == 200, r.text
    assert "total_members" in r.json()


def test_notifications_templates(client, auth, admin_token):
    """GET /api/v1/notifications/templates as admin returns a JSON list (Req 7.3)."""
    r = client.get("/api/v1/notifications/templates", headers=auth(admin_token))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)  # empty list is valid under the minimal seed


def test_assistant_ask(client, auth, admin_token):
    """POST /api/v1/assistant/ask as admin answers locally when AI is unconfigured (Req 7.4)."""
    r = client.post(
        "/api/v1/assistant/ask",
        headers=auth(admin_token),
        json={"question": "How many members do we have?"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["answer"], str) and body["answer"]
    assert body["ai_configured"] is False
    assert body["source"] == "local"
