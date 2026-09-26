import type { Intent } from '@blueprintjs/core'
import type { Interpretation, Observation } from '@/api/types'

/** Only source flags get a tag. N or null shows nothing: unflagged is not the same as "normal". */
export function flagOf(i: Interpretation | null): { text: string; intent: Intent } | null {
  switch (i) {
    case 'HH':
      return { text: 'Critical high', intent: 'danger' }
    case 'LL':
      return { text: 'Critical low', intent: 'danger' }
    case 'H':
      return { text: 'High', intent: 'warning' }
    case 'L':
      return { text: 'Low', intent: 'warning' }
    default:
      return null
  }
}

export function valueText(o: Observation): string {
  if (o.value_num !== null) return `${o.value_num} ${o.unit ?? ''}`.trim()
  return o.value_text ?? 'No value'
}

export function rangeText(o: Observation): string | null {
  if (o.ref_low !== null && o.ref_high !== null) return `${o.ref_low}–${o.ref_high}`
  if (o.ref_high !== null) return `≤ ${o.ref_high}`
  if (o.ref_low !== null) return `≥ ${o.ref_low}`
  return null
}

export interface LabGroup {
  key: string
  display: string
  series: Observation[]
  latest: Observation
}

/** Group by LOINC (display when a source sent no code), oldest first inside each group. */
export function groupLabs(obs: Observation[]): LabGroup[] {
  const map = new Map<string, Observation[]>()
  for (const o of obs) {
    const key = o.loinc_code ?? o.display
    map.set(key, [...(map.get(key) ?? []), o])
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const series = [...list].sort((a, b) => (a.effective_at ?? '').localeCompare(b.effective_at ?? ''))
      return { key, display: series[0]!.display, series, latest: series[series.length - 1]! }
    })
    .sort((a, b) => a.display.localeCompare(b.display))
}
