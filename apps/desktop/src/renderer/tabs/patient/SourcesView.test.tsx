import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Provenance } from '@/api/types'
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
        transfers={[{ id: 't1', from_provider: 'Riverside Family Medicine', status: 'merged' }]}
      />
    )
    const rows = screen.getAllByRole('row')
    expect(rows[1]!.textContent).toContain('Northside')
    expect(rows[1]!.textContent).toMatch(/1Unavailable2$/)
    expect(rows[2]!.textContent).toMatch(/3Unavailable0$/)
    expect(screen.getByText('Riverside Family Medicine')).toBeTruthy()
    expect(screen.getAllByText('Merged')).toHaveLength(2)
  })
})
