import { useState } from 'react'
import { Card, Spinner, Tree, type TreeNodeInfo } from '@blueprintjs/core'
import type { UseQueryResult } from '@tanstack/react-query'
import { useFindings, usePatientNotes, usePatientObservations, usePatientSummary } from '@/api/hooks'
import type { Patient } from '@/api/types'
import { RequirePatient } from '@/components/RequirePatient'
import { RecordDetail } from './RecordDetail'
import {
  encounterFiles,
  FOLDERS,
  labFiles,
  noteFiles,
  pathologyFiles,
  type FolderId,
  type RecordFile
} from './recordsTree'

export function RecordsTab() {
  return <RequirePatient>{(p) => <RecordsBody patient={p} />}</RequirePatient>
}

/** undefined = loading, null = failed to load (never shown as an empty folder). */
export type FolderFiles = RecordFile[] | null | undefined

const settle = <T,>(q: UseQueryResult<T>, map: (d: T) => RecordFile[]): FolderFiles =>
  q.isError ? null : q.data === undefined ? undefined : map(q.data)

/**
 * SPEC-QUESTION: GET /patients/{id}/records-tree has no response shape in spec 15. Until it does,
 * the tree is composed from routes we already call. Encounters only has the last encounter (from
 * /summary) because there is no encounter list route.
 */
function RecordsBody({ patient }: { patient: Patient }) {
  const summary = usePatientSummary(patient.id)
  const labs = usePatientObservations(patient.id, 'laboratory')
  const notes = usePatientNotes(patient.id)
  const findings = useFindings(patient.id)
  const sourceLabel = (sys: string): string =>
    sys === 'asclep' ? 'Asclep' : (patient.sources.find((s) => s.source_system === sys)?.label ?? sys)
  return (
    <div className="page">
      <RecordsView
        patientName={patient.name}
        sourceLabel={sourceLabel}
        folders={{
          encounters: settle(summary, encounterFiles),
          labs: settle(labs, labFiles),
          notes: settle(notes, (d) => noteFiles(d.items)),
          pathology: settle(findings, (d) => pathologyFiles(d.items))
        }}
      />
    </div>
  )
}

export function RecordsView({
  patientName,
  folders,
  sourceLabel
}: {
  patientName: string
  folders: Record<FolderId, FolderFiles>
  sourceLabel: (sourceSystem: string) => string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const all = Object.values(folders).flatMap((f) => f ?? [])
  const selected = all.find((f) => f.id === selectedId) ?? null

  const fileNode = (f: RecordFile): TreeNodeInfo => ({
    id: f.id,
    label: f.name,
    icon: f.unverified ? 'warning-sign' : 'document',
    isSelected: f.id === selectedId
  })
  const folderNode = (
    id: string,
    label: string,
    files: RecordFile[],
    children: TreeNodeInfo[]
  ): TreeNodeInfo => ({
    id,
    label,
    icon: expanded.has(id) ? 'folder-open' : 'folder-close',
    isExpanded: expanded.has(id),
    hasCaret: files.length > 0,
    secondaryLabel: <span className="small muted">{files.length}</span>,
    childNodes: children
  })

  const nodes: TreeNodeInfo[] = FOLDERS.map(({ id, label }) => {
    const files = folders[id]
    const fid = `f:${id}`
    if (files === undefined)
      return { id: fid, label, icon: 'folder-close', secondaryLabel: <Spinner size={12} />, disabled: true }
    if (files === null)
      return {
        id: fid,
        label,
        icon: 'folder-close',
        disabled: true,
        secondaryLabel: <span className="small muted">Unavailable</span>
      }
    if (id !== 'labs') return folderNode(fid, label, files, files.map(fileNode))
    const groups = [...new Set(files.map((f) => f.group ?? ''))]
    return folderNode(
      fid,
      label,
      files,
      groups.map((g) => {
        const inGroup = files.filter((f) => (f.group ?? '') === g)
        return folderNode(`g:${g}`, g, inGroup, inGroup.map(fileNode))
      })
    )
  })

  const toggle = (id: string, open: boolean): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (open) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <div className="grid">
      <Card className="span-4 card records-tree">
        <div className="card-head">
          <span className="card-title">Records</span>
        </div>
        <Tree
          contents={nodes}
          onNodeExpand={(n) => toggle(String(n.id), true)}
          onNodeCollapse={(n) => toggle(String(n.id), false)}
          onNodeClick={(n) => {
            const id = String(n.id)
            if (n.childNodes) toggle(id, !expanded.has(id))
            else setSelectedId(id)
          }}
        />
      </Card>
      <div className="span-8">
        <RecordDetail patientName={patientName} file={selected} sourceLabel={sourceLabel} />
      </div>
    </div>
  )
}
