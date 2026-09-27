/**
 * Hand-written mirror of the gateway contract (spec section 15). snake_case on purpose.
 * When Ron's OpenAPI is live, run `pnpm gen:api` and re-export from ./schema.d.ts instead.
 * Anything marked SPEC-QUESTION is not defined in the spec yet — confirm with Ron.
 */

export type Uuid = string
export type IsoDateTime = string

export type Role = 'admin' | 'physician' | 'nurse' | 'scribe' | 'lab_staff'

/** Mirrors services/api/app/rbac/permissions.py (Ron). Keep names identical. */
export type Permission =
  | 'authenticated'
  | 'view_dashboard'
  | 'view_demographics'
  | 'view_labs'
  | 'view_notes'
  | 'view_restricted'
  | 'run_lab_technician'
  | 'review_findings'
  | 'request_transcripts'
  | 'record_consent'
  | 'use_ask'
  | 'view_inventory'
  | 'start_scribe'
  | 'review_scribe'
  | 'view_audit'
  | 'manage_users'
  | 'emergency_access'

export interface Provenance {
  source_system: string
  source_ref: string
  ingested_at: IsoDateTime
}

export interface ListResponse<T> {
  items: T[]
  next_cursor: string | null
}

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_NOT_ON_CARE_TEAM'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL'

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; request_id: string }
}

// ---- Auth
export interface User {
  id: Uuid
  full_name: string
  role: Role
}
export interface LoginResponse {
  access_token: string
  user: User
}
/** Shapes match services/api/app/auth/router.py. */
export interface MeResponse {
  user_id: Uuid
  role: Role
  permissions: Permission[]
}

// ---- Dashboard
export type Severity = 'critical' | 'warning' | 'info'
export interface AttentionItem {
  id: Uuid
  patient_id: Uuid
  patient_name: string
  problem: string
  source: string
  severity: Severity
  action_label: string
  action_target: 'patient' | 'lab' | 'inventory'
}
export interface Appointment {
  id: Uuid
  patient_id: Uuid
  patient_name: string
  starts_at: IsoDateTime
  reason: string
  status: 'scheduled' | 'checked_in' | 'in_progress' | 'completed'
}
export interface Task {
  id: Uuid
  kind: 'review_finding' | 'sign_report' | 'review_transcript' | 'analyze_slide'
  title: string
  detail: string
  patient_id: Uuid
}
export interface RecentPatient {
  patient_id: Uuid
  name: string
  context: string
  opened_at: IsoDateTime
}
export interface SupplyWatchItem {
  medication: string
  on_hand: number
  backordered: boolean
  expected_restock: IsoDateTime | null
}
export interface DashboardResponse {
  attention: AttentionItem[]
  schedule: Appointment[]
  tasks: Task[]
  recent_patients: RecentPatient[]
  supply_watch: SupplyWatchItem[]
}

// ---- Patient
export interface SourceChip {
  source_system: string
  label: string
  status: 'current' | 'merged' | 'pending'
}
export interface Allergy {
  substance: string
  provenance: Provenance
}
export interface Patient {
  id: Uuid
  name: string
  age: number
  sex: 'M' | 'F' | 'X'
  mrn: string
  allergies: Allergy[]
  /** null = no allergy information from any source (show "Unknown", never "None"). */
  allergy_status: 'recorded' | 'none_known' | 'unknown'
  sources: SourceChip[]
}
export interface PatientListItem {
  id: Uuid
  name: string
  age: number
  sex: 'M' | 'F' | 'X'
  mrn: string
}
export interface Condition {
  display: string
  provenance: Provenance
}
export interface PatientSummary {
  conditions: Condition[]
  medications: {
    display: string
    inventory_status: InventoryStatus
    provenance: Provenance
  }[]
  allergies: Allergy[]
  last_encounter: { date: IsoDateTime; reason: string; provenance: Provenance } | null
  new_from_sources: { text: string; source_system: string; kind: 'gap' | 'conflict' }[]
}

/** Spec observation table (DDL). interpretation null = not flagged by the source, never "normal". */
export type Interpretation = 'N' | 'H' | 'L' | 'HH' | 'LL'
export interface Observation {
  id: Uuid
  category: 'laboratory' | 'vital-signs'
  loinc_code: string | null
  display: string
  value_num: number | null
  value_text: string | null
  unit: string | null
  ref_low: number | null
  ref_high: number | null
  interpretation: Interpretation | null
  effective_at: IsoDateTime | null
  provenance: Provenance
}

/** GET /patients/{id}/medications. inventory null = no inventory row, never assume "in stock". */
export type InventoryStatus = 'in_stock' | 'low' | 'backordered'
export interface MedicationRequest {
  id: Uuid
  medication: string
  status: 'active' | 'on-hold' | 'completed' | 'stopped'
  dosage_text: string | null
  effective_at: IsoDateTime | null
  inventory: {
    status: InventoryStatus
    on_hand: number
    expected_restock_at: IsoDateTime | null
  } | null
  provenance: Provenance
}

// ---- Transcript requests (spec 11 state machine, transcript_request DDL)
export type TranscriptStatus = 'requested' | 'consented' | 'fetched' | 'merged' | 'denied'
export interface TranscriptRequest {
  id: Uuid
  patient_id: Uuid
  /** Display name of the source provider. The DDL stores from_provider_id; the UI needs the name joined. */
  from_provider: string
  status: TranscriptStatus
  consent_ref: string | null
  resources_imported: number
  created_at: IsoDateTime
  completed_at: IsoDateTime | null
}
/**
 * One row of the admin consent queue (spec 11 step 2: "a task for the admin").
 * SPEC-QUESTION: no spec route lists these yet; shape proposed in docs/BACKEND_HANDOFF.md.
 */
