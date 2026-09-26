import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReviewPanel } from './ReviewPanel'
import { GREGORY_FINDING } from '@/api/mock/data'
import type { ReviewRequest } from '@/api/types'

describe('ReviewPanel', () => {
  it('shows the unverified callout and original confidence', () => {
    render(<ReviewPanel finding={GREGORY_FINDING} canReview submitting={false} onSubmit={() => {}} />)
    expect(screen.getByText('AI finding, unverified')).toBeTruthy()
    expect(screen.getByTestId('confidence').textContent).toBe('87%')
  })

  it('confirm sends action=confirm without a note', () => {
    const onSubmit = vi.fn<(r: ReviewRequest) => void>()
    render(<ReviewPanel finding={GREGORY_FINDING} canReview submitting={false} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Confirm'))
    expect(onSubmit).toHaveBeenCalledWith({ action: 'confirm' })
  })

  it('disables actions for users who cannot sign', () => {
    render(<ReviewPanel finding={GREGORY_FINDING} canReview={false} submitting={false} onSubmit={() => {}} />)
    expect(screen.getByText('Confirm').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Only the attending physician can sign findings.')).toBeTruthy()
  })

  it('shows the reviewer after confirmation', () => {
    const f = {
      ...GREGORY_FINDING,
      status: 'confirmed' as const,
      reviewed_by: 'Dr. Maya Reyes',
      reviewed_at: new Date().toISOString()
    }
    render(<ReviewPanel finding={f} canReview submitting={false} onSubmit={() => {}} />)
    expect(screen.getByText('Confirmed by Dr. Maya Reyes')).toBeTruthy()
    expect(screen.queryByText('Confirm')).toBeNull()
  })
})
