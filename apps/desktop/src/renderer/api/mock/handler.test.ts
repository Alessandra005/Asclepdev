import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsentTask, ListResponse, Patient, PatientSummary, TranscriptRequest } from '../types'
import { IDS } from './data'

const REYES = 'mock-token-u-reyes'
const ADMIN = 'mock-token-u-admin'
const T0 = new Date('2026-09-26T09:00:00Z').getTime()

type Gateway = (method: string, path: string, body: unknown, token: string | null) => Promise<unknown>

/** Mock state is module-level; a fresh import gives each test its own demo. */
async function freshGateway() {
  vi.resetModules()
  const gw: Gateway = (await import('./handler')).mockGateway
  return {
    request: (token = REYES) =>
      gw(
        'POST',
        `/patients/${IDS.gregory}/transcripts`,
        { from_provider_id: 'riverside' },
        token
      ) as Promise<TranscriptRequest>,
    list: () =>
      gw('GET', `/patients/${IDS.gregory}/transcripts`, undefined, REYES) as Promise<
        ListResponse<TranscriptRequest>
      >,
    queue: () =>
      gw('GET', '/__mock/admin/consent-tasks', undefined, ADMIN) as Promise<ListResponse<ConsentTask>>,
    decide: (id: string, consent_ref: string, granted: boolean, token = ADMIN) =>
      gw('POST', `/transcripts/${id}/consent`, { consent_ref, granted }, token) as Promise<TranscriptRequest>,
    summary: () => gw('GET', `/patients/${IDS.gregory}/summary`, undefined, REYES) as Promise<PatientSummary>,
    patient: () => gw('GET', `/patients/${IDS.gregory}`, undefined, REYES) as Promise<Patient>
  }
}

// mockGateway sleeps with the real setTimeout, so only Date is faked.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('mock transcript lifecycle (spec 11)', () => {
  it('requested -> consented -> fetched -> merged, admin only, then Gregory has new history', async () => {
    const gw = await freshGateway()
    const first = await gw.request()
    expect(first).toMatchObject({
      status: 'requested',
      from_provider: 'Riverside Family Medicine',
      consent_ref: null
    })
    expect((await gw.request()).id).toBe(first.id)

    const queue = await gw.queue()
    expect(queue.items).toHaveLength(1)
    expect(queue.items[0]).toMatchObject({
      id: first.id,
      patient_name: 'Gregory Hale',
      patient_mrn: 'NS-004417',
      requested_by_name: 'Dr. Maya Reyes'
    })

    await expect(gw.decide(first.id, 'Signed form #2231', true, REYES)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_ROLE'
    })
    await expect(gw.decide(first.id, '   ', true)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR'
    })
    await expect(gw.decide('missing', 'Signed form #2231', true)).rejects.toMatchObject({ status: 404 })

    const consented = await gw.decide(first.id, '  Signed form #2231 ', true)
    expect(consented).toMatchObject({
      status: 'consented',
      consent_ref: 'Signed form #2231',
      completed_at: null
    })
    expect((await gw.summary()).new_from_sources).toHaveLength(0)

    vi.setSystemTime(T0 + 2000)
    expect((await gw.list()).items[0]!.status).toBe('fetched')

    vi.setSystemTime(T0 + 4000)
    const merged = (await gw.list()).items[0]!
    expect(merged).toMatchObject({ status: 'merged', resources_imported: 214 })
    expect(merged.completed_at).not.toBeNull()
    expect((await gw.summary()).new_from_sources.length).toBeGreaterThan(0)
    expect((await gw.patient()).allergy_status).toBe('recorded')

    await expect(gw.decide(first.id, 'Signed form #2231', true)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT'
    })
    expect((await gw.request()).id).toBe(first.id)
  }, 30_000)

  it('a denial closes the request without merging, and a new request is allowed after', async () => {
    const gw = await freshGateway()
    const first = await gw.request()
    const denied = await gw.decide(first.id, 'Patient declined by phone', false)
    expect(denied).toMatchObject({ status: 'denied', consent_ref: 'Patient declined by phone' })
    expect(denied.completed_at).not.toBeNull()

    vi.setSystemTime(T0 + 10_000)
    expect((await gw.summary()).new_from_sources).toHaveLength(0)
    expect((await gw.patient()).allergy_status).toBe('unknown')

    const again = await gw.request()
    expect(again.id).not.toBe(first.id)
    expect(again.status).toBe('requested')
    expect((await gw.list()).items.map((t) => t.status)).toEqual(['requested', 'denied'])
  }, 30_000)
})
