import { useState, type FormEvent } from 'react'
import { Button, Callout, Card, FormGroup, HTMLSelect, Icon, InputGroup } from '@blueprintjs/core'
import { login } from '@/api/hooks'
import { getDemoServer, pingDemoServer, setDemoServer, USE_MOCKS } from '@/api/client'
import { ErrorCallout } from '@/components/QueryState'
import { useSession } from '@/state/session'
import { DemoServerPicker } from './DemoServerPicker'

const DEMO_USERS = [
  'reyes@asclep.demo',
  'okafor@asclep.demo',
  'wu@asclep.demo',
  'lab@asclep.demo',
  'admin@asclep.demo'
]

export function LoginScreen() {
  const signIn = useSession((s) => s.signIn)
  const [email, setEmail] = useState('reyes@asclep.demo')
  const [password, setPassword] = useState(USE_MOCKS ? 'asclep-demo' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await login(email, password)
      signIn(res.access_token, res.user)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <Card className="login-card" elevation={1}>
        <div className="brand login-brand">
          <Icon icon="pulse" size={22} /> <span>Asclep</span>
        </div>
        <p className="muted">The layer that thinks. Synthetic demo data only.</p>
        {USE_MOCKS && (
          <DemoServerPicker
            value={getDemoServer()}
            onChange={setDemoServer}
            ping={pingDemoServer}
            hosting={window.asclep?.demoHost ?? false}
          />
        )}
        <form onSubmit={submit}>
          <FormGroup label="Email" labelFor="email">
            <InputGroup id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </FormGroup>
          {USE_MOCKS && (
            <FormGroup label="Demo user" helperText="Quick switch for rehearsals">
              <HTMLSelect
                fill
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                options={DEMO_USERS}
              />
            </FormGroup>
          )}
          <FormGroup label="Password" labelFor="password">
            <InputGroup
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormGroup>
          {error !== null && <ErrorCallout error={error} />}
          <Button type="submit" intent="primary" fill text="Sign in" loading={busy} className="mt" />
        </form>
        {USE_MOCKS && (
          <Callout className="mt" icon="info-sign" compact>
            Mock gateway on. Password for all demo users: asclep-demo
          </Callout>
        )}
      </Card>
    </div>
  )
}
