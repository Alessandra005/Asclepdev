import { Checkbox, HTMLTable, Tag } from '@blueprintjs/core'
import type { ScribeAction, ScribeObservation, TranscriptSegment } from '@/api/types'

/** One timeline of the visit: what was said (transcript) and what was seen (observations), by session time. */
export function LiveTimeline({
  observations,
  transcript,
  empty
}: {
  observations: ScribeObservation[]
  transcript: TranscriptSegment[]
  empty: string
}) {
  const rows = [
    ...transcript.map((s) => ({ t: s.t, kind: 'said' as const, label: 'said', text: s.text })),
    ...observations.map((o) => ({
      t: o.t,
      kind: 'seen' as const,
      label: o.category.replace('_', ' '),
      text: o.text
    }))
  ].sort((a, b) => a.t.localeCompare(b.t) || (a.kind === 'said' ? -1 : 1))
  if (rows.length === 0) return <p className="muted">{empty}</p>
  return (
    <HTMLTable compact className="table-fill live-timeline">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.kind === 'said' ? 'said' : 'seen'}>
            <td className="mono small">{r.t}</td>
            <td>
              <Tag minimal intent={r.kind === 'said' ? 'primary' : 'none'}>
                {r.label}
              </Tag>
            </td>
            <td>{r.text}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

const SOURCE_LABEL: Record<ScribeAction['source'], string> = {
  visual: 'seen',
  sound: 'heard',
  conversation: 'said'
}

/**
 * Possible symptoms flagged by the AI. The attending checks which ones go into the scribing report; nothing is
 * pre-checked, and nothing reaches the report without that check.
 */
export function ActionChecklist({
  actions,
  selected,
  onToggle,
  canChoose
}: {
  actions: ScribeAction[]
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  canChoose: boolean
}) {
  if (actions.length === 0) return <p className="muted">No possible symptoms were flagged in this visit.</p>
  return (
    <HTMLTable compact className="table-fill action-checklist">
      <thead>
        <tr>
          <th>Keep</th>
          <th>Possible symptom</th>
          <th>When</th>
          <th>Source</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((a) => (
          <tr key={a.id}>
            <td>
              <Checkbox
                checked={selected.has(a.id)}
                disabled={!canChoose}
                onChange={() => onToggle(a.id)}
                aria-label={`Keep in report: ${a.action}`}
              />
            </td>
            <td>
              {a.action}
              {a.verification === 'confirmed' && (
                <Tag minimal intent="success" icon="tick" className="ml">
                  confirmed by agent
                </Tag>
              )}
              {a.verification === 'unverified' && (
                <Tag minimal intent="warning" className="ml">
                  unverified
                </Tag>
              )}
              <div className="small muted">{a.why_relevant}</div>
            </td>
            <td className="mono small">{a.times.join(', ')}</td>
            <td>
              <Tag minimal>{SOURCE_LABEL[a.source]}</Tag>
            </td>
            <td>
              <Tag minimal intent={a.confidence === 'high' ? 'warning' : 'none'}>
                {a.confidence}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
