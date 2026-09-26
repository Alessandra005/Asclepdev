import type { ReactNode } from 'react'
import { Button, NonIdealState } from '@blueprintjs/core'
import { usePatient } from '@/api/hooks'
import type { Patient } from '@/api/types'
import { useUi } from '@/state/ui'
import { QueryState } from './QueryState'
import { PatientHeader } from './PatientHeader'

/** Patient, Lab and Ask follow the global selected patient. */
export function RequirePatient({ children }: { children: (p: Patient) => ReactNode }) {
  const id = useUi((s) => s.selectedPatientId)
  const setSearchOpen = useUi((s) => s.setSearchOpen)
  const q = usePatient(id)
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
