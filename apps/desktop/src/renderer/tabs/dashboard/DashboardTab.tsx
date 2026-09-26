import { Button, Card, HTMLTable, NonIdealState, Tag } from '@blueprintjs/core'
import { useDashboard } from '@/api/hooks'
import type { AttentionItem, DashboardResponse } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { clockTime, relative } from '@/components/RelativeTime'
import { useSession } from '@/state/session'
import { useUi } from '@/state/ui'

const SEV_INTENT = { critical: 'danger', warning: 'warning', info: 'none' } as const

export function DashboardTab() {
  const q = useDashboard()
  return <QueryState query={q}>{(d) => <DashboardView data={d} />}</QueryState>
}

/** Exported for the Vitest empty-state check (spec 18.5). */
export function DashboardView({ data }: { data: DashboardResponse }) {
  const user = useSession((s) => s.user)
  const openPatient = useUi((s) => s.openPatient)
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const name = user?.role === 'physician' ? user.full_name : (user?.full_name.split(' ')[0] ?? '')
  const act = (a: AttentionItem) => openPatient(a.patient_id, a.action_target === 'lab' ? 'lab' : 'patient')
  const empty = !data.attention.length && !data.schedule.length && !data.tasks.length

  return (
    <div className="page">
      <h1 className="page-title">
        {greet}, {name}
      </h1>
      <p className="muted">
        Today / {data.schedule.length} appointments / {data.tasks.length} pending tasks
      </p>

      {empty ? (
        <NonIdealState
          icon="tick-circle"
          title="Nothing needs you right now"
          description="New alerts, appointments and tasks for your patients will appear here."
        />
      ) : (
        <div className="grid">
          <Card className="span-12 card">
            <div className="card-head">
              <span className="card-title">Needs attention</span>
              <span className="small muted">{data.attention.length} items</span>
            </div>
            {data.attention.length === 0 ? (
              <p className="muted">No alerts.</p>
            ) : (
              <HTMLTable compact className="table-fill attention">
                <tbody>
                  {data.attention.slice(0, 5).map((a) => (
                    <tr key={a.id} className={`sev-${a.severity}`}>
                      <td className="strong">{a.patient_name}</td>
                      <td>
                        <Tag minimal intent={SEV_INTENT[a.severity]}>
                          {a.problem}
                        </Tag>
                      </td>
                      <td className="muted">{a.source}</td>
                      <td className="right">
                        <Button size="small" text={a.action_label} onClick={() => act(a)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
          </Card>

          <Card className="span-7 card">
            <div className="card-head">
              <span className="card-title">Today's schedule</span>
              <Button variant="minimal" size="small" text="View all" />
            </div>
            <HTMLTable compact interactive className="table-fill">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient / reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.schedule.map((s) => (
                  <tr key={s.id} onClick={() => openPatient(s.patient_id)}>
                    <td className="mono">{clockTime(s.starts_at)}</td>
                    <td>
                      {s.patient_name} / <span className="muted">{s.reason}</span>
                    </td>
                    <td>
                      <Tag minimal>{s.status.replace('_', ' ')}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </Card>

          <Card className="span-5 card">
            <div className="card-head">
              <span className="card-title">Pending tasks</span>
            </div>
            {data.tasks.map((t, i) => (
              <div key={t.id} className="task-row">
                <div>
                  <div className="strong">{t.title}</div>
                  <div className="small muted">{t.detail}</div>
                </div>
                {i === 0 && (
                  <Button
                    intent="primary"
                    size="small"
                    text="Open Lab"
                    onClick={() => openPatient(t.patient_id, 'lab')}
                  />
                )}
              </div>
            ))}
          </Card>

          <Card className="span-7 card">
            <div className="card-head">
              <span className="card-title">Recent patients</span>
              <span className="small muted">Last 5 opened</span>
            </div>
            <HTMLTable compact interactive className="table-fill">
              <tbody>
                {data.recent_patients.slice(0, 5).map((r) => (
                  <tr key={r.patient_id} onClick={() => openPatient(r.patient_id)}>
                    <td className="strong">{r.name}</td>
                    <td className="muted">{r.context}</td>
                    <td className="right small muted">{relative(r.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </Card>

          <Card className="span-5 card">
            <div className="card-head">
              <span className="card-title">Supply watch</span>
            </div>
            {data.supply_watch.map((s) => (
              <div key={s.medication} className="task-row">
                <div>
                  <div>
                    {s.medication} / {s.on_hand} on hand
                  </div>
                  {s.expected_restock && (
                    <div className="small">
                      <Tag minimal intent={s.backordered ? 'warning' : 'none'}>
                        {s.backordered ? 'Backordered' : 'Low'}
                      </Tag>{' '}
                      <span className="muted">Restock {relative(s.expected_restock)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
