"""Ontology layer (spec 7A.4) and the Scribe (spec 10.5). Owner: Ron.

Revision ID: 002
"""
from alembic import op

revision = "002"
down_revision = "001"

ONTOLOGY_TABLES = [
    "patient", "encounter", "observation", "condition", "allergy",
    "medication_request", "note", "referral",
]

DDL = """
CREATE TABLE raw_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL, source_ref text NOT NULL,
  resource_type text NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
  fetched_at timestamptz NOT NULL, processed_at timestamptz, error text,
  UNIQUE (source_system, source_ref, payload_hash)
);

CREATE TABLE patient_identity (
  patient_id uuid NOT NULL REFERENCES patient(id),
  source_system text NOT NULL, source_patient_ref text NOT NULL,
  match_method text NOT NULL, match_score double precision,
  linked_by uuid REFERENCES app_user(id), linked_at timestamptz DEFAULT now(), active boolean DEFAULT true,
  PRIMARY KEY (source_system, source_patient_ref)
);

CREATE TABLE object_version (
  id bigserial PRIMARY KEY, object_type text NOT NULL, object_id uuid NOT NULL,
  version int NOT NULL, data jsonb NOT NULL, raw_record_id uuid REFERENCES raw_record(id),
  superseded_at timestamptz DEFAULT now(), UNIQUE (object_type, object_id, version)
);

CREATE TABLE ontology_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), link_type text NOT NULL,
  from_type text NOT NULL, from_id uuid NOT NULL, to_type text NOT NULL, to_id uuid NOT NULL,
  derived_by text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES app_user(id), created_at timestamptz DEFAULT now(),
  UNIQUE (link_type, from_id, to_id)
);
CREATE INDEX ontology_link_from ON ontology_link (from_id);
CREATE INDEX ontology_link_to ON ontology_link (to_id);

CREATE TABLE referral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  from_provider_id uuid REFERENCES provider(id), to_provider_id uuid REFERENCES provider(id),
  reason text, status text, source_system text NOT NULL, source_ref text,
  ingested_at timestamptz DEFAULT now(), effective_at timestamptz, sensitivity sensitivity DEFAULT 'normal'
);

CREATE TABLE context_cache (
  view_name text NOT NULL, subject_id uuid NOT NULL, input_hash text NOT NULL,
  level smallint NOT NULL, content jsonb NOT NULL, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (view_name, subject_id, level)
);

CREATE TABLE scribe_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  encounter_id uuid REFERENCES encounter(id),
  started_by uuid NOT NULL REFERENCES app_user(id), consent_ref text NOT NULL,
  started_at timestamptz DEFAULT now(), ended_at timestamptz,
  end_reason text, windows_analyzed int DEFAULT 0,
  observations jsonb DEFAULT '[]',  -- text observations only, never frames
  note_id uuid REFERENCES note(id), review_status text DEFAULT 'pending',
  reviewed_by uuid REFERENCES app_user(id), reviewed_at timestamptz
);

ALTER TABLE note ADD COLUMN is_legal_record boolean DEFAULT true;
ALTER TABLE observation ADD COLUMN value_norm double precision, ADD COLUMN unit_norm text;
"""


def upgrade() -> None:
    op.execute(DDL)
    for t in ONTOLOGY_TABLES:
        op.execute(
            f"ALTER TABLE {t} ADD COLUMN version int NOT NULL DEFAULT 1, "
            f"ADD COLUMN record_status text NOT NULL DEFAULT 'current', "
            f"ADD COLUMN raw_record_id uuid REFERENCES raw_record(id);"
        )


def downgrade() -> None:
    raise NotImplementedError("Reset with `make seed` instead.")
