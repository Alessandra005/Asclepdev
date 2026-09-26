import type { ReactNode } from 'react'
import { Tag } from '@blueprintjs/core'
import { LocalProcessingPill, type RanOn } from './LocalProcessingPill'

/** Spec 14.5: every AI text block has a warning-colored left border and "AI draft" until reviewed. */
export function AiDraftBlock({
  title,
  reviewed,
  ranOn,
  footer,
  children
}: {
  title: string
  reviewed?: string | null
  ranOn?: RanOn
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`ai-draft ${reviewed ? 'is-reviewed' : ''}`} aria-label={title}>
      <header className="ai-draft-head">
        <span className="card-title">{title}</span>
        {reviewed ? (
          <Tag intent="success" minimal icon="tick">
            {reviewed}
          </Tag>
        ) : (
          <Tag intent="warning" minimal>
            AI draft
          </Tag>
        )}
        {ranOn && <LocalProcessingPill ranOn={ranOn} />}
      </header>
      <div className="ai-draft-body">{children}</div>
      {footer && <footer className="ai-draft-foot">{footer}</footer>}
    </section>
  )
}
