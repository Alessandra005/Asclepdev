/**
 * In-memory mock gateway. Mirrors spec section 15 paths, error envelope and RBAC so the UI can be
 * built before the backend exists. On by default; VITE_USE_MOCKS=false turns it off. Delete nothing
 * here when the real gateway lands; it doubles as the fixture source for Vitest.
 */
import { GatewayError } from '../errors'
import type {
  AskResponse,
  AuditRow,
  CitationKind,
  ConsentDecision,
  ConsentTask,
  DashboardResponse,
  ErrorCode,
  Finding,
  ListResponse,
  LiveScribeReviewRequest,
  LiveScribeSession,
  LiveScribeSessionSummary,
  LiveScribeWindow,
  LoginResponse,
  MeResponse,
  Note,
  Patient,
  Provenance,
  RecordsTree,
  RecordsTreeItem,
  ReviewRequest,
  ScribeAction,
  ScribeReviewRequest,
  ScribeObservation,
  ScribeSession,
  ScribeWindow,
  Slide,
  SourceRecord,
  TranscriptRequest,
  User
} from '../types'
import {
  AUDIT_SEED,
  CITATIONS,
  DASHBOARD,
  DEMO_PASSWORD,
  GREGORY_AFTER_MERGE,
  GREGORY_FINDING,
  GREGORY_LABS_NORTHSIDE,
  GREGORY_LABS_RIVERSIDE,
  GREGORY_MEDS_RIVERSIDE,
  GREGORY_NOTES_NORTHSIDE,
  GREGORY_NOTES_RIVERSIDE,
  GREGORY_REPORT,
  IDS,
  LINDA_LABS,
  LIVE_TRANSCRIPT_SCRIPT,
  LINDA_NOTES,
  PRIYA_MEDS,
  PATIENTS,
  RIVERSIDE_RESOURCES,
  ROLE_PERMISSIONS,
  SCRIBE_SCRIPT,
  SOURCE_RECORDS,
  SUMMARY_AFTER,
  SUMMARY_BEFORE,
  TRANSCRIPT_PROVIDERS,
  USERS
} from './data'

/** A transcript_request row plus mock-only fields: who asked (DDL requested_by) and when consent landed. */
type MockTranscript = ConsentTask & { requested_by: string; consented_ms: number | null }

// ---- mutable demo state (reset on reload; survives sign-out, so one window can play both roles)
const state = {
  /** True once Gregory's Riverside request reaches 'merged'. Computed only in refreshTranscripts(). */
  merged: false,
  /** Newest first. */
  transcripts: [] as MockTranscript[],
  finding: structuredClone(GREGORY_FINDING) as Finding,
  /** Gregory's slide starts unanalyzed (demo steps 1 and 4); classify reveals the canned finding. */
  analyzed: false,
  reportGenerated: false,
  audit: structuredClone(AUDIT_SEED) as AuditRow[],
  scribe: new Map<
    string,
    {
      session: ScribeSession
      windows: number
      startedMs: number
      note: Note | null
      obs: ScribeObservation[]
    }
  >(),
  live: new Map<string, { session: LiveScribeSession; startedMs: number }>(),
  /** Physician-accepted LiveScribing reports; they reach the Notes sub-tab like approved Scribe notes. */
  liveNotes: [] as { patient_id: string; note: Note }[],
  /** Set true from the console (window.__asclepMock.failNext = true) to rehearse error states. */
  failNext: false
}
;(globalThis as unknown as { __asclepMock: typeof state }).__asclepMock = state

/** Mock ingestion worker timing after consent (spec 11): pull the bundle, then merge it. */
const FETCHED_AFTER_MS = 1500
const MERGED_AFTER_MS = 3500
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const fail = (status: number, code: ErrorCode, message: string): never => {
  throw new GatewayError(status, code, message, 'req_mock_' + Math.random().toString(36).slice(2, 7))
}
const uid = (): string => crypto.randomUUID()
const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (s: number): string =>
  `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`

function userFromToken(token: string | null): (typeof USERS)[number] {
  const u = USERS.find((x) => token === 'mock-token-' + x.id) ?? userFromGatewayJwt(token)
  if (!u) return fail(401, 'UNAUTHENTICATED', 'Session expired. Sign in again.')
  return u
}
/**
 * Mixed mode (VITE_LIVE_ROUTES): login is real, so mocked routes see the gateway's JWT. Its payload is
 * {sub, role} (services/api/app/auth/security.py); map the role to the first demo user with it.
 */
