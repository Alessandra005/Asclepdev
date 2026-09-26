import { Tag } from '@blueprintjs/core'
import type { Citation } from '@/api/types'
import { useUi } from '@/state/ui'

const ICON: Record<
  Citation['kind'],
  'lab-test' | 'document' | 'pulse' | 'prescription' | 'search-around' | 'box' | 'eye-open'
> = {
  observation: 'pulse',
  note: 'document',
  condition: 'pulse',
  medication: 'prescription',
  finding: 'lab-test',
  inventory: 'box',
  scribe: 'eye-open'
}

/** Click opens the source record in the SourceDrawer. */
export function CitationChip({ citation }: { citation: Citation }) {
  const openSource = useUi((s) => s.openSource)
  return (
    <Tag
      interactive
      minimal
      icon={ICON[citation.kind]}
      className="citation-chip"
      onClick={() => openSource(citation.id)}
      aria-label={`Open source: ${citation.label}`}
    >
      {citation.label}
    </Tag>
  )
}
