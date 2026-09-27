import { Button, HTMLTable, NonIdealState, Tag, type Intent } from '@blueprintjs/core'
import type { ConsentTask } from '@/api/types'
import { RelativeTime } from '@/components/RelativeTime'
import { transferStatus } from '@/tabs/patient/transferStatus'

const RECENT = 10

const decidedStatus = (t: ConsentTask): { text: string; intent: Intent } =>
  t.status === 'denied' ? { text: 'Denied', intent: 'danger' } : transferStatus(t)

/** Spec 11 step 3: transcript requests wait here for consent; decided ones stay visible with their reference. */
export function ConsentQueue({
  tasks,
  onReview
}: {
  tasks: ConsentTask[]
  onReview: (t: ConsentTask) => void
}) {
  const pending = tasks.filter((t) => t.status === 'requested')
  const decided = tasks.filter((t) => t.status !== 'requested').slice(0, RECENT)
  return (
    <>
      {pending.length === 0 ? (
        // Wrapped so NonIdealState's height: 100% cannot fill the card and push the decided table out.
        <div>
          <NonIdealState
            icon="endorsed"
            title="No pending consent requests"
            description="When a physician requests outside records, the request waits here until you record the patient's consent or deny it."
          />
        </div>
      ) : (
        <HTMLTable compact className="table-fill">
          <thead>
            <tr>
              <th>Patient</th>
              <th>From</th>
              <th>Requested by</th>
              <th>Requested</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="strong">{t.patient_name}</div>
                  <div className="mono small muted">{t.patient_mrn}</div>
                </td>
                <td>{t.from_provider}</td>
                <td>{t.requested_by_name}</td>
                <td>
                  <RelativeTime iso={t.created_at} />
                </td>
                <td className="right">
                  <Button size="small" intent="primary" text="Review" onClick={() => onReview(t)} />
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
      {decided.length > 0 && (
        <>
          <div className="card-head mt">
            <span className="card-title">Recently decided</span>
          </div>
          <HTMLTable compact className="table-fill">
            <thead>
              <tr>
                <th>Patient</th>
                <th>From</th>
                <th>Status</th>
                <th>Consent reference</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((t) => {
                const s = decidedStatus(t)
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="strong">{t.patient_name}</div>
                      <div className="mono small muted">{t.patient_mrn}</div>
                    </td>
                    <td>{t.from_provider}</td>
                    <td>
                      <Tag minimal intent={s.intent}>
                        {s.text}
                      </Tag>
                    </td>
                    <td className="mono">{t.consent_ref}</td>
                    <td>
                      {t.completed_at ? (
                        <RelativeTime iso={t.completed_at} />
                      ) : (
                        <span className="muted">In progress</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </>
      )}
    </>
  )
}
