import { Button, Card, HTMLTable, Tag } from '@blueprintjs/core'
import { useFindings } from '@/api/hooks'
import type { Finding, Patient } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'
import { REVIEW_OUTCOME } from '@/components/ReviewPanel'
import { useUi } from '@/state/ui'

export function FindingsView({ patient }: { patient: Patient }) {
  const q = useFindings(patient.id)
  const openPatient = useUi((s) => s.openPatient)
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        icon: 'lab-test',
        title: 'No pathology findings',
        description: 'No slides have been analyzed for this patient.'
      }}
    >
      {(d) => <FindingsPanel findings={d.items} onOpenLab={() => openPatient(patient.id, 'lab')} />}
    </QueryState>
  )
}

/** Read-only list. Review happens in the Lab tab; status shown is whatever the gateway returned. */
export function FindingsPanel({ findings, onOpenLab }: { findings: Finding[]; onOpenLab: () => void }) {
  return (
    <Card className="card">
      <div className="card-head">
        <span className="card-title">Findings</span>
      </div>
      <HTMLTable compact className="table-fill">
        <thead>
          <tr>
            <th>Specimen</th>
            <th>Model label</th>
            <th>Confidence</th>
            <th>Model</th>
            <th>Status</th>
            <th>Reviewed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id}>
              <td>{f.specimen_label}</td>
              <td className="strong">{f.label_display}</td>
              <td>{Math.round(f.confidence * 100)}%</td>
              <td className="mono small">
                {f.model_name} {f.model_version}
              </td>
              <td>
                <StatusTag finding={f} />
              </td>
              <td>
                {f.reviewed_by && f.reviewed_at ? (
                  <>
                    {f.reviewed_by}, <RelativeTime iso={f.reviewed_at} />
                  </>
                ) : (
                  <span className="muted">Not yet</span>
                )}
              </td>
              <td className="right">
                <Button
                  size="small"
                  text={f.status === 'pending_review' ? 'Review in Lab' : 'Open in Lab'}
                  onClick={onOpenLab}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </Card>
  )
}

function StatusTag({ finding: f }: { finding: Finding }) {
  if (f.status === 'pending_review')
    return (
      <Tag minimal intent="warning" icon="warning-sign">
        Unverified AI finding
      </Tag>
    )
  const o = REVIEW_OUTCOME[f.status]
  return (
    <Tag minimal intent={o.intent}>
      {o.title}
      {f.status === 'overridden' && f.final_label ? ` to ${f.final_label}` : ''}
    </Tag>
  )
}
