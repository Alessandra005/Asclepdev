import { contextBridge, ipcRenderer } from 'electron'

// Keep the bridge tiny. The renderer talks to the gateway over HTTP, not through Electron.
contextBridge.exposeInMainWorld('asclep', {
  platform: process.platform,
  /** True when this app hosts the shared demo server (ASCLEP_DEMO_HOST=1). */
  demoHost: process.env['ASCLEP_DEMO_HOST'] === '1',
  /** Opens another window (host mode only), e.g. to sign in as a second user. */
  newWindow: (): Promise<boolean> => ipcRenderer.invoke('asclep:new-window')
})
