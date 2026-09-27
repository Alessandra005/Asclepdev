import { mkdtempSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Two users at once on one shared demo server (src/main/demoServer.ts): the host app serves the mock
 * data, Dr. Reyes requests Gregory's records in one window, the admin records consent in a second
 * window, and Dr. Reyes sees the merge without signing out. Same path as two teammates' laptops.
 */
const PORT = '8799' // not the default 8787, so a teammate's running host can't collide with the test

let app: ElectronApplication

/** Join by this machine's network IP, like a teammate's laptop would (localhost hid a CSP block once). */
const lanIp =
  Object.values(networkInterfaces())
    .flat()
    .find((a) => a !== undefined && a.family === 'IPv4' && !a.internal)?.address ?? 'localhost'

const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env
void _runAsNode

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js', ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: {
      ...parentEnv,
      ELECTRON_RENDERER_URL: '',
      ASCLEP_DEMO_HOST: '1',
      ASCLEP_DEMO_PORT: PORT,
      ASCLEP_USER_DATA: mkdtempSync(join(tmpdir(), 'asclep-e2e-shared-'))
    }
  })
})

test.afterAll(async () => {
  await app?.close()
})

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('asclep-demo')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('two users share one demo: Reyes requests, admin consents in another window, Reyes sees the merge', async () => {
  const reyes = await app.firstWindow()

  // Join the shared server this app hosts.
  await reyes.getByText('Shared with team').click()
  await reyes.getByLabel('Host address').fill(`${lanIp}:${PORT}`)
  await reyes.getByRole('button', { name: 'Connect' }).click()
  await expect(reyes.getByText(/Connected to/)).toBeVisible()

  await signIn(reyes, 'reyes@asclep.demo')
  await expect(reyes.getByText(/SHARED DEMO/)).toBeVisible()
  await reyes.keyboard.press('Control+k')
  await reyes.getByPlaceholder('Search patients by name or MRN...').fill('Gregory')
  await reyes.getByRole('menuitem', { name: /Gregory Hale/ }).click()
  await reyes.getByRole('button', { name: 'Request records' }).click()
  await expect(reyes.getByRole('button', { name: 'Waiting for consent...' })).toBeVisible()

  // A second window for the admin, opened from the user menu (host mode only).
  const opened = app.waitForEvent('window')
  await reyes.getByRole('button', { name: 'Dr. Maya Reyes', exact: true }).click()
  await reyes.getByRole('menuitem', { name: /New window \(second user\)/ }).click()
  const admin = await opened
  // The saved choice carries over, so the second window is already on the shared server.
  await expect(admin.getByText(/Connected to/)).toBeVisible()
  await signIn(admin, 'admin@asclep.demo')
  await admin
    .getByRole('row', { name: /Gregory Hale/ })
    .getByRole('button', { name: 'Review' })
    .click()
  await admin.getByLabel('Consent reference').fill('Signed form #2231')
  await admin.getByRole('button', { name: 'Record consent' }).click()
  await expect(admin.getByText('Recently decided')).toBeVisible()

  // Dr. Reyes never signed out: her open chart picks up the merge from the shared server.
  await expect(reyes.getByText('New from Riverside')).toBeVisible({ timeout: 20_000 })
  await expect(reyes.getByText('Penicillin allergy', { exact: true })).toBeVisible()
})
