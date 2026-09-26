import { useState } from 'react'
import { Card, HTMLTable, Tag } from '@blueprintjs/core'
import { usePatientObservations } from '@/api/hooks'
import type { Observation, Patient } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'
import { LabTrendChart } from './LabTrendChart'
import { flagOf, groupLabs, rangeText, valueText } from './labFormat'

export function LabsView({ patient }: { patient: Patient }) {
  const q = usePatientObservations(patient.id, 'laboratory')
  const sourceLabel = (sys: string): string =>
    patient.sources.find((s) => s.source_system === sys)?.label ?? sys
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.length === 0}
      empty={{
        icon: 'lab-test',
        title: 'No lab results',
        description: 'No connected source has sent lab results for this patient yet.'
      }}
    >
      {(obs) => <LabsPanel observations={obs} sourceLabel={sourceLabel} />}
    </QueryState>
  )
}

/** Latest value per test on the left (also the chart's text view), trend of the selected test right. */
export function LabsPanel({
  observations,
  sourceLabel
}: {
  observations: Observation[]
  sourceLabel: (sourceSystem: string) => string
}) {
  const groups = groupLabs(observations)
  const firstFlagged = groups.find((g) => flagOf(g.latest.interpretation))
  const [picked, setPicked] = useState<string | null>(null)
  const selected = groups.find((g) => g.key === picked) ?? firstFlagged ?? groups[0]

  return (
    <div className="grid">
      <Card className="span-6 card">
        <div className="card-head">
          <span className="card-title">Latest results</span>
        </div>
        <HTMLTable compact interactive className="table-fill">
          <thead>
            <tr>
              <th>Test</th>
              <th>Latest</th>
              <th>Range</th>
              <th>When</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const flag = flagOf(g.latest.interpretation)
              const range = rangeText(g.latest)
              return (
                <tr
                  key={g.key}
                  className={g.key === selected?.key ? 'is-selected' : undefined}
                  tabIndex={0}
                  aria-selected={g.key === selected?.key}
                  onClick={() => setPicked(g.key)}
                  onKeyDown={(e) => e.key === 'Enter' && setPicked(g.key)}
                >
                  <td>{g.display}</td>
                  <td>
                    <span className="strong">{valueText(g.latest)}</span>{' '}
                    {flag && (
                      <Tag minimal intent={flag.intent}>
                        {flag.text}
                      </Tag>
                    )}
                  </td>
                  <td className={range ? undefined : 'muted'}>{range ?? 'Not given'}</td>
                  <td>
                    {g.latest.effective_at ? (
                      <RelativeTime iso={g.latest.effective_at} />
                    ) : (
                      <span className="muted">Date unknown</span>
                    )}
                  </td>
                  <td className="muted">{sourceLabel(g.latest.provenance.source_system)}</td>
                </tr>
              )
            })}
          </tbody>
        </HTMLTable>
      </Card>
      {selected && (
        <Card className="span-6 card">
          <div className="card-head">
            <span className="card-title">{selected.display} trend</span>
            <span className="small muted">
              {selected.series.length} result{selected.series.length === 1 ? '' : 's'}
            </span>
          </div>
          <LabTrendChart series={selected.series} sourceLabel={sourceLabel} />
        </Card>
      )}
    </div>
  )
}