function userFromGatewayJwt(token: string | null): (typeof USERS)[number] | undefined {
  const part = token?.split('.')[1]
  if (!part) return undefined
  try {
    const { role } = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
    return USERS.find((x) => x.role === role)
  } catch {
    return undefined
  }
}
function requireCareTeam(
  u: (typeof USERS)[number],
  patientId: string,
  objectType: string | null = 'patient'
): void {
  const ok = u.care_team === 'all' || (Array.isArray(u.care_team) && u.care_team.includes(patientId))
  // One audit row per object type per request (spec 13); polling routes pass null to avoid noise.
  if (objectType || !ok) audit(u, 'read', objectType ?? 'patient', PATIENTS[patientId]?.name ?? null, ok)
  if (!ok) {
    if (u.role === 'admin') fail(403, 'FORBIDDEN_ROLE', 'Admins manage access but cannot read clinical data.')
    fail(403, 'FORBIDDEN_NOT_ON_CARE_TEAM', "You are not on this patient's care team.")
  }
}
function requirePerm(u: (typeof USERS)[number], perm: (typeof ROLE_PERMISSIONS)['admin'][number]): void {
  if (!ROLE_PERMISSIONS[u.role].includes(perm))
    fail(403, 'FORBIDDEN_ROLE', 'Your role does not allow this action.')
}
function audit(
  u: Pick<User, 'full_name'>,
  action: string,
  object_type: string,
  patient_name: string | null,
  allowed = true,
  ai?: { kind: AuditRow['actor_kind']; ran_on: AuditRow['ran_on'] }
): void {
  state.audit.unshift({
    id: uid(),
    at: new Date().toISOString(),
    actor_name: ai
      ? { resident: 'Resident', lab_tech: 'Lab Technician', scribe: 'Scribe', user: u.full_name }[ai.kind]
      : u.full_name,
    actor_kind: ai?.kind ?? 'user',
    on_behalf_of: ai ? u.full_name : null,
    action,
    object_type,
    patient_name,
    allowed,
    ran_on: ai?.ran_on ?? null
  })
}
/** Mock of the Resident summarizer: fixed headings, each line cites session timestamps (spec 10.5). */
function draftNote(obs: ScribeObservation[], secs: number, windows: number, consentRef: string): string {
  const section = (title: string, cats: string[]): string[] => {
    const lines = obs.filter((o) => cats.includes(o.category)).map((o) => `- ${o.text} [${o.t}]`)
    return [title, ...(lines.length ? lines : ['- None observed']), '']
  }
  return [
    ...section('Mobility and posture', ['mobility', 'posture', 'device_use']),
    ...section('Breathing and cough', ['respiratory', 'cough']),
    ...section('Other observed behavior', ['movement', 'interaction', 'other']),
    'Session details',
    `- Duration ${clock(secs)}, ${windows} windows analyzed, consent ${consentRef}`
  ].join('\n')
}

// ---- LiveScribing mock: mirrors review_rules() in services/resident/app/live_scribe.py
const VISUAL_WHY: Record<string, string> = {
  cough: 'Coughing seen during the visit.',
  respiratory: 'Visible breathing effort.',
  mobility: 'How the patient moved around the room.',
  posture: 'Posture held during the visit.',
  movement: 'Notable movement during the visit.',
  device_use: 'Use of a medical device or aid.'
}
const SAID_KEYWORDS: [string, string][] = [
  ['short of breath', 'shortness of breath'],
  ['breath', 'shortness of breath'],
  ['chest pain', 'chest pain'],
  ['pain', 'pain'],
  ['cough', 'cough'],
  ['tired', 'fatigue'],
  ['fatigue', 'fatigue'],
  ['weight', 'weight change'],
  ['pounds', 'weight change'],
  ['fever', 'fever'],
  ['dizzy', 'dizziness'],
  ['blood', 'bleeding']
]
function flagActions(s: LiveScribeSession): ScribeAction[] {
  const out: Omit<ScribeAction, 'id'>[] = []
  for (const [cat, why] of Object.entries(VISUAL_WHY)) {
    const hits = s.observations.filter((o) => o.category === cat)
    if (!hits.length) continue
    const best = Math.max(...hits.map((o) => o.confidence))
    out.push({
      action: hits.length === 1 ? hits[0]!.text : `${hits[0]!.text} (seen ${hits.length} times)`,
      times: hits.map((o) => o.t),
      why_relevant: why,
      confidence: hits.length > 1 || best >= 0.85 ? 'high' : best >= 0.6 ? 'medium' : 'low',
      source: 'visual',
      verification: 'not_checked',
      included: false
    })
  }
  const said = new Map<string, { t: string; text: string }[]>()
  for (const seg of s.transcript) {
    const low = seg.text.toLowerCase()
    if (low.includes('?')) continue // the doctor's questions are not symptoms
    const hit = SAID_KEYWORDS.find(([w]) => low.includes(w) && !new RegExp(`\\bno\\s+${w}`).test(low))
    if (hit) said.set(hit[1], [...(said.get(hit[1]) ?? []), seg])
  }
  for (const [symptom, segs] of said) {
    out.push({
      action: `Mentioned ${symptom}: "${segs[0]!.text}"`,
      times: segs.map((x) => x.t),
      why_relevant: 'Patient-reported in the conversation.',
      confidence: 'medium',
      source: 'conversation',
      verification: 'not_checked',
      included: false
    })
  }
  return out.map((a, i) => ({ ...a, id: `a${i + 1}` }))
}
function liveReportBody(s: LiveScribeSession, reviewer: string): string {
  const secs = s.ended_at ? Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000) : 0
  const picked = s.actions.filter((a) => a.included)
  return [
    'Visit scribing report (LiveScribing)',
    `Patient: ${s.patient.name}, MRN ${s.patient.mrn}`,
    `Visit: ${s.started_at.slice(0, 16).replace('T', ' ')} UTC, duration ${clock(secs)}, ${s.windows_analyzed} windows, consent ${s.consent_ref}`,
    '',
    `Possible symptoms (selected by ${reviewer})`,
    ...(picked.length
      ? picked.map((a) => `- ${a.action} [${a.times.join(', ')}] (${a.source}, ${a.confidence} confidence)`)
      : ['- None selected.']),
    '',
    'Visit summary (AI draft)',
    `- ${s.summary ?? 'No summary.'}`,
    '',
    'Conversation',
    `- ${s.transcript.length} transcript lines are stored with LiveScribing session ${s.id}.`
  ].join('\n')
}
function liveView(s: LiveScribeSession): LiveScribeSession {
  return {
    ...s,
    counts: {
      observations: s.observations.length,
      transcript: s.transcript.length,
      actions: s.actions.length
    }
  }
}
function liveSummary(s: LiveScribeSession): LiveScribeSessionSummary {
  const keys = [
    'id',
    'patient_id',
    'patient',
    'consent_ref',
    'started_by_name',
    'started_at',
    'ended_at',
    'end_reason',
    'status',
    'windows_analyzed',
    'summary',
    'counts'
  ] as const
  return Object.fromEntries(keys.map((k) => [k, s[k]])) as unknown as LiveScribeSessionSummary
}
function liveSession(pid: string, sid: string): { session: LiveScribeSession; startedMs: number } {
  const x = state.live.get(sid)
  if (!x || x.session.patient_id !== pid) return fail(404, 'NOT_FOUND', 'LiveScribing session not found.')
  return x
}

