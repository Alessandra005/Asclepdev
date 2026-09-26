import type { Finding, Note, Observation, PatientSummary, Provenance } from '@/api/types'
import { flagOf, groupLabs, rangeText, valueText } from '@/tabs/patient/labFormat'

/** Spec 14.2: Patient > Encounters / Labs / Notes / Pathology. */
export type FolderId = 'encounters' | 'labs' | 'notes' | 'pathology'
export const FOLDERS: { id: FolderId; label: string }[] = [
  { id: 'encounters', label: 'Encounters' },
  { id: 'labs', label: 'Labs' },
  { id: 'notes', label: 'Notes' },
  { id: 'pathology', label: 'Pathology' }
]

export interface RecordFile {
  id: string
  folder: FolderId
  /** Labs only: the test this result belongs to (a sub-folder in the tree). */
  group?: string
  name: string
  date: string | null
  fields: [string, string][]
  body?: string
  /** AI output still waiting on physician review. */
  unverified?: boolean
  provenance: Provenance
}

const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString() : 'Date unknown')

export function encounterFiles(summary: PatientSummary | undefined): RecordFile[] {
  const e = summary?.last_encounter
  if (!e) return []
  return [
    {
      id: `enc-${e.provenance.source_ref}`,
      folder: 'encounters',
      name: `${day(e.date)} · ${e.reason}`,
      date: e.date,
      fields: [['Reason', e.reason]],
      provenance: e.provenance
    }
  ]
}

export function labFiles(obs: Observation[]): RecordFile[] {
  return groupLabs(obs).flatMap((g) =>
    [...g.series].reverse().map((o) => ({
      id: `lab-${o.id}`,
      folder: 'labs' as const,
      group: g.display,
      name: `${day(o.effective_at)} · ${valueText(o)}`,
      date: o.effective_at,
      fields: [
        ['Test', o.display],
        ['LOINC', o.loinc_code ?? 'Not given'],
        ['Value', valueText(o)],
        ['Reference range', rangeText(o) ?? 'Not given'],
        ['Flag', flagOf(o.interpretation)?.text ?? 'None from source']
      ] as [string, string][],
      provenance: o.provenance
    }))
  )
}

export function noteFiles(notes: Note[]): RecordFile[] {
  return [...notes]
    .sort((a, b) => (b.effective_at ?? '').localeCompare(a.effective_at ?? ''))
    .map((n) => ({
      id: `note-${n.id}`,
      folder: 'notes',
      name: `${day(n.effective_at)} · ${n.title}`,
      date: n.effective_at,
      fields: [
        ['Author', n.author_name ?? 'Not given'],
        ['Kind', n.kind],
        ['Legal record', n.is_legal_record ? 'Yes' : 'No']
      ],
      body: n.body,
      provenance: n.provenance
    }))
}

export function pathologyFiles(findings: Finding[]): RecordFile[] {
  return findings.map((f) => ({
    id: `path-${f.id}`,
    folder: 'pathology',
    name: `${f.specimen_label} · ${f.status === 'overridden' && f.final_label ? f.final_label : f.label}`,
    date: f.reviewed_at,
    fields: [
      ['Specimen', f.specimen_label],
      ['Model label', `${f.label_display} (${Math.round(f.confidence * 100)}%)`],
      ['Model', `${f.model_name} ${f.model_version}`],
      ['Status', f.status === 'pending_review' ? 'Awaiting physician review' : f.status],
      ['Final label', f.final_label ?? 'None'],
      ['Reviewed by', f.reviewed_by ?? 'Not yet']
    ],
    unverified: f.status === 'pending_review',
    provenance: f.provenance
  }))
}
