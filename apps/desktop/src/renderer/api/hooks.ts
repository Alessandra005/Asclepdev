/** Every server call goes through a TanStack Query hook here (spec 18.3). Keys are scoped by user. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gateway, USE_MOCKS, GatewayError } from './client'
import { useSession } from '@/state/session'
import type {
  AskResponse,
  AuditRow,
  Citation,
  DashboardResponse,
  Finding,
  ListResponse,
  MedicationRequest,
  LoginResponse,
  MeResponse,
  Note,
  Observation,
  Patient,
  PatientListItem,
  PatientSummary,
  Report,
  ReviewRequest,
  ScribeReviewRequest,
  ScribeSession,
  ScribeStopResponse,
  ScribeWindow,
  SourceRecord
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

type TranscriptStatus = { id: string; from_provider: string; status: 'awaiting_consent' | 'merged' }
export const useTranscripts = (id: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'patient', id, 'transcripts'],
    queryFn: () => gateway<ListResponse<TranscriptStatus>>(`/patients/${id}/transcripts`),
    enabled: !!id,
    // Poll only while waiting on admin consent; stop once merged.
    refetchInterval: (q) => (q.state.data?.items.some((t) => t.status === 'awaiting_consent') ? 2000 : false)
  })
}

export const useRequestTranscript = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    // SPEC-QUESTION: from_provider_id for Riverside comes from a provider list the spec does not expose yet.
    mutationFn: () =>
      gateway(`/patients/${patientId}/transcripts`, {
        method: 'POST',
        body: { from_provider_id: 'riverside' }
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'transcripts'] })
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

export const useClassify = (patientId: string) => {
  const qc = useQueryClient()
  const k = useUserKey()
  return useMutation({
    mutationFn: (slideId: string) =>
      gateway<Finding>(`/slides/${slideId}/classify`, { method: 'POST', timeoutMs: LONG }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [k, 'patient', patientId, 'findings'] })
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

/**
 * SPEC-QUESTION: the spec has no public source-detail route. Mocks use /__mock/sources/{id}.
 * Replace `sourcePath` once Ron + Alessandra agree on the contract. Do not guess a route.
 */
const sourcePath = (c: Pick<Citation, 'id'>): string | null => (USE_MOCKS ? `/__mock/sources/${c.id}` : null)
export const useSourceRecord = (citationId: string | null) => {
  const k = useUserKey()
  return useQuery({
    queryKey: [k, 'source', citationId],
    queryFn: () => {
      const p = citationId ? sourcePath({ id: citationId }) : null
      if (!p) throw new GatewayError(501, 'NOT_FOUND', 'Source lookup is not wired to the gateway yet.', null)
      return gateway<SourceRecord>(p)
    },
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
