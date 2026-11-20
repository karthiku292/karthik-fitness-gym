"""Authentication login coverage (Requirement 4).

Exercises ``POST /api/v1/auth/login`` through the shared in-process ``client``
fixture: a valid admin credential pair must return 200 with both tokens, and a
wrong password for a known identifier must return 401. Runs fully offline
against the harness's isolated in-memory database.

Design: Components and Interfaces section 2 (``test_auth.py``); Test Matrix.
"""
from __future__ import annotations

from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD


def test_login_success(client):
    """Valid admin credentials yield 200 with access and refresh tokens (Req 4.1)."""
    r = client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},  # OAuth2 form
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["refresh_token"]


def test_login_wrong_password(client):
    """A known identifier with an incorrect password is rejected 401 (Req 4.2)."""
    r = client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": "wrong-password"},  # OAuth2 form
    )
    assert r.status_code == 401, r.text
