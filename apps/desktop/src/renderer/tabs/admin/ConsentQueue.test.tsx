import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ConsentTask } from '@/api/types'
import { ConsentQueue } from './ConsentQueue'

const task = (over: Partial<ConsentTask>): ConsentTask => ({
  id: crypto.randomUUID(),
  patient_id: 'p1',
  patient_name: 'Gregory Hale',
  patient_mrn: 'NS-004417',
  from_provider: 'Riverside Family Medicine',
  requested_by_name: 'Dr. Maya Reyes',
  status: 'requested',
  consent_ref: null,
  resources_imported: 0,
  created_at: new Date().toISOString(),
  completed_at: null,
  ...over
})

describe('ConsentQueue', () => {
  it('lists pending requests with a Review action and shows decided ones by status', () => {
    const pending = task({})
    const onReview = vi.fn<(t: ConsentTask) => void>()
    render(
      <ConsentQueue
        tasks={[
          pending,
          task({ patient_name: 'Linda Morales', status: 'fetched', consent_ref: 'Signed form #2240' }),
          task({
            patient_name: 'Priya Shah',
            status: 'merged',
            consent_ref: 'Signed form #2231',
            resources_imported: 214,
            completed_at: new Date().toISOString()
          }),
          task({
            patient_name: 'Linda Morales',
            status: 'denied',
            consent_ref: 'Refused by phone',
            completed_at: new Date().toISOString()
          })
        ]}
        onReview={onReview}
      />
    )
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Review'))!
    expect(row.textContent).toContain('Gregory Hale')
    expect(row.textContent).toContain('NS-004417')
    expect(row.textContent).toContain('Dr. Maya Reyes')
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }))
    expect(onReview).toHaveBeenCalledWith(pending)

    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(1)
    expect(screen.getByText('Recently decided')).toBeTruthy()
    expect(screen.getByText('Importing')).toBeTruthy()
    expect(screen.getByText('Merged · 214 records')).toBeTruthy()
    expect(screen.getByText('Denied')).toBeTruthy()
    expect(screen.getByText('Signed form #2231')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
  })

  it('shows a helpful empty state and hides the decided table when there is nothing', () => {
    render(<ConsentQueue tasks={[]} onReview={() => {}} />)
    expect(screen.getByText('No pending consent requests')).toBeTruthy()
    expect(screen.queryByText('Recently decided')).toBeNull()
  })
})
