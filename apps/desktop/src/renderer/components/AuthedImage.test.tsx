import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const fileBlob = vi.fn()
vi.mock('@/api/hooks', () => ({ useFileBlob: (u: string) => fileBlob(u) }))
const { AuthedImage } = await import('./AuthedImage')

describe('AuthedImage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the fetched blob and revokes its URL on unmount', () => {
    const create = vi.fn(() => 'blob:heatmap')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    fileBlob.mockReturnValue({ data: new Blob(['png']), isError: false })
    const { unmount } = render(<AuthedImage url="/api/v1/files/heatmaps/s1.png" alt="Model heatmap" />)
    expect(fileBlob).toHaveBeenCalledWith('/api/v1/files/heatmaps/s1.png')
    expect((screen.getByAltText('Model heatmap') as HTMLImageElement).src).toBe('blob:heatmap')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:heatmap')
  })

  it('says so when the image cannot be loaded', () => {
    fileBlob.mockReturnValue({ data: undefined, isError: true })
    render(<AuthedImage url="/api/v1/files/tiles/s1_0.jpg" alt="Evidence tile 1" />)
    expect(screen.getByText('Image unavailable')).toBeTruthy()
  })
})
