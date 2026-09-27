import type { Intent } from '@blueprintjs/core'
import type { TranscriptRequest } from '@/api/types'

/** One wording for a records transfer wherever it shows (Overview card, Sources, Admin queue). */
export function transferStatus(t: Pick<TranscriptRequest, 'status' | 'resources_imported'>): {
  text: string
  intent: Intent
} {
  switch (t.status) {
    case 'requested':
      return { text: 'Awaiting admin consent', intent: 'warning' }
    case 'consented':
    case 'fetched':
      return { text: 'Importing', intent: 'primary' }
    case 'merged':
      return {
        text: `Merged · ${t.resources_imported} record${t.resources_imported === 1 ? '' : 's'}`,
        intent: 'success'
      }
    case 'denied':
      return { text: 'Consent denied', intent: 'danger' }
  }
}

/**
 * The Request records button for the latest request (spec 11). null = hide it: the records are merged.
 * A denial is final for that request, so the physician may ask again.
 */
export function requestButton(latest: Pick<TranscriptRequest, 'status'> | undefined): {
  text: string
  disabled: boolean
} | null {
  switch (latest?.status) {
    case undefined:
    case 'denied':
      return { text: 'Request records', disabled: false }
    case 'requested':
      return { text: 'Waiting for consent...', disabled: true }
    case 'consented':
    case 'fetched':
      return { text: 'Importing records...', disabled: true }
    case 'merged':
      return null
  }
}
