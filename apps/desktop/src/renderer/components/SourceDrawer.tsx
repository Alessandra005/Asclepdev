import { Drawer, DrawerSize, HTMLTable } from '@blueprintjs/core'
import { useSourceRecord } from '@/api/hooks'
import { useUi } from '@/state/ui'
import { QueryState } from './QueryState'
import { RelativeTime } from './RelativeTime'

export function SourceDrawer() {
  const id = useUi((s) => s.sourceCitationId)
  const close = useUi((s) => s.openSource)
  const q = useSourceRecord(id)
  return (
    <Drawer
      isOpen={!!id}
      onClose={() => close(null)}
      size={DrawerSize.SMALL}
      title="Source record"
      icon="document-open"
    >
      <div className="drawer-body">
        <QueryState query={q}>
          {(rec) => (
            <>
              <h3 className="h3">{rec.title}</h3>
              <p>{rec.body}</p>
              <HTMLTable compact className="kv">
                <tbody>
                  <tr>
                    <th>Source</th>
                    <td className="mono">{rec.citation.provenance.source_system}</td>
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
      </div>
    </Drawer>
  )
}
