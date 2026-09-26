import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src/renderer') } },
  test: { environment: 'jsdom', include: ['src/renderer/**/*.test.tsx'], setupFiles: ['src/renderer/test/setup.ts'] }
})
