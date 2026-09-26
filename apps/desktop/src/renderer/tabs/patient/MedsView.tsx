import { Card, HTMLTable, Tag } from '@blueprintjs/core'
import { usePatientMedications } from '@/api/hooks'
import type { MedicationRequest, Patient } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { relative, RelativeTime } from '@/components/RelativeTime'

export function MedsView({ patient }: { patient: Patient }) {
  const q = usePatientMedications(patient.id)
  const sourceLabel = (sys: string): string =>
    patient.sources.find((s) => s.source_system === sys)?.label ?? sys
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        icon: 'prescription',
        title: 'No medication orders received',
        description:
          'No connected source has sent medication orders. This does not mean the patient takes none.'
      }}
    >
      {(d) => <MedsPanel meds={d.items} sourceLabel={sourceLabel} />}
    </QueryState>
  )
}

/** Active orders first. Inventory status uses intents; a missing inventory row says so. */
export function MedsPanel({
  meds,
  sourceLabel
}: {
  meds: MedicationRequest[]
  sourceLabel: (sourceSystem: string) => string
}) {
  const sorted = [...meds].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
  return (
    <Card className="card">
      <div className="card-head">
        <span className="card-title">Medication orders</span>
      </div>
      <HTMLTable compact className="table-fill">
        <thead>
          <tr>
            <th>Medication</th>
            <th>Dose</th>
            <th>Status</th>
            <th>Inventory</th>
            <th>Ordered</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id}>
              <td className="strong">{m.medication}</td>
              <td className={m.dosage_text ? undefined : 'muted'}>{m.dosage_text ?? 'Not given'}</td>
              <td>{m.status === 'active' ? 'Active' : <span className="muted">{m.status}</span>}</td>
              <td>
                <InventoryTag inv={m.inventory} />
              </td>
              <td>
                {m.effective_at ? (
                  <RelativeTime iso={m.effective_at} />
                ) : (
                  <span className="muted">Date unknown</span>
                )}
              </td>
              <td className="muted">{sourceLabel(m.provenance.source_system)}</td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </Card>
  )
}

function InventoryTag({ inv }: { inv: MedicationRequest['inventory'] }) {
  if (!inv) return <span className="muted">Not tracked</span>
  const restock = inv.expected_restock_at ? `, restock ${relative(inv.expected_restock_at)}` : ''
  if (inv.status === 'backordered')
    return (
      <Tag minimal intent="danger" icon="warning-sign">
        Backordered{restock}
      </Tag>
    )
  if (inv.status === 'low')
    return (
      <Tag minimal intent="warning">
        Low: {inv.on_hand} on hand{restock}
      </Tag>
    )
  return <Tag minimal>In stock ({inv.on_hand})</Tag>
}
