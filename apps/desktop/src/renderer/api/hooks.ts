/** Every server call goes through a TanStack Query hook here (spec 18.3). Keys are scoped by user. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gateway, gatewayFile, GatewayError } from './client'
import { useSession } from '@/state/session'
import type {
  AskResponse,
  AuditRow,
  ConsentDecision,
  ConsentTask,
  DashboardResponse,
  Finding,
  ListResponse,
  LiveScribeReviewRequest,
  LiveScribeSession,
  LiveScribeSessionSummary,
  LiveScribeWindow,
  MedicationRequest,
  LoginResponse,
  MeResponse,
  Note,
  Observation,
  Patient,
  PatientListItem,
  PatientSummary,
  RecordsTree,
  Report,
  ReviewRequest,
  ScribeReviewRequest,
  ScribeSession,
  ScribeStopResponse,
  ScribeWindow,
  Slide,
  SourceRecord,
  TranscriptRequest,
  TranscriptStatus
} from './types'

const LONG = 120_000 // spec 15: classify/report are synchronous with a 120 s timeout

function useUserKey(): string {
  return useSession((s) => s.user?.id ?? 'anon')
}

export const login = (email: string, password: string): Promise<LoginResponse> =>
  gateway<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } })

export const useMe = (enabled: boolean) => {
  const k = useUserKey()
  return useQuery({ queryKey: [k, 'me'], queryFn: () => gateway<MeResponse>('/me'), enabled })
}

export const useDashboard = () => {
  const k = useUserKey()
  return useQuery({ queryKey: [k, 'dashboard'], queryFn: () => gateway<DashboardResponse>('/dashboard') })
}

export const usePatientSearch = (q: string) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patients', q],
    queryFn: () => gateway<ListResponse<PatientListItem>>('/patients', { query: { q: q || undefined } }),
    placeholderData: keepPreviousData
  })
}

export const usePatient = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id],
    queryFn: () => gateway<Patient>(`/patients/${id}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof GatewayError && e.status < 500) && n < 2
  })
}

/** Break-the-glass (spec 13): 60 minutes of access. Refetch the chart only after the gateway grants it. */
export const useEmergencyAccess = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    mutationFn: (reason: string) =>
      gateway<{ expires_at: string }>(`/patients/${patientId}/emergency-access`, {
        method: 'POST',
        body: { reason }
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'patient', patientId] })
  })
}

export const usePatientSummary = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'summary'],
    queryFn: () => gateway<PatientSummary>(`/patients/${id}/summary`),
    enabled: !!id
  })
}

/** Follows next_cursor (spec 15 list convention) so the latest value per LOINC is never cut off. */
export const usePatientObservations = (id: string | null, category: Observation['category']) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'observations', category],
    queryFn: async () => {
      const items: Observation[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const res = await gateway<ListResponse<Observation>>(`/patients/${id}/observations`, {
          query: { category, cursor }
        })
        items.push(...res.items)
        if (!res.next_cursor) break
        cursor = res.next_cursor
      }
      return items
    },
    enabled: !!id
  })
}

export const usePatientMedications = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'medications'],
    queryFn: () => gateway<ListResponse<MedicationRequest>>(`/patients/${id}/medications`),
    enabled: !!id
  })
}

export const usePatientNotes = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'notes'],
    queryFn: () => gateway<ListResponse<Note>>(`/patients/${id}/notes`),
    enabled: !!id
  })
}

/** Statuses the ingestion worker is still moving (spec 11): keep polling until merged or denied. */
const IN_FLIGHT: TranscriptStatus[] = ['requested', 'consented', 'fetched']
export const useTranscripts = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'transcripts'],
    queryFn: () => gateway<ListResponse<TranscriptRequest>>(`/patients/${id}/transcripts`),
    enabled: !!id,
    // Poll while a request waits on admin consent or is importing; stop once merged or denied.
    refetchInterval: (q) => (q.state.data?.items.some((t) => IN_FLIGHT.includes(t.status)) ? 2000 : false)
  })
}

export const useRequestTranscript = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    // SPEC-QUESTION: from_provider_id for Riverside comes from a provider list the spec does not expose yet.
    mutationFn: () =>
      gateway<TranscriptRequest>(`/patients/${patientId}/transcripts`, {
        method: 'POST',
        body: { from_provider_id: 'riverside' }
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'transcripts'] })
  })
}

/** Spec 11 step 2's "task for the admin": GET /admin/consent-tasks (services/api/app/routes/transcripts.py). */
export const useConsentTasks = () => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'consent-tasks'],
    queryFn: () => gateway<ListResponse<ConsentTask>>('/admin/consent-tasks'),
    // Requests made under another login (the physician's window) show up without a reload.
    refetchInterval: 3000
  })
}

/** POST /transcripts/{id}/consent (admin only). Record consent or deny; both carry a consent_ref. */
export const useRecordConsent = () => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: ConsentDecision }) =>
      gateway<TranscriptRequest>(`/transcripts/${requestId}/consent`, { method: 'POST', body: decision }),
    // The queue changes only after the gateway confirms: no optimistic update.
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'consent-tasks'] })
  })
}

export const useFindings = (patientId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', patientId, 'findings'],
    queryFn: () => gateway<ListResponse<Finding>>(`/patients/${patientId}/findings`),
    enabled: !!patientId
  })
}

export const useRecordsTree = (patientId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', patientId, 'records-tree'],
    queryFn: () => gateway<RecordsTree>(`/patients/${patientId}/records-tree`),
    enabled: !!patientId
  })
}

