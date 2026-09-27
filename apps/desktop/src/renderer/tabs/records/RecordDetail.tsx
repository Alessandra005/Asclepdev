import { Breadcrumbs, Card, HTMLTable, NonIdealState } from '@blueprintjs/core'
import { useSourceRecord } from '@/api/hooks'
import type { RecordsTreeItem } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'

/** The selected file, read through GET /sources (same RBAC and audit as a citation chip), with provenance. */
export function RecordDetail({
  patientName,
  folder,
  item,
  sourceLabel
}: {
  patientName: string
  folder: string | null
  item: RecordsTreeItem | null
  sourceLabel: (sourceSystem: string) => string
}) {
  const q = useSourceRecord(item ? `${item.type}:${item.id}` : null)
  if (!item)
    return (
      <Card className="card">
        <NonIdealState
          icon="document"
          title="Pick a record"
          description="Choose a file on the left to see it."
        />
      </Card>
    )
  return (
    <Card className="card">
      <Breadcrumbs
        items={[
          { text: patientName, icon: 'person' },
          { text: folder ?? item.type, icon: 'folder-close' },
          { text: item.title, icon: 'document' }
        ]}
      />
      <QueryState query={q}>
        {(rec) => (
          <>
            <pre className="note-body mt">{rec.body}</pre>
            <div className="label">Provenance</div>
            <HTMLTable compact className="kv">
              <tbody>
                <tr>
                  <th>Source</th>
                  <td>
                    {sourceLabel(rec.citation.provenance.source_system)}{' '}
                    <span className="mono muted small">({rec.citation.provenance.source_system})</span>
                  </td>
                </tr>
                <tr>
                  <th>Reference</th>
                  <td className="mono">{rec.citation.provenance.source_ref}</td>
                </tr>
                <tr>
                  <th>Recorded</th>
                  <td>
                    <RelativeTime iso={rec.recorded_at} />
                  </td>
                </tr>
                <tr>
                  <th>Ingested</th>
                  <td>
                    <RelativeTime iso={rec.citation.provenance.ingested_at} />
                  </td>
                </tr>
              </tbody>
            </HTMLTable>
          </>
        )}
      </QueryState>
    </Card>
  )
}
