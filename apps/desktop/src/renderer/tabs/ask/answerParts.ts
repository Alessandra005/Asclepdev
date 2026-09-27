import type { Citation } from '@/api/types'

export type AnswerPart =
  { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'cite'; citation: Citation }

const TOKEN = /\[\[obj:\w+:([^\]]+)\]\]|\*\*(.+?)\*\*/g

/**
 * Splits answer_md into text, **bold** and [[obj:Type:uuid]] citation tokens (spec 10.1).
 * Tokens resolve against citations[] by object_id; a token with no matching citation was filtered
 * out by the gateway (not visible to this user), so it is dropped rather than shown raw.
 */
export function answerParts(md: string, citations: Citation[]): AnswerPart[] {
  const byId = new Map(citations.map((c) => [c.object_id, c]))
  const parts: AnswerPart[] = []
  let last = 0
  for (const m of md.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ kind: 'text', text: md.slice(last, m.index) })
    if (m[2] !== undefined) parts.push({ kind: 'bold', text: m[2] })
    else {
      const c = byId.get(m[1]!)
      if (c) parts.push({ kind: 'cite', citation: c })
    }
    last = m.index + m[0].length
  }
  if (last < md.length) parts.push({ kind: 'text', text: md.slice(last) })
  return parts
}
