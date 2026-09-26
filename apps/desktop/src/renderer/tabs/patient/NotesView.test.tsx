import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Note } from '@/api/types'
import { NotesPanel } from './NotesView'

const note = (over: Partial<Note>): Note => ({
  id: crypto.randomUUID(),
  kind: 'progress',
  title: 'COPD follow-up',
  body: 'Stable on albuterol.',
  author_name: 'Dr. One',
  effective_at: '2025-08-01T00:00:00Z',
  is_legal_record: true,
  status: 'final',
  provenance: {
    source_system: 'ehr-a',
    source_ref: 'DocumentReference/1',
    ingested_at: '2026-01-01T00:00:00Z'
  },
  ...over
})

describe('NotesPanel', () => {
  it('opens the newest note first and marks Scribe notes as outside the legal record', () => {
    render(
      <NotesPanel
        sourceLabel={(s) => ({ 'ehr-a': 'Riverside', asclep: 'Asclep' })[s] ?? s}
        notes={[
          note({}),
          note({
            kind: 'visual_scribe',
            title: 'Visit observations (Scribe)',
            body: 'Coughed 3 times [00:00:13]',
            effective_at: '2026-09-26T00:00:00Z',
            is_legal_record: false,
            provenance: { source_system: 'asclep', source_ref: 'ScribeSession/1', ingested_at: 'x' }
          })
        ]}
      />
    )
    expect(screen.getByText('Coughed 3 times [00:00:13]')).toBeTruthy()
    expect(screen.getByText('Not part of the legal record')).toBeTruthy()

    fireEvent.click(screen.getByText('COPD follow-up'))
    expect(screen.getByText('Stable on albuterol.')).toBeTruthy()
    expect(screen.queryByText('Not part of the legal record')).toBeNull()
  })
})
