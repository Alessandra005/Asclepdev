import type { DateRange } from '@blueprintjs/datetime'
import type { AuditQuery } from '@/api/hooks'
import type { AuditRow } from '@/api/types'

/** Actions written by services/api/app/audit/log.py; rows may add more (merged into the picker). */
export const BASE_ACTIONS = ['read', 'create', 'update', 'sign', 'deny']

export interface AuditFilterState {
  patientId: string
  action: string
  range: DateRange
  aiOnly: boolean
  deniedOnly: boolean
}
export const EMPTY_FILTERS: AuditFilterState = {
  patientId: '',
  action: '',
  range: [null, null],
  aiOnly: false,
  deniedOnly: false
}

/** Patient, action and dates go to the gateway (spec 15 query params). */
export function toQuery(f: AuditFilterState): AuditQuery {
  const [start, end] = f.range
  const endOfDay = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999) : null
  return {
    patient_id: f.patientId || undefined,
    action: f.action || undefined,
    from: start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString() : undefined,
    to: endOfDay ? endOfDay.toISOString() : undefined
  }
}

/** The gateway has no params for these, so they filter the returned page. */
export function applyClientFilters(
  rows: AuditRow[],
  f: Pick<AuditFilterState, 'aiOnly' | 'deniedOnly'>
): AuditRow[] {
  return rows.filter((r) => (!f.aiOnly || r.actor_kind !== 'user') && (!f.deniedOnly || !r.allowed))
}

export function actionOptions(rows: AuditRow[], selected: string): string[] {
  return [...new Set([...BASE_ACTIONS, ...rows.map((r) => r.action), ...(selected ? [selected] : [])])].sort()
}

export const isFiltered = (f: AuditFilterState): boolean =>
  !!(f.patientId || f.action || f.range[0] || f.range[1] || f.aiOnly || f.deniedOnly)
