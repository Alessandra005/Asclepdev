import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

// See electron.vite.config.ts: an inherited ELECTRON_RUN_AS_NODE would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env
void _runAsNode

test.beforeAll(async () => {
  app = await electron.launch({
    // Fake camera and microphone so the LiveScribing step runs without hardware.
    args: [
      'out/main/index.js',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // GitHub's Ubuntu runners block Electron's sandbox; local runs keep it.
      ...(process.env['CI'] ? ['--no-sandbox'] : [])
    ],
    // Fresh profile: a saved "Shared with team" choice from someone's own runs must not leak in.
    env: {
      ...parentEnv,
      ELECTRON_RENDERER_URL: '',
      ASCLEP_USER_DATA: mkdtempSync(join(tmpdir(), 'asclep-e2e-'))
    }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
})

/** Mock mode prefills the password and has a Demo user select; fill both fields anyway. */
async function signIn(email: string): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('asclep-demo')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The user menu is the top-bar button showing the signed-in user's full name. */
async function signOut(fullName: string): Promise<void> {
  await page.getByRole('button', { name: fullName, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
}

test('demo steps 1-7: Gregory Hale end to end (mock gateway)', async () => {
  // Sign in as the attending.
  await signIn('reyes@asclep.demo')

  // 1. Dashboard: only what needs her.
  await expect(page.getByText('Needs attention')).toBeVisible()
  await expect(page.getByText('Potassium 6.4 mmol/L (critical)')).toBeVisible()
  await expect(page.getByText('Pembrolizumab backordered')).toBeVisible()

  // 2. Gregory's chart is thin: Northside only. Request records.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search patients by name or MRN...').fill('Gregory')
  await page.getByRole('menuitem', { name: /Gregory Hale/ }).click()
  await expect(page.getByText('Allergies: unknown')).toBeVisible()
  await page.getByRole('button', { name: 'Request records' }).click()
  await expect(page.getByRole('button', { name: 'Waiting for consent...' })).toBeVisible()

  // 3. Consent + merge. The admin records consent (one window: mock state survives sign-out).
  await signOut('Dr. Maya Reyes')
  await signIn('admin@asclep.demo')
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible()
  await page
    .getByRole('row', { name: /Gregory Hale/ })
    .getByRole('button', { name: 'Review' })
    .click()
  await page.getByLabel('Consent reference').fill('Signed form #2231')
  await page.getByRole('button', { name: 'Record consent' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Recently decided')).toBeVisible()
  await signOut('Jordan Kim')

  // Back to Dr. Reyes: Riverside history, and an allergy that Northside did not have.
  await signIn('reyes@asclep.demo')
  await expect(page.getByText('Needs attention')).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search patients by name or MRN...').fill('Gregory')
  await page.getByRole('menuitem', { name: /Gregory Hale/ }).click()
  await expect(page.getByText('New from Riverside')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Penicillin allergy', { exact: true })).toBeVisible()
  await expect(page.getByText('Allergies: unknown')).toHaveCount(0)

  // 4. Lab Technician: analyze the slide, get an unverified finding.
  await page.getByRole('menuitem', { name: 'Lab' }).click()
  await page.getByRole('button', { name: 'Analyze' }).click()
  await expect(page.getByText('AI finding, unverified')).toBeVisible({ timeout: 20_000 })

  // 5. Resident report: a draft with citation chips that open the source.
  await expect(page.getByText('Resident report')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('AI draft').first()).toBeVisible()
  await page.getByText('Smoking history').click()
  await expect(page.getByText('Social history: tobacco')).toBeVisible()
  await expect(page.getByText('Observation/rv-smk-1')).toBeVisible()
  await page.keyboard.press('Escape')

  // 6. The attending signs. Status changes only after the gateway confirms.
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Confirmed by Dr. Maya Reyes')).toBeVisible()
  await expect(page.getByText('Reviewed by Dr. Maya Reyes')).toBeVisible()

  // 7. LiveScribing: consent, camera + mic, conversation and observations, checked symptoms, report, accept.
  await page.getByRole('menuitem', { name: 'Patient' }).click()
  await page.getByRole('button', { name: 'LiveScribing' }).click()
  await page.getByText(/Gregory Hale gave verbal consent/).click()
  await page.getByRole('button', { name: 'Start LiveScribing' }).click()
  await expect(page.getByText(/Walked from the door to the chair/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/short of breath walking up the stairs/)).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  // Blueprint draws its indicator over the input, so click through it.
  await page.getByLabel(/Keep in report: Mentioned shortness of breath/).check({ force: true, timeout: 30_000 })
  await page.getByRole('button', { name: 'Add 1 to scribing report' }).click()
  await expect(page.getByText(/Possible symptoms \(selected by Dr\. Maya Reyes\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByText(/Accepted by Dr\. Maya Reyes/)).toBeVisible()

  // The approved note reaches the chart; drafts never do.
  await page.getByRole('tab', { name: 'Notes' }).click()
  await expect(page.getByText('Not part of the legal record')).toBeVisible()
})
