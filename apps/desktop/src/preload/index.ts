import { contextBridge } from 'electron'

// Keep the bridge tiny. The renderer talks to the gateway over HTTP, not through Electron.
contextBridge.exposeInMainWorld('asclep', { platform: process.platform })
