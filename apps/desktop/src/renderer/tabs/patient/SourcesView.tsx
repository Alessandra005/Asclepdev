import { Card, HTMLTable, Spinner, Tag } from '@blueprintjs/core'
import type { UseQueryResult } from '@tanstack/react-query'
import { usePatientMedications, usePatientNotes, usePatientObservations, useTranscripts } from '@/api/hooks'
import type { Patient, Provenance, SourceChip } from '@/api/types'

/** undefined = still loading, null = could not load (never shown as zero). */
export type RecordSet = { provenance: Provenance }[] | null | undefined

const settled = <T,>(q: UseQueryResult<T>, pick: (d: T) => { provenance: Provenance }[]): RecordSet =>
  q.isError ? null : q.data === undefined ? undefined : pick(q.data)

export function SourcesView({ patient }: { patient: Patient }) {
  const labs = usePatientObservations(patient.id, 'laboratory')
  const meds = usePatientMedications(patient.id)
  const notes = usePatientNotes(patient.id)
  const transfers = useTranscripts(patient.id)
  return (
    <SourcesPanel
      sources={patient.sources}
      records={{
        labs: settled(labs, (d) => d),
        meds: settled(meds, (d) => d.items),
        notes: settled(notes, (d) => d.items)
      }}
      transfers={transfers.data?.items ?? []}
    />
  )
}

/** What came from where: every record in Asclep carries its source system (spec 15 provenance). */
export function SourcesPanel({
  sources,
  records,
  transfers
}: {
  sources: SourceChip[]
  records: { labs: RecordSet; meds: RecordSet; notes: RecordSet }
  transfers: { id: string; from_provider: string; status: 'awaiting_consent' | 'merged' }[]
}) {
  return (
    <div className="grid">
      <Card className="span-7 card">
        <div className="card-head">
          <span className="card-title">Connected sources</span>
        </div>
        <HTMLTable compact className="table-fill">
          <thead>
            <tr>
              <th>Source</th>
              <th>System</th>
              <th>Status</th>
              <th className="right">Labs</th>
              <th className="right">Meds</th>
              <th className="right">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source_system}>
                <td className="strong">{s.label}</td>
                <td className="mono small">{s.source_system}</td>
                <td>
                  <Tag
                    minimal
                    intent={s.status === 'merged' ? 'success' : s.status === 'pending' ? 'warning' : 'none'}
                  >
                    {s.status === 'merged' ? 'Merged' : s.status === 'pending' ? 'Pending' : 'Current'}
                  </Tag>
                </td>
                <Count set={records.labs} system={s.source_system} />
                <Count set={records.meds} system={s.source_system} />
                <Count set={records.notes} system={s.source_system} />
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>
      <Card className="span-5 card">
        <div className="card-head">
          <span className="card-title">Records transfers</span>
        </div>
        {transfers.length === 0 ? (
          <p className="small muted">No transfer requested.</p>
        ) : (
          transfers.map((t) => (
            <div key={t.id} className="task-row">
              <span>{t.from_provider}</span>
              <Tag minimal intent={t.status === 'merged' ? 'success' : 'warning'}>
                {t.status === 'merged' ? 'Merged' : 'Awaiting admin consent'}
              </Tag>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

function Count({ set, system }: { set: RecordSet; system: string }) {
  if (set === undefined)
    return (
      <td className="right">
        <Spinner size={12} className="inline-spinner" />
      </td>
    )
  if (set === null) return <td className="right muted">Unavailable</td>
  return <td className="right">{set.filter((r) => r.provenance.source_system === system).length}</td>
}
