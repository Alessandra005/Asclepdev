/**
 * In-memory mock gateway. Mirrors spec section 15 paths, error envelope and RBAC so the UI can be
 * built before the backend exists. Toggle with VITE_USE_MOCKS=true. Delete nothing here when the real
 * gateway lands; it doubles as the fixture source for Vitest.
 */
import { GatewayError } from '../errors'
import type {
  AskResponse,
  AuditRow,
  ErrorCode,
  Finding,
  LoginResponse,
  MeResponse,
  Note,
  Patient,
  ReviewRequest,
  ScribeReviewRequest,
  ScribeObservation,
  ScribeSession,
  ScribeWindow,
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
  LINDA_NOTES,
  PRIYA_MEDS,
  PATIENTS,
  ROLE_PERMISSIONS,
  SCRIBE_SCRIPT,
  SOURCE_RECORDS,
  SUMMARY_AFTER,
  SUMMARY_BEFORE,
  USERS
} from './data'

// ---- mutable demo state (reset on reload)
const state = {
  merged: false,
  transcriptRequestedAt: null as number | null,
  finding: structuredClone(GREGORY_FINDING) as Finding,
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
  /** Set true from the console (window.__asclepMock.failNext = true) to rehearse error states. */
  failNext: false
}
;(globalThis as unknown as { __asclepMock: typeof state }).__asclepMock = state

const MERGE_DELAY_MS = 4000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const fail = (status: number, code: ErrorCode, message: string): never => {
  throw new GatewayError(status, code, message, 'req_mock_' + Math.random().toString(36).slice(2, 7))
}
const uid = (): string => crypto.randomUUID()
const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (s: number): string =>
  `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`

function userFromToken(token: string | null): (typeof USERS)[number] {
  const u = USERS.find((x) => token === 'mock-token-' + x.id)
  if (!u) return fail(401, 'UNAUTHENTICATED', 'Session expired. Sign in again.')
  return u
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

function checkMerge(): void {
  if (
    !state.merged &&
    state.transcriptRequestedAt &&
    Date.now() - state.transcriptRequestedAt > MERGE_DELAY_MS
  ) {
    state.merged = true
  }
}
function patientView(id: string): Patient {
  checkMerge()
  const p = PATIENTS[id]
  if (!p) return fail(404, 'NOT_FOUND', 'Patient not found.')
  return id === IDS.gregory && state.merged ? { ...p, ...GREGORY_AFTER_MERGE } : p
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

  if (method === 'GET' && path === '/me') {
    return { user_id: u.id, role: u.role, permissions: ROLE_PERMISSIONS[u.role] } satisfies MeResponse
  }
  if (method === 'GET' && path === '/dashboard') {
    if (u.role !== 'physician' && u.role !== 'nurse')
      fail(403, 'FORBIDDEN_ROLE', 'Dashboard is for clinicians.')
    if (u.id === 'u-wu')
      return { attention: [], schedule: [], tasks: [], recent_patients: [], supply_watch: [] }
    return DASHBOARD
  }
  if (method === 'GET' && path === '/patients') {
    const term = (q.get('q') ?? '').toLowerCase()
    const items = Object.values(PATIENTS)
      .filter((p) => u.care_team === 'all' || (Array.isArray(u.care_team) && u.care_team.includes(p.id)))
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.mrn.toLowerCase().includes(term))
      .map(({ id, name, age, sex, mrn }) => ({ id, name, age, sex, mrn }))
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!)
    return patientView(r[1]!)
  }
  if ((r = m(/^\/patients\/([^/]+)\/summary$/))) {
    requireCareTeam(u, r[1]!, 'summary')
    checkMerge()
    return r[1] === IDS.gregory
      ? state.merged
        ? SUMMARY_AFTER
        : SUMMARY_BEFORE
      : { ...SUMMARY_BEFORE, conditions: [], new_from_sources: [] }
  }
  if ((r = m(/^\/patients\/([^/]+)\/observations$/)) && method === 'GET') {
    requireCareTeam(u, r[1]!, 'observation')
    requirePerm(u, 'view_labs')
    checkMerge()
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
    checkMerge()
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
    checkMerge()
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
    const items = [...scribe, ...seeded].filter((n) => !q.get('kind') || n.kind === q.get('kind'))
    return { items, next_cursor: null }
  }
  if ((r = m(/^\/patients\/([^/]+)\/transcripts$/))) {
    requireCareTeam(u, r[1]!, method === 'POST' ? 'transcript_request' : null)
    if (method === 'POST') {
      requirePerm(u, 'request_transcripts')
      state.transcriptRequestedAt ??= Date.now()
      audit(u, 'write', 'transcript_request', PATIENTS[r[1]!]?.name ?? null)
    }
    checkMerge()
    const status = state.merged ? 'merged' : state.transcriptRequestedAt ? 'awaiting_consent' : 'none'
    return {
      items: status === 'none' ? [] : [{ id: 'tr-1', from_provider: 'Riverside Family Medicine', status }],
      next_cursor: null
    }
  }
  if ((r = m(/^\/patients\/([^/]+)\/findings$/))) {
    requireCareTeam(u, r[1]!, 'finding')
    return { items: r[1] === IDS.gregory ? [state.finding] : [], next_cursor: null }
  }
  if ((r = m(/^\/slides\/([^/]+)\/classify$/)) && method === 'POST') {
    requirePerm(u, 'run_lab_technician')
    audit(u, 'classify', 'slide', 'Gregory Hale', true, { kind: 'lab_tech', ran_on: 'local' })
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

  // ---- SPEC-QUESTION: source-detail lookup. Mock-only path until Ron defines the real route.
  if ((r = m(/^\/__mock\/sources\/([^/]+)$/))) {
    const rec = SOURCE_RECORDS[r[1]!]
    if (!rec) fail(404, 'NOT_FOUND', 'Source record not found.')
    audit(u, 'read', rec!.citation.kind, 'Gregory Hale')
    return rec
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

  // ---- Ask
  if (method === 'POST' && path === '/ask') {
    requirePerm(u, 'use_ask')
    audit(u, 'ask', 'conversation', 'Gregory Hale', true, { kind: 'resident', ran_on: 'anthropic_api' })
    const confirmed = state.finding.status === 'confirmed'
    return {
      answer_md: confirmed
        ? 'Gregory has a **confirmed LUAD** finding (reviewed by ' +
          state.finding.reviewed_by +
          '). Pembrolizumab is **backordered**; restock expected in 6 days.'
        : 'Gregory has an **unverified** LUAD finding awaiting attending review. Pembrolizumab is **backordered**; restock expected in 6 days.',
      citations: [CITATIONS['c-finding']!, CITATIONS['c-pembro']!],
      conversation_id: 'conv-1'
    } satisfies AskResponse
  }

  if (method === 'GET' && path === '/audit') {
    const rows =
      u.role === 'admin'
        ? state.audit
        : state.audit.filter((a) => a.actor_name === u.full_name || a.on_behalf_of === u.full_name)
    return { items: rows, next_cursor: null }
  }

  return fail(404, 'NOT_FOUND', `Mock has no route for ${method} ${path}`)
}
