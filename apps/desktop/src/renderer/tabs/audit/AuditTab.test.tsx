import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AuditRow } from '@/api/types'
import { AuditFilters } from './AuditTab'
import { applyClientFilters, EMPTY_FILTERS, toQuery } from './auditFilters'

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: crypto.randomUUID(),
  at: '2026-09-26T10:00:00Z',
  actor_name: 'Dr. Maya Reyes',
  actor_kind: 'user',
  on_behalf_of: null,
  action: 'read',
  object_type: 'patient',
  patient_name: 'Gregory Hale',
  allowed: true,
  ran_on: null,
  ...over
})

describe('Audit filters', () => {
  it('sends patient, action and whole-day dates to the gateway', () => {
    const q = toQuery({
      ...EMPTY_FILTERS,
      patientId: 'p1',
      action: 'sign',
      range: [new Date(2026, 8, 20), new Date(2026, 8, 26)]
    })
    expect(q.patient_id).toBe('p1')
    expect(q.action).toBe('sign')
    expect(new Date(q.from!).getHours()).toBe(0)
    expect(new Date(q.to!).getHours()).toBe(23)
    expect(toQuery(EMPTY_FILTERS)).toEqual({
      patient_id: undefined,
      action: undefined,
      from: undefined,
      to: undefined
    })
  })

  it('filters AI steps and denials on the client', () => {
    const rows = [
      row({}),
      row({ actor_name: 'Resident', actor_kind: 'resident', ran_on: 'anthropic_api' }),
      row({ actor_name: 'Dr. Henry Wu', allowed: false })
    ]
    expect(applyClientFilters(rows, { aiOnly: true, deniedOnly: false }).map((r) => r.actor_name)).toEqual([
      'Resident'
    ])
    expect(applyClientFilters(rows, { aiOnly: false, deniedOnly: true }).map((r) => r.actor_name)).toEqual([
      'Dr. Henry Wu'
    ])
  })

  it('updates filters and clears them', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <AuditFilters
        value={EMPTY_FILTERS}
        onChange={onChange}
        patients={[{ id: 'p1', name: 'Gregory Hale', age: 64, sex: 'M', mrn: 'NS-004417' }]}
        actions={['read', 'sign']}
      />
    )
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'p1' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, patientId: 'p1' })
    fireEvent.click(screen.getByLabelText('AI steps only'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, aiOnly: true })
    expect(screen.queryByText('Clear filters')).toBeNull()

    rerender(
      <AuditFilters
        value={{ ...EMPTY_FILTERS, deniedOnly: true }}
        onChange={onChange}
        patients={[]}
        actions={[]}
      />
    )
    fireEvent.click(screen.getByText('Clear filters'))
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTERS)
  })
})
