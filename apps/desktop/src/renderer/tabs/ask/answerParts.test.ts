import { describe, expect, it } from 'vitest'
import type { Citation } from '@/api/types'
import { answerParts } from './answerParts'

const cite = (object_id: string): Citation => ({
  id: `Finding:${object_id}`,
  kind: 'finding',
  label: 'LUAD (pending review)',
  object_id,
  provenance: {
    source_system: 'lab-tech',
    source_ref: `Finding/${object_id}`,
    ingested_at: '2026-09-27T00:00:00Z'
  }
})

describe('answerParts', () => {
  it('turns tokens into citations, keeps bold, drops tokens with no visible citation', () => {
    const parts = answerParts('A **LUAD** finding [[obj:Finding:f1]]. Hidden [[obj:Note:n9]].', [cite('f1')])
    expect(parts).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'bold', text: 'LUAD' },
      { kind: 'text', text: ' finding ' },
      { kind: 'cite', citation: cite('f1') },
      { kind: 'text', text: '. Hidden ' },
      { kind: 'text', text: '.' }
    ])
  })

  it('never produces markup from text', () => {
    expect(answerParts('<img src=x>', [])).toEqual([{ kind: 'text', text: '<img src=x>' }])
  })
})
