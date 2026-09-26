import type { ErrorEnvelope } from './types'
import { GatewayError } from './errors'
import { mockGateway } from './mock/handler'

export { GatewayError }

const BASE = `${import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8000'}/api/v1`
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/**
 * Mixed mode: with mocks on, paths matching VITE_LIVE_ROUTES go to the real gateway, so endpoints can
 * go live one at a time. Comma-separated, `*` matches one segment: "/auth/login,/me,/patients/*".
 */
const LIVE_ROUTES = (import.meta.env.VITE_LIVE_ROUTES ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)

export function matchesRoute(path: string, patterns: string[]): boolean {
  const segs = (path.split('?')[0] ?? '').split('/')
  return patterns.some((p) => {
    const ps = p.split('/')
    return ps.length === segs.length && ps.every((x, i) => x === '*' || x === segs[i])
  })
}

/** True when this path is served by the in-memory mock gateway. */
export const isMocked = (path: string): boolean => USE_MOCKS && !matchesRoute(path, LIVE_ROUTES)

type TokenGetter = () => string | null
type UnauthorizedHandler = () => void
let getToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

/** Wired once from the session store so the client stays framework-free. */
export function configureClient(opts: { getToken: TokenGetter; onUnauthorized: UnauthorizedHandler }): void {
  getToken = opts.getToken
  onUnauthorized = opts.onUnauthorized
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
  form?: FormData
  query?: Record<string, string | undefined>
  timeoutMs?: number
  signal?: AbortSignal
}

/** The only way the renderer talks to the backend. Same signature for mocks and the real gateway. */
export async function gateway<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, query, timeoutMs = 30_000 } = opts
  const qs = query
    ? '?' +
      new URLSearchParams(
        Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined)
      ).toString()
    : ''

  if (isMocked(path)) {
    try {
      return (await mockGateway(method, path + qs, body ?? form, getToken())) as T
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) onUnauthorized()
      throw e
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  opts.signal?.addEventListener('abort', () => controller.abort())
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(BASE + path + qs, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal
    })
  } catch {
    throw new GatewayError(0, 'UPSTREAM_UNAVAILABLE', 'Cannot reach the Asclep gateway.', null)
  } finally {
    clearTimeout(timer)
  }

  const requestId = res.headers.get('X-Request-Id')
  if (!res.ok) {
    let env: ErrorEnvelope | null = null
    try {
      env = (await res.json()) as ErrorEnvelope
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401) onUnauthorized()
    throw new GatewayError(
      res.status,
      env?.error.code ?? 'INTERNAL',
      env?.error.message ?? `Request failed (${res.status})`,
      env?.error.request_id ?? requestId
    )
  }
  return (await res.json()) as T
}
