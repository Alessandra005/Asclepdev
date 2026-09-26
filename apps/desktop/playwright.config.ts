import { defineConfig } from '@playwright/test'

/** Spec 18.5: one end-to-end test over demo steps 1-7, against the built app in mock mode. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
