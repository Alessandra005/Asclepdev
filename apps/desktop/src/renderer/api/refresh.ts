import { gateway } from './client'
import { useSession } from '@/state/session'

const REFRESH_WITHIN_MS = 5 * 60_000 // tokens live 15 min from issue (spec 13)

/** A JWT's exp in ms, or null for mock tokens and anything malformed. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const { exp } = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

let inFlight: Promise<void> | null = null

/**
 * Spec 13: 15 minutes of inactivity signs you out. Call this on user input only, never on a timer or
 * from polling queries, so an idle session still expires. Refreshes once the token has under 5 min left.
 */
export function refreshIfExpiring(now = Date.now()): Promise<void> | null {
  const token = useSession.getState().token
  const exp = token ? tokenExpiry(token) : null
  if (inFlight || !token || exp === null || exp - now > REFRESH_WITHIN_MS) return inFlight
  inFlight = gateway<{ access_token: string }>('/auth/refresh', { method: 'POST' })
    .then((r) => {
      // Ignore the answer if the user signed out (or switched) while it was in flight.
      if (useSession.getState().token === token) useSession.getState().setToken(r.access_token)
    })
    .catch(() => {}) // keep the old token; when it expires, the next 401 signs out as usual
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
