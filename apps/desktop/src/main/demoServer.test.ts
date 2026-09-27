// @vitest-environment node
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IDS } from '../renderer/api/mock/data'
import { createDemoServer } from './demoServer'

let server: Server
let base = ''

beforeAll(async () => {
  server = createDemoServer(0)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/demo`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  })
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, unknown> }
}
const signIn = async (email: string): Promise<string> =>
  (await call('/auth/login', { method: 'POST', body: { email, password: 'asclep-demo' } })).json[
    'access_token'
  ] as string

describe('shared demo server', () => {
  it('answers ping without auth and allows cross-origin calls', async () => {
    const ping = await call('/ping')
    expect(ping.status).toBe(200)
    expect(ping.json['ok']).toBe(true)
    expect(ping.headers.get('access-control-allow-origin')).toBe('*')
    const pre = await fetch(base + '/me', { method: 'OPTIONS' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization')
  })

  it('returns the gateway error envelope with its status', async () => {
    const res = await call('/me')
    expect(res.status).toBe(401)
    expect(res.json['error']).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect((await fetch(base.replace('/demo', '/other'))).status).toBe(404)
  })

  it('shares one copy of the data between users: a request by Dr. Reyes reaches the admin', async () => {
    const reyes = await signIn('reyes@asclep.demo')
    const admin = await signIn('admin@asclep.demo')
    expect((await call('/me', { token: reyes })).json['user_id']).toBe('u-reyes')

    const req = await call(`/patients/${IDS.gregory}/transcripts`, {
      method: 'POST',
      token: reyes,
      body: { from_provider_id: 'riverside' }
    })
    expect(req.status).toBe(200)
    expect(req.json['status']).toBe('requested')

    const queue = await call('/admin/consent-tasks', { token: admin })
    const items = queue.json['items'] as { id: string; patient_name: string; status: string }[]
    expect(items.some((t) => t.id === req.json['id'] && t.patient_name === 'Gregory Hale')).toBe(true)

    // Only the admin may decide; the physician is refused by the same RBAC as the in-app mock.
    const denied = await call(`/transcripts/${String(req.json['id'])}/consent`, {
      method: 'POST',
      token: reyes,
      body: { consent_ref: 'Signed form #2231', granted: true }
    })
    expect(denied.status).toBe(403)
    const ok = await call(`/transcripts/${String(req.json['id'])}/consent`, {
      method: 'POST',
      token: admin,
      body: { consent_ref: 'Signed form #2231', granted: true }
    })
    expect(ok.json['status']).toBe('consented')
  }, 20_000)
})
