import { useEffect, useState } from 'react'
import { Button, Callout, FormGroup, InputGroup, SegmentedControl, Tag } from '@blueprintjs/core'
import { normalizeDemoUrl, type DemoPing } from '@/api/client'

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; ping: DemoPing }
  | { kind: 'error'; message: string }

const isLocalhost = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(url)

/**
 * Where the mock data lives: this app only, or a teammate's shared demo server (src/main/demoServer.ts)
 * so two users on different windows or laptops see the same requests and consents. Switches only
 * after the server answers.
 */
export function DemoServerPicker({
  value,
  onChange,
  ping,
  hosting
}: {
  value: string | null
  onChange: (url: string | null) => void
  ping: (url: string) => Promise<DemoPing>
  /** This app runs the shared server (pnpm demo:host). */
  hosting: boolean
}) {
  const [mode, setMode] = useState<'local' | 'shared'>(value ? 'shared' : 'local')
  const [text, setText] = useState(value ?? (hosting ? 'localhost' : ''))
  const [status, setStatus] = useState<Status>(value ? { kind: 'checking' } : { kind: 'idle' })

  const connect = async (raw: string): Promise<void> => {
    const url = normalizeDemoUrl(raw)
    if (!url) {
      setStatus({ kind: 'error', message: 'Enter the host address, like 192.168.1.20.' })
      return
    }
    setStatus({ kind: 'checking' })
    try {
      const p = await ping(url)
      setText(url)
      setStatus({ kind: 'ok', ping: p })
      onChange(url)
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The server did not answer.' })
    }
  }

  // A saved shared server may be gone (the host closed the app): check it once on open.
  useEffect(() => {
    if (!value) return
    let live = true
    ping(value).then(
      (p) => live && setStatus({ kind: 'ok', ping: p }),
      (e: unknown) =>
        live &&
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The server did not answer.' })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the saved choice
  }, [])

  return (
    <FormGroup label="Demo data" helperText={hosting ? 'This computer hosts the shared demo.' : undefined}>
      <SegmentedControl
        fill
        small
        value={mode}
        options={[
          { label: 'This computer', value: 'local' },
          { label: 'Shared with team', value: 'shared' }
        ]}
        onValueChange={(v) => {
          const next = v === 'shared' ? 'shared' : 'local'
          setMode(next)
          setStatus({ kind: 'idle' })
          if (next === 'local') onChange(null)
        }}
      />
      {mode === 'shared' && (
        <div className="mt">
          <FormGroup label="Host address" labelFor="demo-host">
            <InputGroup
              id="demo-host"
              className="mono"
              placeholder="192.168.1.20"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void connect(text)
                }
              }}
              rightElement={
                <Button
                  variant="minimal"
                  text="Connect"
                  loading={status.kind === 'checking'}
                  onClick={() => void connect(text)}
                />
              }
            />
          </FormGroup>
          {status.kind === 'idle' && (
            <p className="small muted">
              Click Connect. Until then, sign-in uses this computer&apos;s own data.
            </p>
          )}
          {status.kind === 'ok' && (
            <>
              <Tag minimal intent="success" icon="link">
                Connected to {status.ping.host}
              </Tag>
              {isLocalhost(text) && status.ping.urls.length > 0 && (
                <p className="small muted mt">
                  Teammates join with{' '}
                  {status.ping.urls.map((u) => (
                    <span key={u} className="mono">
                      {u}{' '}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
          {status.kind === 'error' && (
            <Callout intent="danger" compact icon="offline">
              {status.message} Is the host app running with <span className="mono">pnpm demo:host</span>?
            </Callout>
          )}
        </div>
      )}
    </FormGroup>
  )
}
