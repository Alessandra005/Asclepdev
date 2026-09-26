import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    // Fake camera so the Scribe step runs without hardware. Audio stays denied by the main process.
    args: ['out/main/index.js', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
})

test('demo steps 1-7: Gregory Hale end to end (mock gateway)', async () => {
  // Sign in as the attending.
  await page.getByLabel('Email').fill('reyes@asclep.demo')
  await page.getByLabel('Password').fill('asclep-demo')
  await page.getByRole('button', { name: 'Sign in' }).click()

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

  // 3. Consent + merge: Riverside history, allergy that Northside did not have.
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

  // 7. The Scribe: consent, camera, observations, draft note, accept.
  await page.getByRole('menuitem', { name: 'Patient' }).click()
  await page.getByRole('button', { name: 'Start Scribe' }).click()
  await page.getByText('Gregory Hale gave verbal consent').click()
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(page.getByText(/Walked from the door to the chair/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.getByRole('button', { name: 'Accept' }).click({ timeout: 30_000 })
  await expect(page.getByText(/Accepted by Dr\. Maya Reyes/)).toBeVisible()

  // The approved note reaches the chart; drafts never do.
  await page.getByRole('tab', { name: 'Notes' }).click()
  await expect(page.getByText('Not part of the legal record')).toBeVisible()
})
