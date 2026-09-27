import type { ReactNode } from 'react'
import { Button, NonIdealState } from '@blueprintjs/core'
import { useEmergencyAccess, usePatient } from '@/api/hooks'
import { GatewayError } from '@/api/errors'
import type { Patient } from '@/api/types'
import { useSession } from '@/state/session'
import { useUi } from '@/state/ui'
import { EmergencyAccess } from './EmergencyAccess'
import { QueryState } from './QueryState'
import { PatientHeader } from './PatientHeader'

/** Patient, Lab and Ask follow the global selected patient. */
export function RequirePatient({ children }: { children: (p: Patient) => ReactNode }) {
  const id = useUi((s) => s.selectedPatientId)
  const setSearchOpen = useUi((s) => s.setSearchOpen)
  const q = usePatient(id)
  const canBreakGlass = useSession((s) => s.permissions.includes('emergency_access'))
  const grant = useEmergencyAccess(id ?? '')
  if (!id) {
    return (
      <NonIdealState
        icon="person"
        title="No patient selected"
        description="Open a patient from the Dashboard or search with Ctrl / Cmd + K."
        action={<Button icon="search" text="Search patients" onClick={() => setSearchOpen(true)} />}
      />
    )
  }
  const offTeam = q.error instanceof GatewayError && q.error.code === 'FORBIDDEN_NOT_ON_CARE_TEAM'
  if (offTeam && canBreakGlass) {
    return (
      <EmergencyAccess submitting={grant.isPending} error={grant.error} onSubmit={(r) => grant.mutate(r)} />
    )
  }
  return (
    <QueryState query={q}>
      {(p) => (
        <>
          <PatientHeader patient={p} />
          {children(p)}
        </>
      )}
    </QueryState>
  )
}
