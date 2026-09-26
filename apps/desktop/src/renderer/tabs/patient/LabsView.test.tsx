import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Observation } from '@/api/types'
import { LabsPanel } from './LabsView'

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const obs = (over: Partial<Observation>): Observation => ({
  id: crypto.randomUUID(),
  category: 'laboratory',
  loinc_code: '718-7',
  display: 'Hemoglobin',
  value_num: 14,
  value_text: null,
  unit: 'g/dL',
  ref_low: 13.5,
  ref_high: 17.5,
  interpretation: 'N',
  effective_at: '2025-01-01T00:00:00Z',
  provenance: { source_system: 'ehr-a', source_ref: 'Observation/1', ingested_at: '2026-01-01T00:00:00Z' },
  ...over
})
const label = (s: string): string => ({ 'ehr-a': 'Riverside', 'ehr-b': 'Northside' })[s] ?? s

describe('LabsPanel', () => {
  it('shows the latest value per test and flags it only when the source did', () => {
    render(
      <LabsPanel
        sourceLabel={label}
        observations={[
          obs({ value_num: 15.2, effective_at: '2020-01-01T00:00:00Z' }),
          obs({
            value_num: 13.1,
            interpretation: 'L',
            effective_at: '2026-09-20T00:00:00Z',
            provenance: { source_system: 'ehr-b', source_ref: 'x', ingested_at: 'x' }
          }),
          obs({
            loinc_code: '2160-0',
            display: 'Creatinine',
            value_num: 1,
            unit: 'mg/dL',
            interpretation: null,
            ref_low: null,
            ref_high: null
          })
        ]}
      />
    )
    expect(screen.getByText('13.1 g/dL')).toBeTruthy()
    expect(screen.queryByText('15.2 g/dL')).toBeNull()
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText('Northside')).toBeTruthy()
    // Unflagged and no range: nothing is invented.
    expect(screen.getByText('Not given')).toBeTruthy()
    expect(screen.queryByText('Normal')).toBeNull()
    // The flagged test is selected first; its trend has two results.
    expect(screen.getByText('Hemoglobin trend')).toBeTruthy()
    expect(screen.getByText('2 results')).toBeTruthy()
  })

  it('switches the trend when another test is picked', () => {
    render(
      <LabsPanel
        sourceLabel={label}
        observations={[obs({}), obs({ loinc_code: '2039-6', display: 'CEA', value_num: 6.8, unit: 'ng/mL' })]}
      />
    )
    fireEvent.click(screen.getByText('CEA'))
    expect(screen.getByText('CEA trend')).toBeTruthy()
    expect(screen.getByText(/One result so far/)).toBeTruthy()
  })
})
