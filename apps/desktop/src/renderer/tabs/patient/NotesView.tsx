import { useState } from 'react'
import { Card, HTMLTable, Tag } from '@blueprintjs/core'
import { usePatientNotes } from '@/api/hooks'
import type { Note, Patient } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'

const KIND: Record<string, string> = {
  progress: 'Progress',
  scribe: 'Scribe',
  shadowing: 'Shadowing',
  referral: 'Referral',
  imaging_report: 'Imaging',
  visual_scribe: 'Visit observations'
}

export function NotesView({ patient }: { patient: Patient }) {
  const q = usePatientNotes(patient.id)
  const sourceLabel = (sys: string): string =>
    sys === 'asclep' ? 'Asclep' : (patient.sources.find((s) => s.source_system === sys)?.label ?? sys)
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        icon: 'document',
        title: 'No notes received',
        description: 'No connected source has sent notes for this patient yet.'
      }}
    >
      {(d) => <NotesPanel notes={d.items} sourceLabel={sourceLabel} />}
    </QueryState>
  )
}

/** Newest first on the left, the selected note's full text on the right. */
export function NotesPanel({
  notes,
  sourceLabel
}: {
  notes: Note[]
  sourceLabel: (sourceSystem: string) => string
}) {
  const sorted = [...notes].sort((a, b) => (b.effective_at ?? '').localeCompare(a.effective_at ?? ''))
  const [picked, setPicked] = useState<string | null>(null)
  const selected = sorted.find((n) => n.id === picked) ?? sorted[0]

  return (
    <div className="grid">
      <Card className="span-5 card">
        <div className="card-head">
          <span className="card-title">Notes</span>
          <span className="small muted">{sorted.length}</span>
        </div>
        <HTMLTable compact interactive className="table-fill">
          <tbody>
            {sorted.map((n) => (
              <tr
                key={n.id}
                className={n.id === selected?.id ? 'is-selected' : undefined}
                tabIndex={0}
                aria-selected={n.id === selected?.id}
                onClick={() => setPicked(n.id)}
                onKeyDown={(e) => e.key === 'Enter' && setPicked(n.id)}
              >
                <td>
                  <div className="strong">{n.title}</div>
                  <div className="small muted">
                    {KIND[n.kind] ?? n.kind} · {sourceLabel(n.provenance.source_system)}
                  </div>
                </td>
                <td className="right">
                  {n.effective_at ? (
                    <RelativeTime iso={n.effective_at} />
                  ) : (
                    <span className="muted">Date unknown</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>
      {selected && (
        <Card className="span-7 card">
          <div className="card-head">
            <span className="card-title">{selected.title}</span>
            <Tag minimal icon="database">
              {sourceLabel(selected.provenance.source_system)}
            </Tag>
            {!selected.is_legal_record && (
              <Tag minimal intent="warning">
                Not part of the legal record
              </Tag>
            )}
          </div>
          <p className="small muted">
            {selected.author_name ?? 'Author not given'}
            {selected.effective_at && ` · ${new Date(selected.effective_at).toLocaleString()}`}
          </p>
          <pre className="note-body">{selected.body}</pre>
        </Card>
      )}
    </div>
  )
}
