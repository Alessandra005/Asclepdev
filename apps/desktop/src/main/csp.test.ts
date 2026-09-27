// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('index.html Content-Security-Policy', () => {
  const html = readFileSync(resolve(__dirname, '../renderer/index.html'), 'utf8')
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
  const directive = (name: string): string =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(name + ' ')) ?? ''

  it('lets the app reach a gateway or shared demo server that is not on localhost', () => {
    // A teammate's shared demo server is a LAN IP (http) or a tunnel link (https).
    expect(directive('connect-src').split(/\s+/)).toEqual(expect.arrayContaining(['http:', 'https:']))
  })

  it('still only runs the app’s own scripts', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
  })
})
