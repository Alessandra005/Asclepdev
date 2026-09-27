import type { ErrorEnvelope } from './types'
import { GatewayError } from './errors'
import { mockGateway } from './mock/handler'

export { GatewayError }

const ORIGIN = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8000'
const BASE = `${ORIGIN}/api/v1`
/** Mock gateway unless VITE_USE_MOCKS=false, so a fresh clone (no .env) runs with `pnpm dev`. */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'

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

/**
 * Shared demo server (src/main/demoServer.ts): when set, mocked calls go over HTTP to the host's copy
 * of the mock data, so several users on different windows or laptops see the same requests and
 * consents. null = this app's own in-memory mock. Saved per computer: '' in storage means "chosen:
 * this computer only"; nothing saved falls back to VITE_DEMO_SERVER (set by `pnpm demo:host`).
 */
const DEMO_KEY = 'asclep.demoServer'
export const DEFAULT_DEMO_PORT = 8787

/** "192.168.1.20" -> "http://192.168.1.20:8787". null if blank or not a URL. */
export function normalizeDemoUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '')
  if (!t) return null
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `http://${t}`)
    // Plain http is the host app itself (port 8787 unless given). An https link is a tunnel to it
    // (e.g. cloudflared, for teammates on other networks) and keeps its own port.
    if (u.protocol === 'http:' && !u.port) return `http://${u.hostname}:${DEFAULT_DEMO_PORT}`
    return u.origin
  } catch {
    return null
  }
}

function initialDemoServer(): string | null {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(DEMO_KEY)
  } catch {
    /* storage unavailable: use the default */
  }
  if (saved !== null) return normalizeDemoUrl(saved)
  return normalizeDemoUrl(import.meta.env.VITE_DEMO_SERVER ?? '')
}
let demoServer: string | null = initialDemoServer()

export const getDemoServer = (): string | null => demoServer
export function setDemoServer(url: string | null): void {
  demoServer = url === null ? null : normalizeDemoUrl(url)
  try {
    localStorage.setItem(DEMO_KEY, demoServer ?? '')
  } catch {
    /* not persisted; still applies for this session */
  }
}

export interface DemoPing {
  ok: true
  host: string
  urls: string[]
}
/** Checks a shared demo server is reachable before switching to it. */
export async function pingDemoServer(url: string, timeoutMs = 4000): Promise<DemoPing> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}/demo/ping`, { signal: controller.signal })
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()) as DemoPing
  } catch {
    throw new GatewayError(0, 'UPSTREAM_UNAVAILABLE', `No Asclep demo server answered at ${url}.`, null)
  } finally {
    clearTimeout(timer)
  }
}

/** The only way the renderer talks to the backend. Same signature for mocks and the real gateway. */
export async function gateway<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, query } = opts
  const qs = query
    ? '?' +
      new URLSearchParams(
        Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined)
      ).toString()
    : ''

  if (isMocked(path)) {
    if (demoServer) {
      return send<T>(
        `${demoServer}/demo${path}${qs}`,
        opts,
        `Cannot reach the shared demo server at ${demoServer}.`
      )
    }
    try {
      return (await mockGateway(method, path + qs, body ?? form, getToken())) as T
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) onUnauthorized()
      throw e
    }
  }
  return send<T>(BASE + path + qs, opts, 'Cannot reach the Asclep gateway.')
}

/** HTTP transport for the real gateway and the shared demo server (same error envelope). */
async function send<T>(url: string, opts: RequestOptions, unreachable: string): Promise<T> {
  const { method = 'GET', body, form, timeoutMs = 30_000 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  opts.signal?.addEventListener('abort', () => controller.abort())
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal
    })
  } catch {
    throw new GatewayError(0, 'UPSTREAM_UNAVAILABLE', unreachable, null)
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

/**
 * GET a gateway file URL as it appears in a Finding (`/api/v1/files/...`). /files is care-team only
 * (spec 15), so it needs the bearer token, and a bare <img src> would not send it.
 */
export async function gatewayFile(url: string): Promise<Blob> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(ORIGIN + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new GatewayError(0, 'UPSTREAM_UNAVAILABLE', 'Cannot reach the Asclep gateway.', null)
  }
  if (res.status === 401) onUnauthorized()
  if (!res.ok)
    throw new GatewayError(res.status, 'NOT_FOUND', 'Image not available.', res.headers.get('X-Request-Id'))
  return res.blob()
}
