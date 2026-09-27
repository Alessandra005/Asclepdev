import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DemoPing } from '@/api/client'
import { DemoServerPicker } from './DemoServerPicker'

const ping = (urls: string[] = ['http://192.168.1.20:8787']) =>
  vi.fn(async (): Promise<DemoPing> => ({ ok: true, host: 'daniel-pc', urls }))

describe('DemoServerPicker', () => {
  it('joins a host only after it answers, normalizing a bare IP', async () => {
    const onChange = vi.fn()
    const p = ping()
    render(<DemoServerPicker value={null} onChange={onChange} ping={p} hosting={false} />)
    fireEvent.click(screen.getByText('Shared with team'))
    expect(screen.getByText(/Until then, sign-in uses this computer/)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Host address'), { target: { value: ' 192.168.1.20 ' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => expect(screen.getByText('Connected to daniel-pc')).toBeTruthy())
    expect(p).toHaveBeenCalledWith('http://192.168.1.20:8787')
    expect(onChange).toHaveBeenCalledWith('http://192.168.1.20:8787')
  })

  it('stays on this computer when the host does not answer', async () => {
    const onChange = vi.fn()
    const p = vi.fn(async (): Promise<DemoPing> => {
      throw new Error('No Asclep demo server answered at http://10.0.0.9:8787.')
    })
    render(<DemoServerPicker value={null} onChange={onChange} ping={p} hosting={false} />)
    fireEvent.click(screen.getByText('Shared with team'))
    fireEvent.change(screen.getByLabelText('Host address'), { target: { value: '10.0.0.9' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => expect(screen.getByText(/No Asclep demo server answered/)).toBeTruthy())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the host the addresses to share, and switching back clears the server', async () => {
    const onChange = vi.fn()
    render(<DemoServerPicker value="http://localhost:8787" onChange={onChange} ping={ping()} hosting />)
    await waitFor(() => expect(screen.getByText(/Teammates join with/)).toBeTruthy())
    expect(screen.getByText(/http:\/\/192\.168\.1\.20:8787/)).toBeTruthy()
    fireEvent.click(screen.getByText('This computer'))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
