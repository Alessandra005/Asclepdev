import { describe, expect, it } from 'vitest'
import { requestButton, transferStatus } from './transferStatus'

describe('transferStatus', () => {
  it('words every spec 11 state the same way everywhere', () => {
    const at = (status: Parameters<typeof transferStatus>[0]['status'], resources_imported = 0) =>
      transferStatus({ status, resources_imported })
    expect(at('requested')).toEqual({ text: 'Awaiting admin consent', intent: 'warning' })
    expect(at('consented').text).toBe('Importing')
    expect(at('fetched').text).toBe('Importing')
    expect(at('merged', 214)).toEqual({ text: 'Merged · 214 records', intent: 'success' })
    expect(at('merged', 1).text).toBe('Merged · 1 record')
    expect(at('denied')).toEqual({ text: 'Consent denied', intent: 'danger' })
  })

  it('locks the Request records button while a request is open, and frees it after a denial', () => {
    expect(requestButton(undefined)).toEqual({ text: 'Request records', disabled: false })
    expect(requestButton({ status: 'requested' })).toEqual({ text: 'Waiting for consent...', disabled: true })
    expect(requestButton({ status: 'fetched' })).toEqual({ text: 'Importing records...', disabled: true })
    expect(requestButton({ status: 'denied' })).toEqual({ text: 'Request records', disabled: false })
    expect(requestButton({ status: 'merged' })).toBeNull()
  })
})
