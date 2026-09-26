import { Button, Menu, MenuDivider, MenuItem, Popover } from '@blueprintjs/core'
import type { UseQueryResult } from '@tanstack/react-query'
import { usePatientSearch } from '@/api/hooks'
import type { ListResponse, Patient, PatientListItem } from '@/api/types'
import { useUi } from '@/state/ui'

const MAX = 8

/** Patient name in the header doubles as a switcher, so changing patients never needs the Dashboard. */
export function PatientSwitcher({ patient }: { patient: Patient }) {
  const list = usePatientSearch('')
  const activeTab = useUi((s) => s.activeTab)
  const openPatient = useUi((s) => s.openPatient)
  const setSearchOpen = useUi((s) => s.setSearchOpen)
  return (
    <Popover
      placement="bottom-start"
      minimal
      content={
        <PatientSwitcherMenu
          currentId={patient.id}
          list={list}
          onPick={(id) => openPatient(id, activeTab)}
          onSearch={() => setSearchOpen(true)}
        />
      }
    >
      <h1 className="patient-name">
        <Button
          variant="minimal"
          endIcon="caret-down"
          className="patient-switch"
          text={patient.name}
          aria-label={`${patient.name}, switch patient`}
        />
      </h1>
    </Popover>
  )
}

export function PatientSwitcherMenu({
  currentId,
  list,
  onPick,
  onSearch
}: {
  currentId: string
  list: Pick<UseQueryResult<ListResponse<PatientListItem>>, 'data' | 'isPending' | 'isError'>
  onPick: (id: string) => void
  onSearch: () => void
}) {
  const items = list.data?.items ?? []
  return (
    <Menu className="patient-switch-menu">
      {list.isPending && <MenuItem disabled text="Loading patients..." />}
      {list.isError && <MenuItem disabled icon="error" text="Could not load your patients." />}
      {!list.isPending && !list.isError && items.length === 0 && (
        <MenuItem disabled text="No patients on your care team." />
      )}
      {items.slice(0, MAX).map((p) => (
        <MenuItem
          key={p.id}
          icon={p.id === currentId ? 'tick' : 'person'}
          active={p.id === currentId}
          text={p.name}
          label={p.mrn}
          onClick={() => p.id !== currentId && onPick(p.id)}
        />
      ))}
      <MenuDivider />
      <MenuItem icon="search" text="Search all patients" label="Ctrl+K" onClick={onSearch} />
    </Menu>
  )
}
