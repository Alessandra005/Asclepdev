import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Observation } from '@/api/types'
import { LabTrendChart, toPoints } from './LabTrendChart'

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const base: Observation = {
  id: 'o1',
  category: 'laboratory',
  loinc_code: '2039-6',
  display: 'CEA',
  value_num: 4.2,
  value_text: null,
  unit: 'ng/mL',
  ref_low: 0,
  ref_high: 5,
  interpretation: 'N',
  effective_at: '2025-06-01T00:00:00Z',
  provenance: { source_system: 'ehr-a', source_ref: 'Observation/1', ingested_at: '2026-01-01T00:00:00Z' }
}

describe('LabTrendChart', () => {
  it('drops results with no number or date and sorts oldest first', () => {
    const pts = toPoints([
      base,
      { ...base, id: 'o2', value_num: 2.1, effective_at: '2017-06-01T00:00:00Z' },
      { ...base, id: 'o3', value_num: null, value_text: 'hemolyzed' },
      { ...base, id: 'o4', effective_at: null }
    ])
    expect(pts.map((p) => p.v)).toEqual([2.1, 4.2])
  })

  it('names the reference range in text, not only as a shaded band', () => {
    render(<LabTrendChart series={[base]} sourceLabel={(s) => s} />)
    expect(screen.getByText(/reference range 0–5 ng\/mL/)).toBeTruthy()
  })
})
