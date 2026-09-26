import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MedicationRequest } from '@/api/types'
import { MedsPanel } from './MedsView'

const med = (over: Partial<MedicationRequest>): MedicationRequest => ({
  id: crypto.randomUUID(),
  medication: 'Albuterol inhaler 90 mcg',
  status: 'active',
  dosage_text: '2 puffs as needed',
  effective_at: '2025-01-01T00:00:00Z',
  inventory: { status: 'in_stock', on_hand: 40, expected_restock_at: null },
  provenance: {
    source_system: 'ehr-a',
    source_ref: 'MedicationRequest/1',
    ingested_at: '2026-01-01T00:00:00Z'
  },
  ...over
})

describe('MedsPanel', () => {
  it('shows inventory status and never assumes stock when there is no inventory row', () => {
    const restock = new Date(Date.now() + 6 * 86_400_000).toISOString()
    render(
      <MedsPanel
        sourceLabel={(s) => (s === 'ehr-a' ? 'Riverside' : s)}
        meds={[
          med({}),
          med({
            medication: 'Pembrolizumab 100 mg/4 mL',
            inventory: { status: 'backordered', on_hand: 0, expected_restock_at: restock }
          }),
          med({ medication: 'Tiotropium', inventory: null, dosage_text: null })
        ]}
      />
    )
    expect(screen.getByText('In stock (40)')).toBeTruthy()
    expect(screen.getByText(/Backordered, restock in 6 days/)).toBeTruthy()
    expect(screen.getByText('Not tracked')).toBeTruthy()
    expect(screen.getByText('Not given')).toBeTruthy()
    expect(screen.getAllByText('Riverside')).toHaveLength(3)
  })
})
