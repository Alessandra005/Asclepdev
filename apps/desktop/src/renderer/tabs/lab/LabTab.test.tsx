import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSession } from '@/state/session'
import { LabTab, ReportSentences } from './LabTab'

describe('LabTab', () => {
  it('tells a nurse the Lab tab is not for their role instead of calling the gateway', () => {
    useSession.getState().setMe('nurse', ['authenticated', 'view_labs'])
    render(<LabTab />)
    expect(screen.getByText('The Lab tab is for physicians and lab staff')).toBeTruthy()
  })
  it('renders report headings as section labels and kind-less items as sentences', () => {
    const { container } = render(
      <ReportSentences
        sentences={[
          { text: 'AI finding (unverified)', citation_ids: [], kind: 'heading' },
          { text: 'LUAD, model confidence 0.82.', citation_ids: ['c1'] }
        ]}
      />
    )
    expect(container.querySelector('.label')?.textContent).toBe('AI finding (unverified)')
    expect(container.querySelector('p')?.textContent).toBe('LUAD, model confidence 0.82.')
  })
})
