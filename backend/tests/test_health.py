"""Health endpoint coverage.

Asserts the service health probe answers so CI fails fast when the application
cannot start. Uses the shared ``client`` fixture from ``conftest.py`` (in-process
TestClient, no network).

Covers Requirement 3 of the testing-ci-cd spec.
Design: Components and Interfaces section 2 (test_health.py); Test Matrix.
"""
from __future__ import annotations


def test_health_ok(client):
    """GET /health returns 200 with status "ok" (Req 3.1)."""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
