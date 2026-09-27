import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ScribeAction } from '@/api/types'
import { ActionChecklist, LiveTimeline } from './LiveScribeParts'

const action = (over: Partial<ScribeAction>): ScribeAction => ({
  id: 'a1',
  action: 'Coughed 3 times, covered mouth with right hand',
  times: ['00:00:23'],
  why_relevant: 'Coughing seen during the visit.',
  confidence: 'high',
  source: 'visual',
  included: false,
  ...over
})

describe('LiveTimeline', () => {
  it('interleaves what was said and seen by session time', () => {
    render(
      <LiveTimeline
        empty="Waiting"
        transcript={[{ t: '00:00:25', end: '00:00:29', text: 'Some chest pain when I cough.' }]}
        observations={[{ t: '00:00:23', category: 'cough', text: 'Coughed 3 times', confidence: 0.9 }]}
      />
    )
    const rows = screen.getAllByRole('row').map((r) => r.textContent)
    expect(rows[0]).toContain('Coughed 3 times')
    expect(rows[1]).toContain('said')
  })

  it('shows the empty text before the first window', () => {
    render(<LiveTimeline empty="Waiting for the first window..." transcript={[]} observations={[]} />)
    expect(screen.getByText('Waiting for the first window...')).toBeTruthy()
  })
})

describe('ActionChecklist', () => {
  it('lets the attending check which possible symptoms to keep', () => {
    const onToggle = vi.fn<(id: string) => void>()
    render(
      <ActionChecklist
        actions={[action({}), action({ id: 'a2', action: 'Mentioned chest pain', source: 'conversation' })]}
        selected={new Set(['a2'])}
        onToggle={onToggle}
        canChoose
      />
    )
    const first = screen.getByLabelText('Keep in report: Coughed 3 times, covered mouth with right hand')
    expect((first as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Keep in report: Mentioned chest pain') as HTMLInputElement).checked).toBe(
      true
    )
    fireEvent.click(first)
    expect(onToggle).toHaveBeenCalledWith('a1')
    expect(screen.getByText('said')).toBeTruthy()
  })

  it('is read-only for users who cannot choose', () => {
    render(
      <ActionChecklist actions={[action({})]} selected={new Set()} onToggle={() => {}} canChoose={false} />
    )
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
  })
})
