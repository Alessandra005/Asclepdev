declare global {
  interface Window {
    /** Undefined in Vitest (no preload). */
    asclep?: { platform: string; demoHost: boolean; newWindow: () => Promise<boolean> }
  }
}
export {}
