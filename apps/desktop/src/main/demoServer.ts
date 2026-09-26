/**
 * Shared demo server: serves the in-memory mock gateway over HTTP so several app windows or laptops on
 * the same network see one copy of the demo data (e.g. Dr. Reyes requests records while a teammate,
 * signed in as admin elsewhere, records consent). Started by the host's main process only when
 * ASCLEP_DEMO_HOST=1. Synthetic data only; it is open to the local network by design, with CORS *.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { GatewayError } from '../renderer/api/errors'
import { mockGateway } from '../renderer/api/mock/handler'

export const DEMO_PREFIX = '/demo'
export const DEFAULT_DEMO_PORT = 8787

export interface DemoPing {
  ok: true
  host: string
  /** Addresses teammates can join with (non-internal IPv4). */
  urls: string[]
}

export function lanUrls(port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a!.address}:${port}`)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // Scribe windows post multipart frames; the mock ignores them, so only JSON bodies are parsed.
  if (!(req.headers['content-type'] ?? '').includes('application/json')) {
    req.resume()
    return undefined
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const envelope = (code: string, message: string, requestId: string | null) => ({
  error: { code, message, request_id: requestId ?? 'req_demo' }
})

export function createDemoServer(port: number): Server {
  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://demo')
    if (!url.pathname.startsWith(DEMO_PREFIX + '/')) {
      sendJson(res, 404, envelope('NOT_FOUND', 'Not an Asclep demo route.', null))
      return
    }
    const path = url.pathname.slice(DEMO_PREFIX.length)
    if (path === '/ping') {
      sendJson(res, 200, { ok: true, host: hostname(), urls: lanUrls(port) } satisfies DemoPing)
      return
    }
    void (async () => {
      try {
        const body = await readJson(req)
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
        sendJson(res, 200, await mockGateway(req.method ?? 'GET', path + url.search, body, token))
      } catch (e) {
        const [status, body] =
          e instanceof GatewayError
            ? [e.status, envelope(e.code, e.message, e.requestId)]
            : e instanceof SyntaxError
              ? [422, envelope('VALIDATION_ERROR', 'Body is not JSON.', null)]
              : [500, envelope('INTERNAL', e instanceof Error ? e.message : 'Demo server error.', null)]
        sendJson(res, status, body)
      }
    })()
  })
}

/** Resolves once listening on every interface. Rejects if the port is taken. */
export function startDemoServer(port = DEFAULT_DEMO_PORT): Promise<Server> {
  const server = createDemoServer(port)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve(server))
  })
}
