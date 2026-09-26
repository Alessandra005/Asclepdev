import { describe, expect, it } from 'vitest'
import { matchesRoute } from './client'

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