export const useSlides = (patientId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', patientId, 'slides'],
    queryFn: () => gateway<ListResponse<Slide>>(`/patients/${patientId}/slides`),
    enabled: !!patientId
  })
}

/** Heatmap / thumbnail / tile image from the Lab Technician. Cached as a Blob, cleared with the cache on logout. */
export const useFileBlob = (url: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'file', url],
    queryFn: () => gatewayFile(url!),
    enabled: !!url,
    staleTime: Infinity,
    retry: false
  })
}

export const useClassify = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    mutationFn: (slideId: string) =>
      gateway<Finding>(`/slides/${slideId}/classify`, { method: 'POST', timeoutMs: LONG }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'findings'] }),
        qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'slides'] })
      ])
  })
}

export const useDraftReport = () =>
  useMutation({
    mutationFn: (findingId: string) =>
      gateway<Report>(`/findings/${findingId}/report`, { method: 'POST', timeoutMs: LONG })
  })

export const useReviewFinding = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    mutationFn: ({ findingId, req }: { findingId: string; req: ReviewRequest }) =>
      gateway<Finding>(`/findings/${findingId}/review`, { method: 'POST', body: req }),
    // Status changes only after the gateway confirms (kickoff p.4): no optimistic update.
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'findings'] })
  })
}

/** GET /sources/{id}: the record a citation chip points to. Ids are '<Type>:<uuid>'. */
export const useSourceRecord = (citationId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'source', citationId],
    queryFn: () => gateway<SourceRecord>(`/sources/${encodeURIComponent(citationId!)}`),
    enabled: !!citationId
  })
}

export const useAsk = () =>
  useMutation({
    mutationFn: (req: { question: string; patient_id?: string }) =>
      gateway<AskResponse>('/ask', { method: 'POST', body: req, timeoutMs: LONG })
  })

/** Server-side filters from spec 15 (GET /audit: user_id, patient_id, action, from, to). */
export interface AuditQuery {
  patient_id?: string
  action?: string
  from?: string
  to?: string
}
export const useAudit = (filters: AuditQuery = {}) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'audit', filters],
    queryFn: () => gateway<ListResponse<AuditRow>>('/audit', { query: { ...filters } }),
    refetchInterval: 5000,
    placeholderData: keepPreviousData
  })
}

// ---- Scribe
export const scribeApi = {
  start: (patientId: string, consent_ref: string) =>
    gateway<ScribeSession>(`/patients/${patientId}/scribe-sessions`, {
      method: 'POST',
      body: { consent_ref }
    }),
  window: (sessionId: string, frames: Blob[]) => {
    const form = new FormData()
    frames.forEach((f, i) => form.append('frames', f, `frame_${i}.jpg`))
    return gateway<ScribeWindow>(`/scribe-sessions/${sessionId}/window`, { method: 'POST', form })
  },
  stop: (sessionId: string) =>
    gateway<ScribeStopResponse>(`/scribe-sessions/${sessionId}/stop`, { method: 'POST', timeoutMs: LONG }),
  review: (sessionId: string, req: ScribeReviewRequest) =>
    gateway<Note>(`/scribe-sessions/${sessionId}/review`, { method: 'POST', body: req })
}

// ---- LiveScribing (camera + conversation; stored in MongoDB by the gateway)
const liveBase = (patientId: string): string => `/patients/${patientId}/live-scribe-sessions`

export interface LiveScribeWindowInput {
  start: string
  end: string
  frames: Blob[]
  /** Session time each frame was taken, HH:MM:SS; observations are stamped with these. */
  frameTimes: string[]
  audio: Blob | null
}

export const liveScribeApi = {
  start: (patientId: string, consent_ref: string) =>
    gateway<LiveScribeSession>(liveBase(patientId), { method: 'POST', body: { consent_ref } }),
  window: (patientId: string, sessionId: string, w: LiveScribeWindowInput) => {
    // Frames and audio go out in memory only; nothing is written to disk (privacy rule 2).
    const form = new FormData()
    form.append('window_start', w.start)
    form.append('window_end', w.end)
    w.frames.forEach((f, i) => form.append('frames', f, `frame_${i}.jpg`))
    if (w.frameTimes.length) form.append('frame_times', w.frameTimes.join(','))
    if (w.audio) form.append('audio', w.audio, 'audio.webm')
    return gateway<LiveScribeWindow>(`${liveBase(patientId)}/${sessionId}/window`, {
      method: 'POST',
      form,
      timeoutMs: LONG
    })
  },
  stop: (patientId: string, sessionId: string) =>
    gateway<LiveScribeSession>(`${liveBase(patientId)}/${sessionId}/stop`, {
      method: 'POST',
      timeoutMs: LONG
    }),
  get: (patientId: string, sessionId: string) =>
    gateway<LiveScribeSession>(`${liveBase(patientId)}/${sessionId}`),
  report: (patientId: string, sessionId: string, includedActionIds: string[]) =>
    gateway<LiveScribeSession>(`${liveBase(patientId)}/${sessionId}/report`, {
      method: 'POST',
      body: { included_action_ids: includedActionIds }
    }),
  review: (patientId: string, sessionId: string, req: LiveScribeReviewRequest) =>
    gateway<LiveScribeSession>(`${liveBase(patientId)}/${sessionId}/review`, { method: 'POST', body: req })
}

export const useLiveScribeSessions = (patientId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', patientId, 'live-scribe'],
    queryFn: () => gateway<ListResponse<LiveScribeSessionSummary>>(liveBase(patientId!)),
    enabled: !!patientId
  })
}
