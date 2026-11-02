"""initial schema

Builds the full schema directly from the SQLAlchemy models. Using the model
metadata (rather than hand-transcribed op.create_table calls) guarantees the
initial database matches the ORM exactly. Subsequent schema changes should use
`alembic revision --autogenerate` to produce explicit diffs against this state.

Revision ID: 0001_initial
Revises:
Create Date: 2026-01-01 00:00:00
"""
from typing import Sequence, Union

from alembic import op

from app.db.base import Base
import app.models  # noqa: F401  (registers all tables on Base.metadata)

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
