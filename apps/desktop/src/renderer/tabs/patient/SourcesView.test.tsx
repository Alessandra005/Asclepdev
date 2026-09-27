import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Provenance, SourceChip } from '@/api/types'
import { SourcesPanel } from './SourcesView'

const from = (source_system: string): { provenance: Provenance } => ({
  provenance: { source_system, source_ref: 'x', ingested_at: '2026-01-01T00:00:00Z' }
})

describe('SourcesPanel', () => {
  it('counts records per source and never shows a failed load as zero', () => {
    render(
      <SourcesPanel
        sources={[
          { source_system: 'ehr-b', label: 'Northside', status: 'current' },
          { source_system: 'ehr-a', label: 'Riverside', status: 'merged' }
        ]}
        records={{
          labs: [from('ehr-a'), from('ehr-a'), from('ehr-a'), from('ehr-b')],
          meds: null,
          notes: [from('ehr-b'), from('ehr-b')]
        }}
        transfers={[
          {
            id: 't1',
            patient_id: 'p1',
            from_provider: 'Riverside Family Medicine',
            status: 'merged',
            consent_ref: 'Signed form #2231',
            resources_imported: 214,
            created_at: '2026-09-26T09:00:00Z',
            completed_at: '2026-09-26T09:05:00Z'
          }
        ]}
      />
    )
    const rows = screen.getAllByRole('row')
    expect(rows[1]!.textContent).toContain('Northside')
    expect(rows[1]!.textContent).toMatch(/1Unavailable2$/)
    expect(rows[2]!.textContent).toMatch(/3Unavailable0$/)
    expect(screen.getByText('Riverside Family Medicine')).toBeTruthy()
    expect(screen.getByText('Merged')).toBeTruthy()
    expect(screen.getByText('Merged · 214 records')).toBeTruthy()
  })

  it('never shows a loading or failed transfer list as "No transfer requested"', () => {
    const sources: SourceChip[] = [{ source_system: 'ehr-b', label: 'Northside', status: 'current' }]
    const records = { labs: [], meds: [], notes: [] }
    const { rerender } = render(<SourcesPanel sources={sources} records={records} transfers={undefined} />)
    expect(screen.queryByText('No transfer requested.')).toBeNull()
    rerender(<SourcesPanel sources={sources} records={records} transfers={null} />)
    expect(screen.getByText('Transfers unavailable.')).toBeTruthy()
    expect(screen.queryByText('No transfer requested.')).toBeNull()
    rerender(<SourcesPanel sources={sources} records={records} transfers={[]} />)
    expect(screen.getByText('No transfer requested.')).toBeTruthy()
  })
})
