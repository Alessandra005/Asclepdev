import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { DEFAULT_DEMO_PORT, lanUrls, startDemoServer } from './demoServer'

/** Host a shared demo server so teammates' apps (and extra windows here) share one copy of the data. */
const DEMO_HOST = process.env['ASCLEP_DEMO_HOST'] === '1'
const DEMO_PORT = Number(process.env['ASCLEP_DEMO_PORT'] ?? DEFAULT_DEMO_PORT)

// Separate profile (localStorage, cache) when set: used by the e2e tests so runs start clean.
if (process.env['ASCLEP_USER_DATA']) app.setPath('userData', process.env['ASCLEP_USER_DATA'])

function createWindow(): void {
  // Offset extra windows so a second signed-in user doesn't sit exactly on top of the first.
  const offset = BrowserWindow.getAllWindows().length * 40
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    ...(offset ? { x: 60 + offset, y: 60 + offset } : {}),
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'Asclep',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Ctrl/Cmd+Shift+N: another window for a second user (host mode only; see demoServer.ts).
  win.webContents.on('before-input-event', (event, input) => {
    const combo = input.type === 'keyDown' && (input.control || input.meta) && input.shift
    if (DEMO_HOST && combo && input.key.toLowerCase() === 'n') {
      event.preventDefault()
      createWindow()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Scribe (spec 10.5): camera only. Grant 'media' for video; the renderer requests audio: false.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      callback(!types.includes('audio'))
      return
    }
    callback(false)
  })

  ipcMain.handle('asclep:new-window', () => {
    if (DEMO_HOST) createWindow()
    return DEMO_HOST
  })

  if (DEMO_HOST) {
    try {
      await startDemoServer(DEMO_PORT)
      const urls = [`http://localhost:${DEMO_PORT}`, ...lanUrls(DEMO_PORT)]
      console.log(`[asclep] Shared demo server running. Teammates join with: ${urls.join('  ')}`)
    } catch (e) {
      console.error(`[asclep] Could not start the shared demo server on port ${DEMO_PORT}:`, e)
    }
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
