"""add branches table

Creates the branches table. Uses checkfirst so it's a no-op on fresh databases
(where the initial migration's create_all already made it) and creates it on
existing deployed databases.

Revision ID: 0002_branches
Revises: 0001_initial
Create Date: 2026-01-02 00:00:00
"""
from typing import Sequence, Union

from alembic import op

from app.models.branch import Branch

revision: str = "0002_branches"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    Branch.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Branch.__table__.drop(bind=op.get_bind(), checkfirst=True)
