import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Observation } from '@/api/types'
import { RecordsView } from './RecordsTab'
import { labFiles, noteFiles } from './recordsTree'

const prov = { source_system: 'ehr-a', source_ref: 'Observation/rv-1', ingested_at: '2026-09-26T00:00:00Z' }
const obs: Observation = {
  id: 'o1',
  category: 'laboratory',
  loinc_code: '2039-6',
  display: 'CEA',
  value_num: 6.8,
  value_text: null,
  unit: 'ng/mL',
  ref_low: 0,
  ref_high: 5,
  interpretation: 'H',
  effective_at: '2026-09-20T00:00:00Z',
  provenance: prov
}

describe('RecordsView', () => {
  it('browses folders to a file and shows its provenance', () => {
    render(
      <RecordsView
        patientName="Gregory Hale"
        sourceLabel={(s) => (s === 'ehr-a' ? 'Riverside' : s)}
        folders={{
          encounters: [],
          labs: labFiles([obs]),
          notes: noteFiles([
            {
              id: 'n1',
              kind: 'progress',
              title: 'COPD follow-up',
              body: 'Stable on albuterol.',
              author_name: 'Dr. One',
              effective_at: '2025-08-01T00:00:00Z',
              is_legal_record: true,
              status: 'final',
              provenance: { ...prov, source_ref: 'DocumentReference/rv-n1' }
            }
          ]),
          pathology: null
        }}
      />
    )
    // A folder that failed to load says so; it is not an empty folder.
    expect(screen.getByText('Unavailable')).toBeTruthy()

    fireEvent.click(screen.getByText('Labs'))
    fireEvent.click(screen.getByText('CEA'))
    fireEvent.click(screen.getByText(/6\.8 ng\/mL/))
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('Observation/rv-1')).toBeTruthy()
    expect(screen.getByText('Riverside')).toBeTruthy()

    fireEvent.click(screen.getByText('Notes'))
    fireEvent.click(screen.getByText(/COPD follow-up/))
    expect(screen.getByText('Stable on albuterol.')).toBeTruthy()
  })
})