/**
 * Mock ingestion worker (spec 11 steps 4-7): consented -> fetched -> merged, derived from the time since
 * consent so no timers run. Called once per request, and the only place that sets state.merged.
 */
function refreshTranscripts(): void {
  const now = Date.now()
  for (const t of state.transcripts) {
    if (t.consented_ms === null || t.status === 'merged' || t.status === 'denied') continue
    const elapsed = now - t.consented_ms
    if (elapsed >= MERGED_AFTER_MS) {
      t.status = 'merged'
      t.resources_imported = RIVERSIDE_RESOURCES[t.patient_id] ?? 0
      t.completed_at = new Date(t.consented_ms + MERGED_AFTER_MS).toISOString()
    } else if (elapsed >= FETCHED_AFTER_MS) {
      t.status = 'fetched'
    }
  }
  state.merged = state.transcripts.some((t) => t.patient_id === IDS.gregory && t.status === 'merged')
}
const toRequest = (t: MockTranscript): TranscriptRequest => ({
  id: t.id,
  patient_id: t.patient_id,
  from_provider: t.from_provider,
  status: t.status,
  consent_ref: t.consent_ref,
  resources_imported: t.resources_imported,
  created_at: t.created_at,
  completed_at: t.completed_at
})
const toTask = (t: MockTranscript): ConsentTask => ({
  ...toRequest(t),
  patient_name: t.patient_name,
  patient_mrn: t.patient_mrn,
  requested_by_name: t.requested_by_name
})
/** Spec 11 step 7: once merged, the physician's "Request Riverside records" task becomes a review task. */
function dashboardView(u: (typeof USERS)[number]): DashboardResponse {
  const merged = state.transcripts.find((t) => t.patient_id === IDS.gregory && t.status === 'merged')
  if (!merged || u.role !== 'physician') return DASHBOARD
  return {
    ...DASHBOARD,
    tasks: DASHBOARD.tasks.map((t) =>
      t.kind === 'review_transcript' && t.patient_id === IDS.gregory
        ? {
            ...t,
            id: 't-review-' + merged.id,
            title: 'Review Riverside records',
            detail: `${merged.resources_imported} records merged from ${merged.from_provider}.`
          }
        : t
    )
  }
}
function patientView(id: string): Patient {
  const p = PATIENTS[id]
  if (!p) return fail(404, 'NOT_FOUND', 'Patient not found.')
  return id === IDS.gregory && state.merged ? { ...p, ...GREGORY_AFTER_MERGE } : p
}

/** Mock records_tree rows, built from the same data the list routes serve; /sources resolves them too. */
interface TreeEntry {
  folder: string
  item: RecordsTreeItem
  kind: CitationKind
  body: string
  provenance: Provenance
}
const TREE_FOLDERS = ['Labs', 'Problems', 'Allergies', 'Notes', 'Pathology']
function treeEntries(pid: string): TreeEntry[] {
  const e = (
    folder: string,
    type: string,
    kind: CitationKind,
    id: string,
    title: string,
    at: string | null,
    provenance: Provenance,
    body = title
  ): TreeEntry => ({
    folder,
    kind,
    body,
    provenance,
    item: { type, id, title, effective_at: at, source_system: provenance.source_system }
  })
  const g = pid === IDS.gregory
  const labs = g
    ? [...GREGORY_LABS_NORTHSIDE, ...(state.merged ? GREGORY_LABS_RIVERSIDE : [])]
    : pid === IDS.linda
      ? LINDA_LABS
      : []
  const notes = g
    ? [...GREGORY_NOTES_NORTHSIDE, ...(state.merged ? GREGORY_NOTES_RIVERSIDE : [])]
    : pid === IDS.linda
      ? LINDA_NOTES
      : []
  const summary = g ? (state.merged ? SUMMARY_AFTER : SUMMARY_BEFORE) : null
  const value = (o: (typeof labs)[number]): string =>
    `${o.value_num ?? o.value_text ?? ''} ${o.unit ?? ''}`.trim()
  return [
    ...labs.map((o) =>
      e('Labs', 'Observation', 'observation', o.id, `${o.display}: ${value(o)}`, o.effective_at, o.provenance)
    ),
    ...(summary?.conditions ?? []).map((c) =>
      e('Problems', 'Condition', 'condition', c.provenance.source_ref, c.display, null, c.provenance)
    ),
    ...(summary?.allergies ?? []).map((a) =>
      e(
        'Allergies',
        'Allergy',
        'allergy',
        a.provenance.source_ref,
        `Allergy: ${a.substance}`,
        null,
        a.provenance
      )
    ),
    ...notes.map((n) => e('Notes', 'Note', 'note', n.id, n.title, n.effective_at, n.provenance, n.body)),
    ...(g && state.analyzed
      ? [
          e(
            'Pathology',
            'Finding',
            'finding',
            state.finding.id,
            `${state.finding.label} (${state.finding.status})`,
            state.finding.reviewed_at,
            state.finding.provenance
          )
        ]
      : [])
  ]
}

