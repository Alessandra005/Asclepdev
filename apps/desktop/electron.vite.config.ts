import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Terminals inside Electron-based tools (VS Code extensions, Claude Code) can export
// ELECTRON_RUN_AS_NODE=1, which starts Electron as plain Node and crashes main on app.whenReady.
// electron-vite spawns Electron from this process, so dropping it here fixes dev and preview.
delete process.env['ELECTRON_RUN_AS_NODE']

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer') } },
    plugins: [react()]
  }
})
