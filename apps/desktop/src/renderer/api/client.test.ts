import { describe, expect, it, vi } from 'vitest'
import {
  configureClient,
  gateway,
  getDemoServer,
  matchesRoute,
  normalizeDemoUrl,
  setDemoServer
} from './client'

describe('matchesRoute (VITE_LIVE_ROUTES)', () => {
  const live = ['/auth/login', '/me', '/patients', '/patients/*', '/patients/*/summary']

  it('matches exact paths and one-segment wildcards, ignoring the query string', () => {
    expect(matchesRoute('/auth/login', live)).toBe(true)
    expect(matchesRoute('/patients?q=greg', live)).toBe(true)
    expect(matchesRoute('/patients/6f1c/summary', live)).toBe(true)
  })

  it('keeps everything else on mocks', () => {
    expect(matchesRoute('/patients/6f1c/observations', live)).toBe(false)
    expect(matchesRoute('/dashboard', live)).toBe(false)
    expect(matchesRoute('/me', [])).toBe(false)
  })
})

describe('shared demo server routing', () => {
  it('normalizes what people type as a host address', () => {
    expect(normalizeDemoUrl('192.168.1.20')).toBe('http://192.168.1.20:8787')
    expect(normalizeDemoUrl(' http://10.0.0.5:9000/ ')).toBe('http://10.0.0.5:9000')
    expect(normalizeDemoUrl('localhost')).toBe('http://localhost:8787')
    expect(normalizeDemoUrl('   ')).toBeNull()
  })

  it('sends mocked calls to the shared server with the token, and maps its error envelope', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'FORBIDDEN_ROLE', message: 'No.', request_id: 'req_1' } }),
          { status: 403 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    configureClient({ getToken: () => 'mock-token-u-reyes', onUnauthorized: () => {} })
    setDemoServer('localhost:8799')
    try {
      await expect(
        gateway('/transcripts/t1/consent', { method: 'POST', body: { granted: true } })
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN_ROLE',
        requestId: 'req_1'
      })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://localhost:8799/demo/transcripts/t1/consent')
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-token-u-reyes')
      expect(getDemoServer()).toBe('http://localhost:8799')
    } finally {
      setDemoServer(null)
      vi.unstubAllGlobals()
    }
    expect(getDemoServer()).toBeNull()
  })
})
