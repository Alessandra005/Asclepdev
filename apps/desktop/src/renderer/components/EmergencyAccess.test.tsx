import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmergencyAccess } from './EmergencyAccess'

const submit = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Open chart for 60 minutes' }) as HTMLButtonElement

describe('EmergencyAccess', () => {
  it('requires a reason before requesting access, then sends it trimmed', () => {
    const onSubmit = vi.fn()
    render(<EmergencyAccess submitting={false} error={null} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Emergency access' }))
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Clinical reason/), { target: { value: '  ok ' } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Clinical reason/), { target: { value: '  Patient in ED  ' } })
    fireEvent.click(submit())
    expect(onSubmit).toHaveBeenCalledWith('Patient in ED')
  })
})
