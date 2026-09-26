import { Tag } from '@blueprintjs/core'
import type { Patient } from '@/api/types'
import { PatientSwitcher } from './PatientSwitcher'

/** Shared header for Patient, Lab and Ask. Allergy status "unknown" is never shown as "none". */
export function PatientHeader({ patient }: { patient: Patient }) {
  return (
    <div className="patient-header">
      <PatientSwitcher patient={patient} />
      <span className="muted">
        {patient.age} years &nbsp;|&nbsp; {patient.sex} &nbsp;|&nbsp; MRN{' '}
        <span className="mono">{patient.mrn}</span>
      </span>
      <span className="spacer" />
      {patient.allergy_status === 'recorded' &&
        patient.allergies.map((a) => (
          <Tag key={a.substance} intent="danger" icon="warning-sign">
            {a.substance} allergy
          </Tag>
        ))}
      {patient.allergy_status === 'unknown' && (
        <Tag minimal intent="warning">
          Allergies: unknown
        </Tag>
      )}
      {patient.allergy_status === 'none_known' && <Tag minimal>No known allergies</Tag>}
      {patient.sources.map((s) => (
        <Tag
          key={s.source_system}
          minimal
          intent={s.status === 'merged' ? 'success' : 'none'}
          icon="database"
        >
          {s.label}
        </Tag>
      ))}
    </div>
  )
}
