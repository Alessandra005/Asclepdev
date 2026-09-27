import { useState } from 'react'
import { Card, Tree, type TreeNodeInfo } from '@blueprintjs/core'
import { useRecordsTree } from '@/api/hooks'
import type { Patient, RecordsTree, RecordsTreeItem } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RequirePatient } from '@/components/RequirePatient'
import { RecordDetail } from './RecordDetail'

export function RecordsTab() {
  return <RequirePatient>{(p) => <RecordsBody patient={p} />}</RequirePatient>
}

/** records_tree view (spec 7A.8): the gateway groups every object by registry folder, newest first. */
function RecordsBody({ patient }: { patient: Patient }) {
  const q = useRecordsTree(patient.id)
  const sourceLabel = (sys: string): string =>
    sys === 'asclep' ? 'Asclep' : (patient.sources.find((s) => s.source_system === sys)?.label ?? sys)
  return (
    <div className="page">
      <QueryState
        query={q}
        isEmpty={(d) => d.folders.every((f) => f.items.length === 0)}
        empty={{
          icon: 'folder-close',
          title: 'No records yet',
          description: 'Nothing has been ingested for this patient.'
        }}
      >
        {(d) => <RecordsView patientName={patient.name} folders={d.folders} sourceLabel={sourceLabel} />}
      </QueryState>
    </div>
  )
}

const key = (i: RecordsTreeItem): string => `${i.type}:${i.id}`
/** Labs are sub-foldered by test ("Glucose: 110 mg/dL" -> "Glucose") so ten years of results stay browsable. */
const labGroup = (i: RecordsTreeItem): string => i.title.split(':')[0] ?? i.title

export function RecordsView({
  patientName,
  folders,
  sourceLabel
}: {
  patientName: string
  folders: RecordsTree['folders']
  sourceLabel: (sourceSystem: string) => string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<{ folder: string; item: RecordsTreeItem } | null>(null)

  const fileNode = (i: RecordsTreeItem): TreeNodeInfo => ({
    id: key(i),
    label: i.title,
    icon: 'document',
    isSelected: selected !== null && key(selected.item) === key(i)
  })
  const folderNode = (id: string, label: string, count: number, children: TreeNodeInfo[]): TreeNodeInfo => ({
    id,
    label,
    icon: expanded.has(id) ? 'folder-open' : 'folder-close',
    isExpanded: expanded.has(id),
    hasCaret: count > 0,
    secondaryLabel: <span className="small muted">{count}</span>,
    childNodes: children
  })

  const nodes: TreeNodeInfo[] = folders.map(({ name, items }) => {
    const fid = `f:${name}`
    if (name !== 'Labs') return folderNode(fid, name, items.length, items.map(fileNode))
    const groups = [...new Set(items.map(labGroup))]
    return folderNode(
      fid,
      name,
      items.length,
      groups.map((g) => {
        const inGroup = items.filter((i) => labGroup(i) === g)
        return folderNode(`g:${g}`, g, inGroup.length, inGroup.map(fileNode))
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
  const pick = (id: string): void => {
    for (const f of folders) {
      const item = f.items.find((i) => key(i) === id)
      if (item) return setSelected({ folder: f.name, item })
    }
  }

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
            else pick(id)
          }}
        />
      </Card>
      <div className="span-8">
        <RecordDetail
          patientName={patientName}
          folder={selected?.folder ?? null}
          item={selected?.item ?? null}
          sourceLabel={sourceLabel}
        />
      </div>
    </div>
  )
}
