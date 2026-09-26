import { useState, type ReactNode } from 'react'
import { Button, HTMLSelect, Switch, Tag } from '@blueprintjs/core'
import { DateRangeInput } from '@blueprintjs/datetime'
import { Cell, Column, Table2 } from '@blueprintjs/table'
import { useAudit, usePatientSearch } from '@/api/hooks'
import type { AuditRow, PatientListItem } from '@/api/types'
import { LocalProcessingPill } from '@/components/LocalProcessingPill'
import { QueryState } from '@/components/QueryState'
import { relative } from '@/components/RelativeTime'
import { useSession } from '@/state/session'
import {
  actionOptions,
  applyClientFilters,
  EMPTY_FILTERS,
  isFiltered,
  toQuery,
  type AuditFilterState
} from './auditFilters'

/** Also the Assurant "AI activity log": every AI step shows who it acted for and where it ran. */
export function AuditTab() {
  const role = useSession((s) => s.role)
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS)
  const q = useAudit(toQuery(filters))
  const patients = usePatientSearch('')
  return (
    <div className="page">
      <h1 className="page-title">Audit</h1>
      <p className="muted">
        {role === 'admin'
          ? 'All activity, including every AI read.'
          : 'Your actions and the AI steps taken on your behalf.'}
      </p>
      <AuditFilters
        value={filters}
        onChange={setFilters}
        patients={patients.data?.items ?? []}
        actions={actionOptions(q.data?.items ?? [], filters.action)}
      />
      <QueryState
        query={q}
        isEmpty={(d) => applyClientFilters(d.items, filters).length === 0}
        empty={
          isFiltered(filters)
            ? { icon: 'filter', title: 'No matching activity', description: 'Try clearing a filter.' }
            : { icon: 'history', title: 'No activity yet' }
        }
      >
        {(d) => <AuditTable rows={applyClientFilters(d.items, filters)} />}
      </QueryState>
    </div>
  )
}

/** One filter row above the table (spec 14.2: Table2 + DateRangeInput). */
export function AuditFilters({
  value,
  onChange,
  patients,
  actions
}: {
  value: AuditFilterState
  onChange: (f: AuditFilterState) => void
  patients: PatientListItem[]
  actions: string[]
}) {
  const set = (patch: Partial<AuditFilterState>): void => onChange({ ...value, ...patch })
  return (
    <div className="row gap wrap audit-filters">
      {patients.length > 0 && (
        <HTMLSelect
          aria-label="Patient"
          value={value.patientId}
          onChange={(e) => set({ patientId: e.currentTarget.value })}
          options={[
            { value: '', label: 'All patients' },
            ...patients.map((p) => ({ value: p.id, label: p.name }))
          ]}
        />
      )}
      <HTMLSelect
        aria-label="Action"
        value={value.action}
        onChange={(e) => set({ action: e.currentTarget.value })}
        options={[{ value: '', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a }))]}
      />
      <DateRangeInput
        value={value.range}
        onChange={(range) => set({ range })}
        dateFnsFormat="yyyy-MM-dd"
        shortcuts={false}
        allowSingleDayRange
        startInputProps={{ placeholder: 'From', 'aria-label': 'From date' }}
        endInputProps={{ placeholder: 'To', 'aria-label': 'To date' }}
      />
      <Switch label="AI steps only" checked={value.aiOnly} onChange={() => set({ aiOnly: !value.aiOnly })} />
      <Switch
        label="Denied only"
        checked={value.deniedOnly}
        onChange={() => set({ deniedOnly: !value.deniedOnly })}
      />
      {isFiltered(value) && (
        <Button variant="minimal" icon="cross" text="Clear filters" onClick={() => onChange(EMPTY_FILTERS)} />
      )}
    </div>
  )
}

const COLUMNS: { name: string; width: number; render: (r: AuditRow) => ReactNode }[] = [
  {
    name: 'When',
    width: 110,
    render: (r) => <span title={new Date(r.at).toLocaleString()}>{relative(r.at)}</span>
  },
  {
    name: 'Actor',
    width: 170,
    render: (r) =>
      r.actor_kind === 'user' ? (
        r.actor_name
      ) : (
        <Tag minimal intent="warning" icon="predictive-analysis">
          {r.actor_name}
        </Tag>
      )
  },
  { name: 'On behalf of', width: 150, render: (r) => <span className="muted">{r.on_behalf_of ?? ''}</span> },
  { name: 'Action', width: 120, render: (r) => <span className="mono">{r.action}</span> },
  { name: 'Object', width: 130, render: (r) => r.object_type },
  { name: 'Patient', width: 140, render: (r) => r.patient_name ?? '' },
  { name: 'Ran on', width: 150, render: (r) => r.ran_on && <LocalProcessingPill ranOn={r.ran_on} /> },
  {
    name: 'Result',
    width: 90,
    render: (r) => (
      <Tag minimal intent={r.allowed ? 'success' : 'danger'}>
        {r.allowed ? 'allowed' : 'denied'}
      </Tag>
    )
  }
]

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="audit-table card-table">
      <Table2
        numRows={rows.length}
        cellRendererDependencies={[rows]}
        columnWidths={COLUMNS.map((c) => c.width)}
        defaultRowHeight={28}
        enableRowHeader={false}
        enableColumnResizing
        enableFocusedCell={false}
      >
        {COLUMNS.map((c) => (
          <Column
            key={c.name}
            name={c.name}
            cellRenderer={(i) => <Cell>{rows[i] ? c.render(rows[i]) : null}</Cell>}
          />
        ))}
      </Table2>
      <div className="small muted audit-count">
        {rows.length} row{rows.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
