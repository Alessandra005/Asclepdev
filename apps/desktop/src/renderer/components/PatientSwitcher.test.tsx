import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PatientSwitcherMenu } from './PatientSwitcher'

const items = [
  { id: 'g', name: 'Gregory Hale', age: 64, sex: 'M' as const, mrn: 'NS-004417' },
  { id: 'l', name: 'Linda Morales', age: 71, sex: 'F' as const, mrn: 'NS-002981' }
]

describe('PatientSwitcherMenu', () => {
  it('lists care-team patients, marks the current one and switches on click', () => {
    const onPick = vi.fn()
    const onSearch = vi.fn()
    render(
      <PatientSwitcherMenu
        currentId="g"
        list={{ data: { items, next_cursor: null }, isPending: false, isError: false }}
        onPick={onPick}
        onSearch={onSearch}
      />
    )
    fireEvent.click(screen.getByText('Gregory Hale'))
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Linda Morales'))
    expect(onPick).toHaveBeenCalledWith('l')
    fireEvent.click(screen.getByText('Search all patients'))
    expect(onSearch).toHaveBeenCalled()
  })

  it('says so when the list fails instead of showing an empty menu', () => {
    render(
      <PatientSwitcherMenu
        currentId="g"
        list={{ data: undefined, isPending: false, isError: true }}
        onPick={() => {}}
        onSearch={() => {}}
      />
    )
    expect(screen.getByText('Could not load your patients.')).toBeTruthy()
  })
})
