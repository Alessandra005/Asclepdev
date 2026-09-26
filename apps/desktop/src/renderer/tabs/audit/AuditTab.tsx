import { HTMLTable, Tag } from '@blueprintjs/core'
import { useAudit } from '@/api/hooks'
import { LocalProcessingPill } from '@/components/LocalProcessingPill'
import { QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'
import { useSession } from '@/state/session'

/** Also the Assurant "AI activity log": every AI step shows who it acted for and where it ran. */
export function AuditTab() {
  const q = useAudit()
  const role = useSession((s) => s.role)
  return (
    <div className="page">
      <h1 className="page-title">Audit</h1>
      <p className="muted">
        {role === 'admin'
          ? 'All activity, including every AI read.'
          : 'Your actions and the AI steps taken on your behalf.'}
      </p>
      {/* TODO: Blueprint Table2 + DateRangeInput filters per spec 14.2 once row volume needs it. */}
      <QueryState
        query={q}
        isEmpty={(d) => d.items.length === 0}
        empty={{ icon: 'history', title: 'No activity yet' }}
      >
        {(d) => (
          <HTMLTable compact striped className="table-fill card-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>On behalf of</th>
                <th>Action</th>
                <th>Object</th>
                <th>Patient</th>
                <th>Ran on</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <RelativeTime iso={a.at} />
                  </td>
                  <td>
                    {a.actor_kind === 'user' ? (
                      a.actor_name
                    ) : (
                      <Tag minimal intent="warning" icon="predictive-analysis">
                        {a.actor_name}
                      </Tag>
                    )}
                  </td>
                  <td className="muted">{a.on_behalf_of ?? ''}</td>
                  <td className="mono small">{a.action}</td>
                  <td className="small">{a.object_type}</td>
                  <td>{a.patient_name ?? ''}</td>
                  <td>{a.ran_on && <LocalProcessingPill ranOn={a.ran_on} />}</td>
                  <td>
                    {a.allowed ? (
                      <Tag minimal intent="success">
                        allowed
                      </Tag>
                    ) : (
                      <Tag minimal intent="danger">
                        denied
                      </Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </QueryState>
    </div>
  )
}