export interface ConsentTask extends TranscriptRequest {
  patient_name: string
  patient_mrn: string
  requested_by_name: string
}
/** POST /transcripts/{id}/consent body (spec 15). */
export interface ConsentDecision {
  consent_ref: string
  granted: boolean
}

// ---- Citations (SPEC-QUESTION: public source-detail route not defined; see CLAUDE.md)
export type CitationKind =
  'observation' | 'note' | 'condition' | 'medication' | 'finding' | 'inventory' | 'scribe'
export interface Citation {
  id: string
  kind: CitationKind
  label: string
  object_id: Uuid
  provenance: Provenance
}
export interface SourceRecord {
  citation: Citation
  title: string
  body: string
  recorded_at: IsoDateTime
}

// ---- Lab
export type FindingStatus = 'pending_review' | 'confirmed' | 'overridden' | 'rejected'
export interface Finding {
  id: Uuid
  patient_id: Uuid
  slide_id: Uuid
  specimen_label: string
  label: string
  label_display: string
  confidence: number
  model_name: string
  model_version: string
  flags: string[]
  status: FindingStatus
  final_label: string | null
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: IsoDateTime | null
  heatmap_url: string | null
  tile_urls: string[]
  provenance: Provenance
}
export interface Report {
  id: Uuid
  finding_id: Uuid
  status: 'draft' | 'final'
  sentences: { text: string; citation_ids: string[] }[]
  citations: Citation[]
}
export type ReviewAction = 'confirm' | 'override' | 'reject'
export interface ReviewRequest {
  action: ReviewAction
  final_label?: string
  note?: string
}

// ---- Scribe (spec 10.5)
export type ObservationCategory =
  'mobility' | 'posture' | 'respiratory' | 'cough' | 'movement' | 'device_use' | 'interaction' | 'other'
export interface ScribeObservation {
  t: string
  category: ObservationCategory
  text: string
  confidence: number
}
export interface ScribeWindow {
  session_id: Uuid
  window_start: string
  window_end: string
  observations: ScribeObservation[]
  people_in_frame: number
  quality_flags: string[]
}
export interface ScribeSession {
  id: Uuid
  patient_id: Uuid
  consent_ref: string
  started_at: IsoDateTime
  ended_at: IsoDateTime | null
  end_reason: 'stopped' | 'timeout' | 'encounter_closed' | null
  windows_analyzed: number
  review_status: 'pending' | 'accepted' | 'edited' | 'discarded'
}
/** Spec note table. kind: progress | scribe | shadowing | referral | imaging_report | visual_scribe */
export interface Note {
  id: Uuid
  kind: string
  title: string
  body: string
  author_name: string | null
  effective_at: IsoDateTime | null
  is_legal_record: boolean
  status: 'draft' | 'final' | 'discarded'
  provenance: Provenance
}
export interface ScribeStopResponse {
  session: ScribeSession
  note: Note
}
export interface ScribeReviewRequest {
  action: 'accept' | 'edit' | 'discard'
  body?: string
}

// ---- LiveScribing: the Scribe plus the visit conversation, stored in MongoDB by the gateway.
// SPEC-QUESTION(Ron): routes live under /patients/{id}/live-scribe-sessions (services/api/app/routes/live_scribe.py).
export interface TranscriptSegment {
  t: string
  end: string
  text: string
}
export interface ScribeAction {
  id: string
  action: string
  times: string[]
  why_relevant: string
  confidence: 'low' | 'medium' | 'high'
  source: 'visual' | 'sound' | 'conversation'
  /** confirmed / unverified: checked by the confirming agent (Mellea); not_checked: rule-based review. */
  verification: 'confirmed' | 'unverified' | 'not_checked'
  /** The attending's check: include this possible symptom in the scribing report. */
  included: boolean
}
export interface LiveScribeWindow {
  session_id: Uuid
  window_start: string
  window_end: string
  observations: ScribeObservation[]
  transcript: TranscriptSegment[]
  people_in_frame: number
  quality_flags: string[]
}
export type LiveScribeStatus = 'active' | 'review' | 'report_draft' | 'accepted' | 'discarded'
export interface LiveScribeReport {
  body: string
  included_action_ids: string[]
  status: 'draft' | 'final' | 'discarded'
  drafted_by_name: string | null
  drafted_at: IsoDateTime
  reviewed_by_name: string | null
  reviewed_at: IsoDateTime | null
}
export interface LiveScribeSessionSummary {
  id: Uuid
  patient_id: Uuid
  patient: { id: Uuid; mrn: string; name: string; birth_date: string; sex: string | null }
  consent_ref: string
  started_by_name: string | null
  started_at: IsoDateTime
  ended_at: IsoDateTime | null
  end_reason: string | null
  status: LiveScribeStatus
  windows_analyzed: number
  summary: string | null
  counts: { observations: number; transcript: number; actions: number }
}
export interface LiveScribeSession extends LiveScribeSessionSummary {
  observations: ScribeObservation[]
  transcript: TranscriptSegment[]
  actions: ScribeAction[]
  report: LiveScribeReport | null
}
export interface LiveScribeReviewRequest {
  action: 'accept' | 'edit' | 'discard'
  body?: string
}

// ---- Ask
export interface AskResponse {
  answer_md: string
  citations: Citation[]
  conversation_id: string
}

// ---- Audit
export interface AuditRow {
  id: Uuid
  at: IsoDateTime
  actor_name: string
  actor_kind: 'user' | 'resident' | 'lab_tech' | 'scribe'
  on_behalf_of: string | null
  action: string
  object_type: string
  patient_name: string | null
  allowed: boolean
  /** Assurant track: where the AI step ran. SPEC-QUESTION: not in the audit DDL yet. */
  ran_on: 'local' | 'anthropic_api' | null
}
