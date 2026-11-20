"""add otp_codes table

Creates the otp_codes table. Uses checkfirst so it's a no-op on fresh databases
(where the initial migration's create_all already made it) and creates it on
existing deployed databases.

Revision ID: 0003_otp_codes
Revises: 0002_branches
Create Date: 2026-01-03 00:00:00
"""
from typing import Sequence, Union

from alembic import op

from app.models.otp import OtpCode

revision: str = "0003_otp_codes"
down_revision: Union[str, None] = "0002_branches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    OtpCode.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    OtpCode.__table__.drop(bind=op.get_bind(), checkfirst=True)
