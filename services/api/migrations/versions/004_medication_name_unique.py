"""medication.name is unique: the inventory feed and the seed both upsert by name. Owner: Ron.

Revision ID: 004
"""
from alembic import op

revision = "004"
down_revision = "003"


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX medication_name_key ON medication (name)")


def downgrade() -> None:
    op.execute("DROP INDEX medication_name_key")
