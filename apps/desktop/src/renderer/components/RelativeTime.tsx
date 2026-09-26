import { Tooltip } from '@blueprintjs/core'

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86_400), 'day')
}

/** Spec 14.5: relative time with the exact time in a Tooltip. */
export function RelativeTime({ iso }: { iso: string }) {
  return (
    <Tooltip content={new Date(iso).toLocaleString()} compact>
      <span className="reltime">{relative(iso)}</span>
    </Tooltip>
  )
}

export const clockTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
