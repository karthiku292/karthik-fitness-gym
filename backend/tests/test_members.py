"""Member management coverage.

Exercises the core member workflow through the real app via the in-process
``client`` fixture: creating a member as admin and listing members back. Uses
the shared ``admin_token`` and ``auth`` fixtures from ``conftest.py``.

The server auto-generates ``member_code`` (``GM-000001``...), assigns
``joining_date`` (today), and sets ``status=active``, so ``name`` is the only
required field in the create payload (see ``app/schemas/member.py`` ->
``MemberCreate``/``MemberBase``). ``GET /api/v1/members`` returns the ``Page``
envelope from ``app/schemas/common.py`` (``items``/``total``/``page``/
``page_size``/``pages``).

Each test creates the member it asserts on, so the pair is order-independent and
tolerant of the session-shared in-memory database.

Covers Requirement 6 of the testing-ci-cd spec.
Design: Components and Interfaces section 2 (test_members.py); Test Matrix.
"""
from __future__ import annotations


def test_create_member(client, auth, admin_token):
    """POST /api/v1/members as admin returns 201 with a member_code (Req 6.1)."""
    r = client.post(
        "/api/v1/members",
        headers=auth(admin_token),
        json={"name": "Alice Example"},  # minimal valid payload (only name required)
    )
    assert r.status_code == 201, r.text
    assert r.json()["member_code"]  # auto-generated, e.g. GM-000001


def test_list_members_includes_created(client, auth, admin_token):
    """GET /api/v1/members returns a paginated body including the new member (Req 6.2)."""
    created = client.post(
        "/api/v1/members",
        headers=auth(admin_token),
        json={"name": "Bob Example"},
    ).json()

    r = client.get("/api/v1/members", headers=auth(admin_token))
    assert r.status_code == 200, r.text
    items = r.json()["items"]  # Page envelope: items/total/page/page_size/pages
    assert any(i["member_code"] == created["member_code"] for i in items)
