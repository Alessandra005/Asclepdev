import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Finding } from '@/api/types'
import { FindingsPanel } from './FindingsView'

const finding = (over: Partial<Finding>): Finding => ({
  id: crypto.randomUUID(),
  patient_id: 'p1',
  slide_id: 's1',
  specimen_label: 'Lung biopsy, RUL',
  label: 'LUAD',
  label_display: 'LUAD / adenocarcinoma',
  confidence: 0.87,
  model_name: 'CONCH',
  model_version: 'v1',
  flags: [],
  status: 'pending_review',
  final_label: null,
  review_note: null,
  reviewed_by: null,
  reviewed_at: null,
  thumbnail_url: null,
  heatmap_url: null,
  tile_urls: [],
  provenance: { source_system: 'asclep', source_ref: 'Finding/1', ingested_at: '2026-01-01T00:00:00Z' },
  ...over
})

describe('FindingsPanel', () => {
  it('labels pending findings as unverified and sends review to the Lab tab', () => {
    const onOpenLab = vi.fn()
    render(<FindingsPanel findings={[finding({})]} onOpenLab={onOpenLab} />)
    expect(screen.getByText('Unverified AI finding')).toBeTruthy()
    expect(screen.getByText('87%')).toBeTruthy()
    expect(screen.getByText('Not yet')).toBeTruthy()
    fireEvent.click(screen.getByText('Review in Lab'))
    expect(onOpenLab).toHaveBeenCalled()
  })

  it('shows the reviewer and the override label once the gateway has recorded it', () => {
    render(
      <FindingsPanel
        onOpenLab={() => {}}
        findings={[
          finding({
            status: 'overridden',
            final_label: 'LUSC',
            reviewed_by: 'Dr. Maya Reyes',
            reviewed_at: '2026-09-26T00:00:00Z'
          })
        ]}
      />
    )
    expect(screen.getByText('Overridden to LUSC')).toBeTruthy()
    expect(screen.getByText(/Dr\. Maya Reyes/)).toBeTruthy()
    expect(screen.getByText('Open in Lab')).toBeTruthy()
  })
})
