"""Initial schema: spec section 7. Owner: Ron. Do not edit after hour 2; add a new migration instead.

Revision ID: 001
"""
from alembic import op

revision = "001"
down_revision = None

UNIVERSAL = """
  source_system text NOT NULL, source_ref text, ingested_at timestamptz DEFAULT now(),
  effective_at timestamptz, sensitivity sensitivity DEFAULT 'normal'
"""

DDL = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE sensitivity AS ENUM ('normal','restricted');
CREATE TYPE finding_status AS ENUM ('pending_review','confirmed','overridden','rejected');
CREATE TYPE role_name AS ENUM ('admin','physician','nurse','scribe','lab_staff');

CREATE TABLE provider (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  fhir_base_url text NOT NULL, kind text NOT NULL
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, full_name text NOT NULL,
  password_hash text NOT NULL, role role_name NOT NULL,
  provider_id uuid REFERENCES provider(id), active boolean DEFAULT true
);

CREATE TABLE patient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mrn text UNIQUE NOT NULL,
  given_name text NOT NULL, family_name text NOT NULL, birth_date date NOT NULL, sex text,
  {UNIVERSAL}
);

CREATE TABLE care_team_member (
  patient_id uuid REFERENCES patient(id), user_id uuid REFERENCES app_user(id),
  relationship text NOT NULL, PRIMARY KEY (patient_id, user_id)
);

CREATE TABLE encounter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  provider_id uuid REFERENCES provider(id), type text, reason text,
  start_at timestamptz, end_at timestamptz,
  {UNIVERSAL}
);

CREATE TABLE observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  encounter_id uuid REFERENCES encounter(id), category text NOT NULL,
  loinc_code text, display text NOT NULL,
  value_num double precision, value_text text, unit text,
  ref_low double precision, ref_high double precision, interpretation text,
  {UNIVERSAL}
);

CREATE TABLE condition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  code text, display text NOT NULL, clinical_status text,
  {UNIVERSAL}
);

CREATE TABLE allergy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  substance text NOT NULL, reaction text, criticality text,
  {UNIVERSAL}
);

CREATE TABLE medication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rxnorm_code text, name text NOT NULL, form text, strength text
);

CREATE TABLE inventory_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), medication_id uuid NOT NULL REFERENCES medication(id),
  on_hand int NOT NULL, reorder_point int NOT NULL, backordered boolean DEFAULT false,
  supplier text, expected_restock_at timestamptz, updated_at timestamptz DEFAULT now()
);

CREATE TABLE medication_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  medication_id uuid REFERENCES medication(id), status text NOT NULL,
  dosage_text text, requested_by uuid REFERENCES app_user(id),
  {UNIVERSAL}
);

CREATE TABLE specimen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  accession text UNIQUE NOT NULL, site text, collected_at timestamptz
);

CREATE TABLE slide (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), specimen_id uuid NOT NULL REFERENCES specimen(id),
  file_path text NOT NULL, stain text DEFAULT 'H&E', magnification text,
  embeddings_ready boolean DEFAULT false, uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slide_id uuid NOT NULL REFERENCES slide(id),
  patient_id uuid NOT NULL REFERENCES patient(id),
  model_name text NOT NULL, model_version text NOT NULL,
  label text NOT NULL, confidence double precision NOT NULL,
  class_scores jsonb NOT NULL, heatmap_path text, top_tiles jsonb,
  status finding_status DEFAULT 'pending_review',
  reviewed_by uuid REFERENCES app_user(id), reviewed_at timestamptz,
  final_label text, review_note text, created_at timestamptz DEFAULT now()
);

CREATE TABLE report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), finding_id uuid NOT NULL REFERENCES finding(id),
  body_md text NOT NULL, citations jsonb NOT NULL, locked_check_passed boolean NOT NULL,
  author text DEFAULT 'resident', created_at timestamptz DEFAULT now()
);

CREATE TABLE note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  encounter_id uuid REFERENCES encounter(id),
  kind text NOT NULL, -- 'progress' | 'scribe' | 'shadowing' | 'referral' | 'imaging_report' | 'visual_scribe'
  author_name text, body text NOT NULL,
  {UNIVERSAL}
);

CREATE TABLE appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, reason text, status text DEFAULT 'booked'
);

CREATE TABLE transcript_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  from_provider_id uuid NOT NULL REFERENCES provider(id),
  status text NOT NULL, consent_ref text, resources_imported int DEFAULT 0,
  created_at timestamptz DEFAULT now(), completed_at timestamptz
);

CREATE TABLE alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patient(id),
  user_id uuid REFERENCES app_user(id), rule_id text NOT NULL, severity text NOT NULL,
  title text NOT NULL, detail text, source_ids jsonb,
  acknowledged_at timestamptz, created_at timestamptz DEFAULT now()
);

CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id),
  patient_id uuid REFERENCES patient(id),
  kind text NOT NULL, -- 'analyze_slide' | 'review_finding' | 'sign_report' | 'review_transcript' | 'sign_order' | 'identity_review'
  ref_id uuid, title text NOT NULL, done_at timestamptz, created_at timestamptz DEFAULT now()
);

CREATE TABLE chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patient(id),
  object_type text NOT NULL, object_id uuid NOT NULL, text text NOT NULL,
  embedding vector(384) NOT NULL, sensitivity sensitivity DEFAULT 'normal'
);
CREATE INDEX chunk_embedding_hnsw ON chunk USING hnsw (embedding vector_cosine_ops);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz DEFAULT now(),
  actor_user_id uuid REFERENCES app_user(id), actor_kind text NOT NULL,
  action text NOT NULL, object_type text NOT NULL, object_id uuid, patient_id uuid,
  reason text, request_id text
);

-- audit_log is append-only for the app role
CREATE OR REPLACE FUNCTION audit_log_no_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_no_change();
"""


def upgrade() -> None:
    op.execute(DDL)


def downgrade() -> None:
    op.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
