import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConsentDecision, ConsentTask } from '@/api/types'
import { GatewayError } from '@/api/errors'
import { ConsentDialog } from './ConsentDialog'

const task: ConsentTask = {
  id: 'tr-1',
  patient_id: 'p1',
  patient_name: 'Gregory Hale',
  patient_mrn: 'NS-004417',
  from_provider: 'Riverside Family Medicine',
  requested_by_name: 'Dr. Maya Reyes',
  status: 'requested',
  consent_ref: null,
  resources_imported: 0,
  created_at: new Date().toISOString(),
  completed_at: null
}

const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement

describe('ConsentDialog', () => {
  it('keeps both decisions disabled until a consent reference is typed', () => {
    render(
      <ConsentDialog
        isOpen
        task={task}
        submitting={false}
        error={null}
        onSubmit={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Gregory Hale')).toBeTruthy()
    expect(screen.getByText('NS-004417')).toBeTruthy()
    expect(button('Record consent').disabled).toBe(true)
    expect(button('Deny').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Consent reference/), { target: { value: '   ' } })
    expect(button('Record consent').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Consent reference/), { target: { value: 'Signed form #2231' } })
    expect(button('Record consent').disabled).toBe(false)
    expect(button('Deny').disabled).toBe(false)
  })

  it('records consent with the trimmed reference', () => {
    const onSubmit = vi.fn<(d: ConsentDecision) => void>()
    render(
      <ConsentDialog
        isOpen
        task={task}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onClose={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText(/Consent reference/), {
      target: { value: '  Signed form #2231 ' }
    })
    fireEvent.click(button('Record consent'))
    expect(onSubmit).toHaveBeenCalledWith({ consent_ref: 'Signed form #2231', granted: true })
  })

  it('denies with granted false, and shows a gateway error without closing', () => {
    const onSubmit = vi.fn<(d: ConsentDecision) => void>()
    const onClose = vi.fn()
    const error = new GatewayError(409, 'CONFLICT', 'This request was already decided.', 'req_1')
    render(
      <ConsentDialog
        isOpen
        task={task}
        submitting={false}
        error={error}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    )
    fireEvent.change(screen.getByLabelText(/Consent reference/), { target: { value: 'Patient declined' } })
    fireEvent.click(button('Deny'))
    expect(onSubmit).toHaveBeenCalledWith({ consent_ref: 'Patient declined', granted: false })
    expect(screen.getByText('This request was already decided.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returns focus to the Review button on close and starts the next review empty', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Review</button>
          <ConsentDialog
            isOpen={open}
            task={task}
            submitting={false}
            error={null}
            onSubmit={() => {}}
            onClose={() => setOpen(false)}
          />
        </>
      )
    }
    render(<Harness />)
    const opener = button('Review')
    for (let round = 0; round < 2; round++) {
      opener.focus()
      fireEvent.click(opener)
      const input = (await screen.findByLabelText(/Consent reference/)) as HTMLInputElement
      expect(input.value).toBe('')
      fireEvent.change(input, { target: { value: 'Signed form #2231' } })
      fireEvent.click(button('Cancel'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(opener)
    }
  })
})
