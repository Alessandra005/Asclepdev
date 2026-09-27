import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { RecordsTree, SourceRecord } from '@/api/types'

const sourceRecord = vi.fn()
vi.mock('@/api/hooks', () => ({ useSourceRecord: (id: string | null) => sourceRecord(id) }))
const { RecordsView } = await import('./RecordsTab')

const prov = { source_system: 'ehr-a', source_ref: 'gregory-a-lab-2025', ingested_at: '2026-09-26T00:00:00Z' }
const folders: RecordsTree['folders'] = [
  {
    name: 'Labs',
    items: [
      {
        type: 'Observation',
        id: 'o1',
        title: 'Glucose: 110.0 mg/dL',
        effective_at: '2025-03-02T00:00:00Z',
        source_system: 'ehr-a'
      },
      {
        type: 'Observation',
        id: 'o2',
        title: 'Glucose: 108.0 mg/dL',
        effective_at: '2024-03-02T00:00:00Z',
        source_system: 'ehr-a'
      }
    ]
  },
  { name: 'Allergies', items: [] }
]
const rec: SourceRecord = {
  citation: {
    id: 'Observation:o1',
    kind: 'observation',
    label: 'Glucose: 110.0 mg/dL',
    object_id: 'o1',
    provenance: prov
  },
  title: 'Glucose: 110.0 mg/dL',
  body: 'Glucose: 110.0 mg/dL. Recorded by Riverside.',
  recorded_at: '2025-03-02T00:00:00Z'
}

describe('RecordsView', () => {
  it('browses Labs > test group to a file and reads it through /sources with provenance', () => {
    sourceRecord.mockImplementation((id: string | null) =>
      id
        ? { isPending: false, isError: false, data: rec }
        : { isPending: true, isError: false, data: undefined }
    )
    render(
      <RecordsView
        patientName="Gregory Hale"
        folders={folders}
        sourceLabel={(s) => (s === 'ehr-a' ? 'Riverside' : s)}
      />
    )
    expect(screen.getByText('Pick a record')).toBeTruthy()
    fireEvent.click(screen.getByText('Labs'))
    fireEvent.click(screen.getByText('Glucose'))
    fireEvent.click(screen.getByText('Glucose: 110.0 mg/dL'))
    expect(sourceRecord).toHaveBeenLastCalledWith('Observation:o1')
    expect(screen.getByText('Glucose: 110.0 mg/dL. Recorded by Riverside.')).toBeTruthy()
    expect(screen.getByText('Riverside')).toBeTruthy()
    expect(screen.getByText('gregory-a-lab-2025')).toBeTruthy()
  })
})