export async function mockGateway(
  method: string,
  fullPath: string,
  body: unknown,
  token: string | null
): Promise<unknown> {
  const [path = '', qs = ''] = fullPath.split('?')
  const q = new URLSearchParams(qs)
  const slow = /classify|report$/.test(path)
  await sleep(slow ? 1800 : 250 + Math.random() * 300)
  if (state.failNext) {
    state.failNext = false
    fail(502, 'UPSTREAM_UNAVAILABLE', 'Mock failure (rehearsal). Try again.')
  }
  refreshTranscripts()
  const m = (re: RegExp): RegExpMatchArray | null => path.match(re)
  let r: RegExpMatchArray | null

  // ---- auth
  if (method === 'POST' && path === '/auth/login') {
    const { email, password } = body as { email: string; password: string }
    const u = USERS.find((x) => x.email === email.trim().toLowerCase())
    if (!u || password !== DEMO_PASSWORD) fail(401, 'UNAUTHENTICATED', 'Email or password is incorrect.')
    return {
      access_token: 'mock-token-' + u!.id,
      user: { id: u!.id, full_name: u!.full_name, role: u!.role }
    } satisfies LoginResponse
  }
  const u = userFromToken(token)
  if (method === 'POST' && path === '/auth/refresh') return { access_token: token } // mock tokens never expire

  if (method === 'GET' && path === '/me') {
    return { user_id: u.id, role: u.role, permissions: ROLE_PERMISSIONS[u.role] } satisfies MeResponse
  }
  if (method === 'GET' && path === '/dashboard') {
    if (u.role !== 'physician' && u.role !== 'nurse')
      fail(403, 'FORBIDDEN_ROLE', 'Dashboard is for clinicians.')
    if (u.id === 'u-wu')
      return { attention: [], schedule: [], tasks: [], recent_patients: [], supply_watch: [] }
    return dashboardView(u)
  }
  if (method === 'GET' && path === '/patients') {
    const term = (q.get('q') ?? '').toLowerCase()
    const items = Object.values(PATIENTS)
      .filter(
        (p) =>
          u.care_team === 'all' ||
          (Array.isArray(u.care_team) && u.care_team.includes(p.id)) ||
          p.mrn.toLowerCase() === term // exact MRN finds an off-team patient (name + MRN only)
      )
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.mrn.toLowerCase().includes(term))
      .map(({ id, name, age, sex, mrn }) => ({ id, name, age, sex, mrn }))
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/emergency-access$/)) && method === 'POST') {
    requirePerm(u, 'emergency_access')
    const reason = ((body ?? {}) as { reason?: string }).reason?.trim() ?? ''
    if (reason.length < 5) fail(422, 'VALIDATION_ERROR', 'Type the clinical reason for emergency access.')
    if (!Array.isArray(u.care_team) || u.care_team.includes(r[1]!))
      fail(409, 'CONFLICT', "You are already on this patient's care team.")
    ;(u.care_team as string[]).push(r[1]!) // ponytail: mock grant never expires; the gateway enforces 60 min
    audit(u, 'read', 'emergency_access', PATIENTS[r[1]!]?.name ?? null)
    return { expires_at: new Date(Date.now() + 60 * 60_000).toISOString() }
  }
  if ((r = m(/^\/patients\/([^/]+)$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!)
    return patientView(r[1]!)
  }
  if ((r = m(/^\/patients\/([^/]+)\/summary$/))) {
    requireCareTeam(u, r[1]!, 'summary')
    return r[1] === IDS.gregory
      ? state.merged
        ? SUMMARY_AFTER
        : SUMMARY_BEFORE
      : { ...SUMMARY_BEFORE, conditions: [], new_from_sources: [] }
  }
  if ((r = m(/^\/patients\/([^/]+)\/observations$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!, 'observation')
    requirePerm(u, 'view_labs')
    const all =
      r[1] === IDS.gregory
        ? [...GREGORY_LABS_NORTHSIDE, ...(state.merged ? GREGORY_LABS_RIVERSIDE : [])]
        : r[1] === IDS.linda
          ? LINDA_LABS
          : []
    const category = q.get('category')
    const loinc = q.get('loinc')
    const since = q.get('since')
    const items = all.filter(
      (o) =>
        (!category || o.category === category) &&
        (!loinc || o.loinc_code === loinc) &&
        (!since || (o.effective_at ?? '') >= since)
    )
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/medications$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!, 'medication_request')
    const items =
      r[1] === IDS.gregory
        ? state.merged
          ? GREGORY_MEDS_RIVERSIDE
          : []
        : r[1] === IDS.priya
          ? PRIYA_MEDS
          : []
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/notes$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!, 'note')
    requirePerm(u, 'view_notes')
    const pid = r[1]!
    const seeded =
      pid === IDS.gregory
        ? [...GREGORY_NOTES_NORTHSIDE, ...(state.merged ? GREGORY_NOTES_RIVERSIDE : [])]
        : pid === IDS.linda
          ? LINDA_NOTES
          : []
    // Only physician-approved Scribe notes reach the chart; drafts and discards never do.
    const scribe = [...state.scribe.values()]
      .filter((x) => x.session.patient_id === pid && x.note?.status === 'final')
      .map((x) => x.note!)
    const live = state.liveNotes.filter((x) => x.patient_id === pid).map((x) => x.note)
    const items = [...live, ...scribe, ...seeded].filter((n) => !q.get('kind') || n.kind === q.get('kind'))
    return { items, next_cursor: null }
  }
  // ---- Transcript requests (spec 11): requested -> consented -> fetched -> merged, or requested -> denied
  if ((r = m(/^\/patients\/([^/]+)\/transcripts$/))) {
    const pid = r[1]!
    requireCareTeam(u, pid, method === 'POST' ? 'transcript_request' : null)
    const patient = PATIENTS[pid] ?? fail(404, 'NOT_FOUND', 'Patient not found.')
    const own = state.transcripts.filter((t) => t.patient_id === pid)
    if (method === 'POST') {
      requirePerm(u, 'request_transcripts')
      const { from_provider_id } = (body ?? {}) as { from_provider_id?: string }
      const from =
        TRANSCRIPT_PROVIDERS[from_provider_id ?? ''] ??
        fail(422, 'VALIDATION_ERROR', 'Unknown from_provider_id.')
      // Mock-only demo choice (not a spec rule; spec 11 step 4 allows incremental re-requests after a
      // merge): return the open or merged request instead of a duplicate. A denial allows a new one.
      const latest = own.find((t) => t.from_provider === from)
      if (latest && latest.status !== 'denied') return toRequest(latest)
      const t: MockTranscript = {
        id: uid(),
        patient_id: pid,
        patient_name: patient.name,
        patient_mrn: patient.mrn,
        from_provider: from,
        status: 'requested',
        consent_ref: null,
        resources_imported: 0,
        created_at: new Date().toISOString(),
        completed_at: null,
        requested_by: u.id,
        requested_by_name: u.full_name,
        consented_ms: null
      }
      state.transcripts.unshift(t)
      audit(u, 'request_transcript', 'transcript_request', patient.name)
      return toRequest(t)
    }
    return { items: own.map(toRequest), next_cursor: null } satisfies ListResponse<TranscriptRequest>
  }
  if ((r = m(/^\/transcripts\/([^/]+)\/consent$/)) && method === 'POST') {
    requirePerm(u, 'record_consent')
    const id = r[1]!
    const t =
      state.transcripts.find((x) => x.id === id) ?? fail(404, 'NOT_FOUND', 'Transcript request not found.')
    if (t.status !== 'requested') fail(409, 'CONFLICT', 'This request was already decided.')
    const { consent_ref, granted } = (body ?? {}) as Partial<ConsentDecision>
    const ref = typeof consent_ref === 'string' ? consent_ref.trim() : ''
    // The spec 15 body always carries consent_ref, so a denial needs a reference too.
    if (!ref) fail(422, 'VALIDATION_ERROR', 'A consent reference is required.')
    if (typeof granted !== 'boolean') fail(422, 'VALIDATION_ERROR', 'granted must be true or false.')
    t.consent_ref = ref
    if (granted) {
      t.status = 'consented'
      t.consented_ms = Date.now()
    } else {
      t.status = 'denied'
      t.completed_at = new Date().toISOString()
    }
    audit(u, granted ? 'record_consent' : 'deny_consent', 'transcript_request', t.patient_name)
    return toRequest(t)
  }
  // ---- SPEC-QUESTION: admin consent queue. Mock-only path until Ron + Alessandra define the route.
  if (method === 'GET' && path === '/admin/consent-tasks') {
    requirePerm(u, 'record_consent')
    return { items: state.transcripts.map(toTask), next_cursor: null } satisfies ListResponse<ConsentTask>
  }
  if ((r = m(/^\/patients\/([^/]+)\/findings$/))) {
    requireCareTeam(u, r[1]!, 'finding')
    return { items: r[1] === IDS.gregory && state.analyzed ? [state.finding] : [], next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/records-tree$/))) {
    requireCareTeam(u, r[1]!, 'records_tree')
    requirePerm(u, 'view_labs')
    const entries = treeEntries(r[1]!).sort((a, b) =>
      (b.item.effective_at ?? '').localeCompare(a.item.effective_at ?? '')
    )
    return {
      folders: TREE_FOLDERS.map((name) => ({
        name,
        items: entries.filter((x) => x.folder === name).map((x) => x.item)
      }))
    } satisfies RecordsTree
  }
  if ((r = m(/^\/patients\/([^/]+)\/slides$/))) {
    requireCareTeam(u, r[1]!, 'slide')
    const slide: Slide = {
      id: state.finding.slide_id,
      specimen_id: 'spec-gregory-rul',
      specimen_label: state.finding.specimen_label,
      uploaded_at: state.finding.provenance.ingested_at,
      finding_id: state.analyzed ? state.finding.id : null
    }
    return { items: r[1] === IDS.gregory ? [slide] : [], next_cursor: null }
  }
  if ((r = m(/^\/slides\/([^/]+)\/classify$/)) && method === 'POST') {
    requirePerm(u, 'run_lab_technician')
    audit(u, 'classify', 'slide', 'Gregory Hale', true, { kind: 'lab_tech', ran_on: 'local' })
    state.analyzed = true
    return state.finding
  }
  if ((r = m(/^\/findings\/([^/]+)\/report$/)) && method === 'POST') {
    state.reportGenerated = true
    audit(u, 'draft_report', 'finding', 'Gregory Hale', true, { kind: 'resident', ran_on: 'anthropic_api' })
    return GREGORY_REPORT
  }
  if ((r = m(/^\/findings\/([^/]+)\/review$/)) && method === 'POST') {
    requirePerm(u, 'review_findings')
    const req = body as ReviewRequest
    if (req.action !== 'confirm' && !req.note?.trim()) fail(422, 'VALIDATION_ERROR', 'A note is required.')
    if (state.finding.status !== 'pending_review') fail(409, 'CONFLICT', 'This finding was already reviewed.')
    state.finding = {
      ...state.finding,
      status: ({ confirm: 'confirmed', override: 'overridden', reject: 'rejected' } as const)[req.action],
      final_label:
        req.action === 'override'
          ? (req.final_label ?? null)
          : req.action === 'confirm'
            ? state.finding.label
            : null,
      review_note: req.note ?? null,
      reviewed_by: u.full_name,
      reviewed_at: new Date().toISOString()
    }
    audit(u, 'sign_off', 'finding', 'Gregory Hale')
    return state.finding
  }

  // ---- GET /sources/{id}: citation source lookup
  if ((r = m(/^\/sources\/([^/]+)$/))) {
    const id = decodeURIComponent(r[1]!)
    const rec = SOURCE_RECORDS[id]
    if (rec) {
      audit(u, 'read', rec.citation.kind, 'Gregory Hale')
      return rec
    }
    for (const pid of Object.keys(PATIENTS)) {
      const hit = treeEntries(pid).find((x) => `${x.item.type}:${x.item.id}` === id)
      if (!hit) continue
      requireCareTeam(u, pid, hit.kind)
      return {
        citation: {
          id,
          kind: hit.kind,
          label: hit.item.title,
          object_id: hit.item.id,
          provenance: hit.provenance
        },
        title: hit.item.title,
        body: hit.body,
        recorded_at: hit.item.effective_at ?? hit.provenance.ingested_at
      } satisfies SourceRecord
    }
    fail(404, 'NOT_FOUND', 'Source record not found.')
  }

  // ---- Scribe (spec 10.5)
  if ((r = m(/^\/patients\/([^/]+)\/scribe-sessions$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'start_scribe')
    const { consent_ref } = (body ?? {}) as { consent_ref?: string }
    if (!consent_ref?.trim()) fail(422, 'VALIDATION_ERROR', 'consent_ref is required to start the Scribe.')
    const session: ScribeSession = {
      id: uid(),
      patient_id: r[1]!,
      consent_ref: consent_ref!,
      started_at: new Date().toISOString(),
      ended_at: null,
      end_reason: null,
      windows_analyzed: 0,
      review_status: 'pending'
    }
    state.scribe.set(session.id, { session, windows: 0, startedMs: Date.now(), note: null, obs: [] })
    audit(u, 'scribe_start', 'scribe_session', PATIENTS[r[1]!]?.name ?? null)
    return session
  }
  if ((r = m(/^\/scribe-sessions\/([^/]+)\/window$/)) && method === 'POST') {
    const s = state.scribe.get(r[1]!) ?? fail(404, 'NOT_FOUND', 'Scribe session not found.')
    const i = s.windows++
    s.session.windows_analyzed = s.windows
    const start = Math.floor((Date.now() - s.startedMs) / 1000) - 10
    const script = SCRIBE_SCRIPT[i % SCRIBE_SCRIPT.length] ?? []
    audit(u, 'scribe_window', 'scribe_session', PATIENTS[s.session.patient_id]?.name ?? null, true, {
      kind: 'scribe',
      ran_on: 'local'
    })
    const observations = script.map((o, k) => ({ ...o, t: clock(Math.max(0, start) + 3 + k * 4) }))
    s.obs.push(...observations)
    return {
      session_id: s.session.id,
      window_start: clock(Math.max(0, start)),
      window_end: clock(Math.max(10, start + 10)),
      observations,
      people_in_frame: 1,
      quality_flags: []
    } satisfies ScribeWindow
  }
  if ((r = m(/^\/scribe-sessions\/([^/]+)\/stop$/)) && method === 'POST') {
    const s = state.scribe.get(r[1]!) ?? fail(404, 'NOT_FOUND', 'Scribe session not found.')
    s.session = { ...s.session, ended_at: new Date().toISOString(), end_reason: 'stopped' }
    const secs = Math.round((Date.now() - s.startedMs) / 1000)
    s.note = {
      id: uid(),
      kind: 'visual_scribe',
      title: 'Visit observations (AI draft)',
      author_name: 'Scribe (AI), for ' + u.full_name,
      effective_at: new Date().toISOString(),
      is_legal_record: false,
      status: 'draft',
      body: draftNote(s.obs, secs, s.windows, s.session.consent_ref),
      provenance: {
        source_system: 'asclep',
        source_ref: 'ScribeSession/' + s.session.id,
        ingested_at: new Date().toISOString()
      }
    }
    audit(u, 'scribe_stop', 'scribe_session', PATIENTS[s.session.patient_id]?.name ?? null, true, {
      kind: 'resident',
      ran_on: 'anthropic_api'
    })
    return { session: s.session, note: s.note }
  }
  if ((r = m(/^\/scribe-sessions\/([^/]+)\/review$/)) && method === 'POST') {
    const s = state.scribe.get(r[1]!) ?? fail(404, 'NOT_FOUND', 'Scribe session not found.')
    requirePerm(u, 'review_scribe')
    const req = body as ScribeReviewRequest
    const status = ({ accept: 'accepted', edit: 'edited', discard: 'discarded' } as const)[req.action]
    s.session.review_status = status
    s.note = s.note && {
      ...s.note,
      title: req.action === 'discard' ? s.note.title : 'Visit observations (Scribe)',
      author_name: req.action === 'discard' ? s.note.author_name : 'Scribe (AI), approved by ' + u.full_name,
      body: req.body ?? s.note.body,
      status: req.action === 'discard' ? 'discarded' : 'final'
    }
    audit(u, 'scribe_review', 'note', PATIENTS[s.session.patient_id]?.name ?? null)
    return s.note
  }

  // ---- LiveScribing (camera + conversation). Real gateway: services/api/app/routes/live_scribe.py
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'start_scribe')
    const { consent_ref } = (body ?? {}) as { consent_ref?: string }
    if (!consent_ref?.trim()) fail(422, 'VALIDATION_ERROR', 'consent_ref is required to start LiveScribing.')
    const p = patientView(r[1]!)
    const session: LiveScribeSession = {
      id: uid(),
      patient_id: p.id,
      patient: { id: p.id, mrn: p.mrn, name: p.name, birth_date: '', sex: p.sex },
      consent_ref: consent_ref!.trim(),
      started_by_name: u.full_name,
      started_at: new Date().toISOString(),
      ended_at: null,
      end_reason: null,
      status: 'active',
      windows_analyzed: 0,
      summary: null,
      counts: { observations: 0, transcript: 0, actions: 0 },
      observations: [],
      transcript: [],
      actions: [],
      report: null
    }
    state.live.set(session.id, { session, startedMs: Date.now() })
    audit(u, 'create', 'scribe_session', p.name)
    return liveView(session)
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions$/)) && method === 'GET') {
    const pid = r[1]!
    requireCareTeam(u, pid, null)
    requirePerm(u, 'view_notes')
    const items = [...state.live.values()]
      .map((x) => liveView(x.session))
      .filter((x) => x.patient_id === pid)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map(liveSummary)
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions\/([^/]+)\/window$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'start_scribe')
    const { session: s } = liveSession(r[1]!, r[2]!)
    if (s.status !== 'active') fail(409, 'CONFLICT', 'This LiveScribing session has ended.')
    const form = body as FormData
    const start = String(form.get('window_start') ?? '00:00:00')
    const startS = start.split(':').reduce((acc, x) => acc * 60 + Number(x), 0)
    const i = Math.floor(startS / 10) % SCRIBE_SCRIPT.length
    const observations = (SCRIBE_SCRIPT[i] ?? []).map((o) => ({ ...o, t: clock(startS + 3) }))
    const transcript = (LIVE_TRANSCRIPT_SCRIPT[i] ?? []).map(([a, b, text]) => ({
      t: clock(startS + a),
      end: clock(startS + b),
      text
    }))
    s.observations.push(...observations)
    s.transcript.push(...transcript)
    s.windows_analyzed += 1
    audit(u, 'scribe_window', 'scribe_session', s.patient.name, true, { kind: 'scribe', ran_on: 'local' })
    return {
      session_id: s.id,
      window_start: start,
      window_end: String(form.get('window_end') ?? start),
      observations,
      transcript,
      people_in_frame: 1,
      quality_flags: []
    } satisfies LiveScribeWindow
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions\/([^/]+)\/stop$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'start_scribe')
    const s = liveSession(r[1]!, r[2]!).session
    if (s.status !== 'active') fail(409, 'CONFLICT', 'This LiveScribing session has already stopped.')
    s.ended_at = new Date().toISOString()
    s.end_reason = 'stopped'
    s.status = 'review'
    s.actions = flagActions(s)
    s.summary = `${s.observations.length} visual observations and ${s.transcript.length} transcript lines; ${s.actions.length} possible symptoms flagged for the doctor to review.`
    audit(u, 'scribe_stop', 'scribe_session', s.patient.name, true, { kind: 'resident', ran_on: 'local' })
    return liveView(s)
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions\/([^/]+)$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'view_notes')
    return liveView(liveSession(r[1]!, r[2]!).session)
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions\/([^/]+)\/report$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'review_scribe')
    const s = liveSession(r[1]!, r[2]!).session
    if (s.status !== 'review' && s.status !== 'report_draft')
      fail(409, 'CONFLICT', 'The report can only be built after LiveScribing stops and before sign-off.')
    const ids = new Set((body as { included_action_ids: string[] }).included_action_ids)
    const unknown = [...ids].filter((id) => !s.actions.some((a) => a.id === id))
    if (unknown.length) fail(422, 'VALIDATION_ERROR', `Unknown action ids: ${unknown.join(', ')}.`)
    s.actions = s.actions.map((a) => ({ ...a, included: ids.has(a.id) }))
    s.report = {
      body: liveReportBody(s, u.full_name),
      included_action_ids: s.actions.filter((a) => a.included).map((a) => a.id),
      status: 'draft',
      drafted_by_name: u.full_name,
      drafted_at: new Date().toISOString(),
      reviewed_by_name: null,
      reviewed_at: null
    }
    s.status = 'report_draft'
    audit(u, 'update', 'scribe_session', s.patient.name)
    return liveView(s)
  }
  if ((r = m(/^\/patients\/([^/]+)\/live-scribe-sessions\/([^/]+)\/review$/)) && method === 'POST') {
    requireCareTeam(u, r[1]!, null)
    requirePerm(u, 'review_scribe')
    const s = liveSession(r[1]!, r[2]!).session
    const draft = s.report
    if (s.status !== 'report_draft' || !draft)
      return fail(409, 'CONFLICT', 'There is no report draft to review.')
    const req = body as LiveScribeReviewRequest
    if (req.action === 'edit' && !req.body?.trim())
      fail(422, 'VALIDATION_ERROR', 'An edited report needs a body.')
    const discard = req.action === 'discard'
    const reviewedAt = new Date().toISOString()
    s.report = {
      ...draft,
      body: req.action === 'edit' ? (req.body ?? '').trim() : draft.body,
      status: discard ? 'discarded' : 'final',
      reviewed_by_name: u.full_name,
      reviewed_at: reviewedAt
    }
    s.status = discard ? 'discarded' : 'accepted'
    if (!discard) {
      state.liveNotes.unshift({
        patient_id: s.patient_id,
        note: {
          id: uid(),
          kind: 'visual_scribe',
          title: 'Visit scribing report (LiveScribing)',
          body: s.report.body,
          author_name: 'LiveScribing (AI), approved by ' + u.full_name,
          effective_at: reviewedAt,
          is_legal_record: false,
          status: 'final',
          provenance: {
            source_system: 'asclep',
            source_ref: 'LiveScribeSession/' + s.id,
            ingested_at: reviewedAt
          }
        }
      })
    }
    audit(u, 'sign', 'scribe_session', s.patient.name)
    return liveView(s)
  }

  // ---- Ask
  if (method === 'POST' && path === '/ask') {
    requirePerm(u, 'use_ask')
    audit(u, 'ask', 'conversation', 'Gregory Hale', true, { kind: 'resident', ran_on: 'anthropic_api' })
    const confirmed = state.finding.status === 'confirmed'
    return {
      answer_md: confirmed
        ? 'Gregory has a **confirmed LUAD** finding (reviewed by ' +
          state.finding.reviewed_by +
          ') [[obj:Finding:' +
          CITATIONS['c-finding']!.object_id +
          ']]. Pembrolizumab is **backordered**; restock expected in 6 days. [[obj:InventoryItem:' +
          CITATIONS['c-pembro']!.object_id +
          ']]'
        : 'Gregory has an **unverified** LUAD finding awaiting attending review [[obj:Finding:' +
          CITATIONS['c-finding']!.object_id +
          ']]. Pembrolizumab is **backordered**; restock expected in 6 days. [[obj:InventoryItem:' +
          CITATIONS['c-pembro']!.object_id +
          ']]',
      citations: [CITATIONS['c-finding']!, CITATIONS['c-pembro']!],
      conversation_id: 'conv-1',
      verified: true
    } satisfies AskResponse
  }

  if (method === 'GET' && path === '/audit') {
    const own =
      u.role === 'admin'
        ? state.audit
        : state.audit.filter((a) => a.actor_name === u.full_name || a.on_behalf_of === u.full_name)
    const pid = q.get('patient_id')
    const action = q.get('action')
    const from = q.get('from')
    const to = q.get('to')
    const rows = own.filter(
      (a) =>
        (!pid || a.patient_name === PATIENTS[pid]?.name) &&
        (!action || a.action === action) &&
        (!from || a.at >= from) &&
        (!to || a.at <= to)
    )
    return { items: rows, next_cursor: null }
  }

  return fail(404, 'NOT_FOUND', `Mock has no route for ${method} ${path}`)
}
