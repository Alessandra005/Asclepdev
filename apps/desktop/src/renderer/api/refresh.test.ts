import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '@/state/session'

const gateway = vi.fn()
vi.mock('./client', () => ({ gateway: (...a: unknown[]) => gateway(...a) }))
const { refreshIfExpiring, tokenExpiry } = await import('./refresh')

const jwt = (expSec: number): string => `h.${btoa(JSON.stringify({ exp: expSec }))}.s`
const NOW = 1_800_000_000_000
const user = { id: 'u1', full_name: 'Dr. Maya Reyes', role: 'physician' as const }

describe('token refresh', () => {
  beforeEach(() => {
    gateway.mockReset().mockResolvedValue({ access_token: 'fresh' })
    useSession.getState().signOut()
  })

  it('reads exp from a JWT and ignores mock tokens', () => {
    expect(tokenExpiry(jwt(100))).toBe(100_000)
    expect(tokenExpiry('mock-token-u-reyes')).toBeNull()
  })

  it('leaves a token with more than 5 minutes left alone', async () => {
    useSession.getState().signIn(jwt(NOW / 1000 + 10 * 60), user)
    await refreshIfExpiring(NOW)
    expect(gateway).not.toHaveBeenCalled()
  })

  it('swaps in a fresh token when under 5 minutes are left', async () => {
    useSession.getState().signIn(jwt(NOW / 1000 + 2 * 60), user)
    await refreshIfExpiring(NOW)
    expect(gateway).toHaveBeenCalledWith('/auth/refresh', { method: 'POST' })
    expect(useSession.getState().token).toBe('fresh')
  })

  it('drops the refreshed token if the user signed out meanwhile', async () => {
    useSession.getState().signIn(jwt(NOW / 1000 + 60), user)
    const p = refreshIfExpiring(NOW)
    useSession.getState().signOut()
    await p
    expect(useSession.getState().token).toBeNull()
  })
})
