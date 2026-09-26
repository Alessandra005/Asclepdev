import { Breadcrumbs, Card, HTMLTable, NonIdealState, Tag } from '@blueprintjs/core'
import { RelativeTime } from '@/components/RelativeTime'
import { FOLDERS, type RecordFile } from './recordsTree'

/** The selected file: its fields, full text if any, and where it came from. */
export function RecordDetail({
  patientName,
  file,
  sourceLabel
}: {
  patientName: string
  file: RecordFile | null
  sourceLabel: (sourceSystem: string) => string
}) {
  if (!file)
    return (
      <Card className="card">
        <NonIdealState
          icon="document"
          title="Pick a record"
          description="Choose a file on the left to see it."
        />
      </Card>
    )
  const folder = FOLDERS.find((f) => f.id === file.folder)?.label ?? file.folder
  return (
    <Card className="card">
      <Breadcrumbs
        items={[
          { text: patientName, icon: 'person' },
          { text: folder, icon: 'folder-close' },
          ...(file.group ? [{ text: file.group, icon: 'folder-close' as const }] : []),
          { text: file.name, icon: 'document' }
        ]}
      />
      {file.unverified && (
        <Tag minimal intent="warning" icon="warning-sign" className="mt">
          Unverified AI finding
        </Tag>
      )}
      <HTMLTable compact className="kv mt">
        <tbody>
          {file.fields.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
      {file.body && <pre className="note-body mt">{file.body}</pre>}
      <div className="label">Provenance</div>
      <HTMLTable compact className="kv">
        <tbody>
          <tr>
            <th>Source</th>
            <td>
              {sourceLabel(file.provenance.source_system)}{' '}
              <span className="mono muted small">({file.provenance.source_system})</span>
            </td>
          </tr>
          <tr>
            <th>Reference</th>
            <td className="mono">{file.provenance.source_ref}</td>
          </tr>
          <tr>
            <th>Ingested</th>
            <td>
              <RelativeTime iso={file.provenance.ingested_at} />
            </td>
          </tr>
        </tbody>
      </HTMLTable>
    </Card>
  )
}
