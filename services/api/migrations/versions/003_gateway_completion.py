"""Gateway completion: audit attribution, report status, break-the-glass. Owner: Ron.

- audit_log.on_behalf_of_user_id / ran_on: the human an AI step acted for, and where it ran (spec 13;
  desktop AuditRow). actor_kind also takes 'lab_tech' and 'scribe' for those AI steps.
- report.status: draft until the finding is reviewed (spec 14.4 footer "Reviewed by Dr. X").
- finding.flags / thumbnail_path: from the Lab Technician output (spec 9).
- emergency_access: 60-minute break-the-glass grants (spec 13 SHOULD).

Revision ID: 003
"""
from alembic import op

revision = "003"
down_revision = "002"

DDL = """
ALTER TABLE audit_log ADD COLUMN on_behalf_of_user_id uuid REFERENCES app_user(id), ADD COLUMN ran_on text;

ALTER TABLE report ADD COLUMN status text NOT NULL DEFAULT 'draft';
-- spec 9 output fields the finding DDL had no place for
ALTER TABLE finding ADD COLUMN flags jsonb NOT NULL DEFAULT '[]', ADD COLUMN thumbnail_path text;

CREATE TABLE emergency_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id), patient_id uuid NOT NULL REFERENCES patient(id),
  reason text NOT NULL, granted_at timestamptz DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX emergency_access_lookup ON emergency_access (user_id, patient_id, expires_at);
"""


def upgrade() -> None:
    op.execute(DDL)


def downgrade() -> None:
    raise NotImplementedError("Reset with `make seed` instead.")
