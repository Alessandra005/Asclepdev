import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Card, Tab, Tabs, Tag } from '@blueprintjs/core'
import { usePatientSummary, useRequestTranscript, useTranscripts } from '@/api/hooks'
import type { Patient } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { RequirePatient } from '@/components/RequirePatient'
import { useSession } from '@/state/session'
import { FindingsView } from './FindingsView'
import { LabsView } from './LabsView'
import { MedsView } from './MedsView'
import { NotesView } from './NotesView'
import { SourcesView } from './SourcesView'
import { ScribePanel } from './ScribePanel'

export function PatientTab() {
  return <RequirePatient>{(p) => <PatientBody patient={p} />}</RequirePatient>
}

type Sub = 'overview' | 'labs' | 'meds' | 'notes' | 'findings' | 'sources'

function PatientBody({ patient }: { patient: Patient }) {
  const [sub, setSub] = useState<Sub>('overview')
  const can = useSession((s) => s.can)
  const transcripts = useTranscripts(patient.id)
  const request = useRequestTranscript(patient.id)
  const tr = transcripts.data?.items[0]
  const hasRiverside = patient.sources.some((s) => s.source_system === 'ehr-a')
  const qc = useQueryClient()
  const userId = useSession((s) => s.user?.id)
  const merged = tr?.status === 'merged'

  // Refetch patient + summary only once the gateway confirms the merge (kickoff p.5).
  useEffect(() => {
    if (merged && !hasRiverside) {
      void qc.invalidateQueries({ queryKey: [userId, 'patient', patient.id], refetchType: 'active' })
    }
  }, [merged, hasRiverside, qc, userId, patient.id])

  return (
    <div className="page">
      <div className="row between">
        <Tabs id="patient-sub" selectedTabId={sub} onChange={(id) => setSub(id as Sub)}>
          <Tab id="overview" title="Overview" />
          <Tab id="labs" title="Labs" />
          <Tab id="meds" title="Meds" />
          <Tab id="notes" title="Notes" />
          <Tab id="findings" title="Findings" />
          <Tab id="sources" title="Sources" />
        </Tabs>
        {can('request_transcripts') && !hasRiverside && (
          <Button
            intent="primary"
            icon="import"
            text={tr ? 'Waiting for consent...' : 'Request records'}
            loading={request.isPending}
            disabled={!!tr}
            onClick={() => request.mutate()}
          />
        )}
      </div>

      {sub === 'overview' ? (
        <div className="grid">
          <Overview patient={patient} />
          <Card className="span-5 card">
            <div className="card-head">
              <span className="card-title">Sources</span>
            </div>
            {patient.sources.map((s) => (
              <div key={s.source_system} className="task-row">
                <Tag minimal intent={s.status === 'merged' ? 'success' : 'none'} icon="database">
                  {s.label}
                </Tag>
                <span className="small muted">
                  {s.status === 'merged' ? 'History merged just now' : 'Referral and current workup'}
                </span>
              </div>
            ))}
            <div className="card-head mt">
              <span className="card-title">Records transfer</span>
            </div>
            {!tr ? (
              <p className="small muted">No transfer requested.</p>
            ) : (
              <Tag minimal intent={tr.status === 'merged' ? 'success' : 'warning'}>
                {tr.from_provider}: {tr.status === 'merged' ? 'Merged' : 'Awaiting admin consent'}
              </Tag>
            )}
          </Card>
          <ScribePanel patient={patient} />
        </div>
      ) : sub === 'labs' ? (
        <LabsView patient={patient} />
      ) : sub === 'meds' ? (
        <MedsView patient={patient} />
      ) : sub === 'notes' ? (
        <NotesView patient={patient} />
      ) : sub === 'findings' ? (
        <FindingsView patient={patient} />
      ) : (
        <SourcesView patient={patient} />
      )}
    </div>
  )
}

function Overview({ patient }: { patient: Patient }) {
  const q = usePatientSummary(patient.id)
  return (
    <Card className="span-7 card">
      <div className="card-head">
        <span className="card-title">Patient summary</span>
      </div>
      <QueryState query={q}>
        {(s) => (
          <>
            <div className="label">Conditions</div>
            <p>{s.conditions.map((c) => c.display).join(' / ') || 'None recorded'}</p>
            {s.last_encounter && (
              <>
                <div className="label">Last encounter</div>
                <p>{s.last_encounter.reason}</p>
              </>
            )}
            {s.new_from_sources.length > 0 && (
              <Callout intent="warning" icon="git-merge" title="New from Riverside" className="mt">
                {s.new_from_sources.map((n) => (
                  <p key={n.text}>{n.text}</p>
                ))}
              </Callout>
            )}
          </>
        )}
      </QueryState>
    </Card>
  )
}
