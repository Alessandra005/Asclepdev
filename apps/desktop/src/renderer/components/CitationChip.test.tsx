import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CitationChip } from './CitationChip'
import { useUi } from '@/state/ui'
import { CITATIONS } from '@/api/mock/data'

describe('CitationChip', () => {
  it('opens the source drawer for its citation', () => {
    useUi.getState().openSource(null)
    render(<CitationChip citation={CITATIONS['c-smoking']!} />)
    fireEvent.click(screen.getByText('Smoking history'))
    expect(useUi.getState().sourceCitationId).toBe('c-smoking')
  })
})
