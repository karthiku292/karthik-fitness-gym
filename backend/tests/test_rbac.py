"""Role-based access control coverage (Requirement 5).

Exercises the admin-only ``GET /api/v1/members`` endpoint, which is gated by
``dependencies=[Depends(require_admin)]`` (see
``app/api/v1/routers/members.py``; ``require_admin = require_roles(UserRole.admin)``
in ``app/core/deps.py``). The ``OAuth2PasswordBearer`` scheme raises 401 when the
Authorization header is absent, and ``require_roles`` raises 403 when an
authenticated member-role token lacks the admin role.

Design: Components and Interfaces section 2 (``test_rbac.py``); Test Matrix.
"""
from __future__ import annotations


def test_protected_requires_auth(client):
    """Unauthenticated request to a protected endpoint is rejected (Req 5.1)."""
    r = client.get("/api/v1/members")  # no Authorization header
    assert r.status_code == 401, r.text


def test_admin_only_rejects_member(client, auth, member_token):
    """Member-role token on an admin-only endpoint is forbidden (Req 5.2)."""
    r = client.get("/api/v1/members", headers=auth(member_token))
    assert r.status_code == 403, r.text
