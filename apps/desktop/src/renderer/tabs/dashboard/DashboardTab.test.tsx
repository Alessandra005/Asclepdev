import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardView } from './DashboardTab'

describe('Dashboard', () => {
  it('shows a helpful empty state', () => {
    render(
      <DashboardView
        data={{ attention: [], schedule: [], tasks: [], recent_patients: [], supply_watch: [] }}
      />
    )
    expect(screen.getByText('Nothing needs you right now')).toBeTruthy()
  })
})
