import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { Observation } from '@/api/types'
import { useUi } from '@/state/ui'
import { flagOf } from './labFormat'

/** Blueprint blue3 / blue4, validated against each theme's card surface. Grid and text use tokens. */
const COLORS = {
  light: {
    line: '#2d72d2',
    grid: '#e1e4e8',
    text: '#5f6b7c',
    band: 'rgba(95,107,124,0.10)',
    surface: '#ffffff'
  },
  dark: {
    line: '#4c90f0',
    grid: '#383e47',
    text: '#abb3bf',
    band: 'rgba(171,179,191,0.12)',
    surface: '#252a31'
  }
} as const

const DAY = 86_400_000
interface Point {
  t: number
  v: number
  obs: Observation
}

export function toPoints(series: Observation[]): Point[] {
  return series
    .filter(
      (o): o is Observation & { value_num: number; effective_at: string } =>
        o.value_num !== null && o.effective_at !== null
    )
    .map((o) => ({ t: new Date(o.effective_at).getTime(), v: o.value_num, obs: o }))
    .sort((a, b) => a.t - b.t)
}

/** One test over time, reference range as a neutral band. Single series, so no legend. */
export function LabTrendChart({
  series,
  sourceLabel
}: {
  series: Observation[]
  sourceLabel: (sourceSystem: string) => string
}) {
  const theme = useUi((s) => s.theme)
  const c = COLORS[theme]
  const points = toPoints(series)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return <p className="small muted">No numeric results to chart.</p>

  const { ref_low: low, ref_high: high, unit } = last.obs
  const long = last.t - first.t > 2 * 365 * DAY
  const fmt = (t: number): string =>
    new Date(t).toLocaleDateString([], long ? { year: 'numeric' } : { month: 'short', day: 'numeric' })
  const xDomain = points.length === 1 ? [first.t - 15 * DAY, first.t + 15 * DAY] : ['dataMin', 'dataMax']

  return (
    <div className="lab-trend">
      <ResponsiveContainer width="100%" height={240} initialDimension={{ width: 480, height: 240 }}>
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          {high !== null && (
            <ReferenceArea y1={low ?? 0} y2={high} fill={c.band} stroke="none" ifOverflow="extendDomain" />
          )}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={fmt}
            stroke={c.grid}
            tick={{ fill: c.text, fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            domain={['auto', 'auto']}
            width={40}
            axisLine={false}
            tickLine={false}
            tick={{ fill: c.text, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: c.text, strokeWidth: 1 }}
            isAnimationActive={false}
            content={(p) => (
              <TrendTooltip
                active={p.active}
                point={p.payload?.[0]?.payload as Point | undefined}
                sourceLabel={sourceLabel}
              />
            )}
          />
          <Line
            dataKey="v"
            stroke={c.line}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={{ r: 4, fill: c.line, stroke: c.surface, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: c.line, stroke: c.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="small muted">
        {high !== null
          ? `Shaded band: reference range ${low ?? 0}–${high} ${unit ?? ''}.`
          : 'No reference range from the source.'}
        {points.length === 1 && ' One result so far; a trend appears when more results arrive.'}
      </p>
    </div>
  )
}

function TrendTooltip({
  active,
  point,
  sourceLabel
}: {
  active?: boolean
  point?: Point
  sourceLabel: (sourceSystem: string) => string
}) {
  if (!active || !point) return null
  const flag = flagOf(point.obs.interpretation)
  return (
    <div className="chart-tip">
      <div className="strong">
        {point.v} {point.obs.unit}
        {flag && <span className="chart-tip-flag"> {flag.text}</span>}
      </div>
      <div className="small">{new Date(point.t).toLocaleDateString()}</div>
      <div className="small muted">{sourceLabel(point.obs.provenance.source_system)}</div>
    </div>
  )
}
