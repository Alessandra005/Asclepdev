import { useState } from 'react'
import { Button, Card, FileInput, NonIdealState, ProgressBar, Slider } from '@blueprintjs/core'
import { useClassify, useDraftReport, useFindings, useReviewFinding } from '@/api/hooks'
import type { Finding, Patient, Report } from '@/api/types'
import { AiDraftBlock } from '@/components/AiDraftBlock'
import { CitationChip } from '@/components/CitationChip'
import { ErrorCallout, QueryState } from '@/components/QueryState'
import { LocalProcessingPill } from '@/components/LocalProcessingPill'
import { RequirePatient } from '@/components/RequirePatient'
import { ReviewPanel } from '@/components/ReviewPanel'
import { useSession } from '@/state/session'

export function LabTab() {
  return <RequirePatient>{(p) => <LabBody patient={p} />}</RequirePatient>
}

function LabBody({ patient }: { patient: Patient }) {
  const q = useFindings(patient.id)
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        icon: 'lab-test',
        title: 'No slides for this patient',
        description: 'Upload a slide under a specimen to run the Lab Technician.'
      }}
    >
      {(d) => <FindingWorkspace patient={patient} finding={d.items[0]!} />}
    </QueryState>
  )
}

function FindingWorkspace({ patient, finding }: { patient: Patient; finding: Finding }) {
  const can = useSession((s) => s.can)
  const user = useSession((s) => s.user)
  const [opacity, setOpacity] = useState(0.5)
  const [analyzed, setAnalyzed] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const classify = useClassify(patient.id)
  const draft = useDraftReport()
  const review = useReviewFinding(patient.id)

  const analyze = async () => {
    await classify.mutateAsync(finding.slide_id)
    setAnalyzed(true)
    setReport(await draft.mutateAsync(finding.id))
  }
  const busy = classify.isPending || draft.isPending

  return (
    <div className="page lab">
      <div className="lab-left">
        <div className="row between">
          <h2 className="h2">{finding.specimen_label}</h2>
          <FileInput text="Upload slide" disabled />
        </div>
        {/* TODO(Brandon + Ron): OpenSeadragon viewer once the DZI/IIIF contract is agreed (kickoff p.6). */}
        <div className="slide-viewer">
          <div className="slide-tissue" />
          {analyzed && <div className="slide-heatmap" style={{ opacity }} />}
          <span className="slide-caption muted small">
            Slide + heatmap viewer · placeholder, not model output
          </span>
        </div>
        <div className="row gap center">
          <span className="small muted">Heatmap opacity</span>
          <Slider
            min={0}
            max={1}
            stepSize={0.05}
            value={opacity}
            onChange={setOpacity}
            labelRenderer={false}
            disabled={!analyzed}
            className="grow"
          />
        </div>
        <div className="label">Top evidence tiles</div>
        <div className="tiles">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="tile muted small">
              Tile {i}
            </div>
          ))}
        </div>
      </div>

      <div className="lab-right">
        {!analyzed ? (
          <Card className="card">
            <NonIdealState
              icon="predictive-analysis"
              title="Slide ready to analyze"
              description="The Lab Technician classifies the tissue on this machine. The result is a draft until you sign it."
              action={
                <Button
                  intent="primary"
                  icon="play"
                  text="Analyze"
                  loading={busy}
                  onClick={() => void analyze()}
                  disabled={!can('run_lab_technician')}
                />
              }
            />
            {busy && <ProgressBar intent="primary" />}
            {classify.isError && <ErrorCallout error={classify.error} onRetry={() => void analyze()} />}
            <div className="center-row">
              <LocalProcessingPill ranOn="local" />
            </div>
          </Card>
        ) : (
          <>
            <Card className="card">
              <ReviewPanel
                finding={finding}
                canReview={can('review_findings')}
                submitting={review.isPending}
                onSubmit={(req) => review.mutate({ findingId: finding.id, req })}
              />
              {review.isError && <ErrorCallout error={review.error} />}
            </Card>
            {draft.isPending && <ProgressBar intent="primary" />}
            {draft.isError && <ErrorCallout error={draft.error} onRetry={() => draft.mutate(finding.id)} />}
            {report && (
              <AiDraftBlock
                title="Resident report"
                ranOn="anthropic_api"
                reviewed={
                  finding.status !== 'pending_review'
                    ? `Reviewed by ${finding.reviewed_by ?? user?.full_name}`
                    : null
                }
                footer={
                  <div className="chips">
                    {report.citations.map((c) => (
                      <CitationChip key={c.id} citation={c} />
                    ))}
                  </div>
                }
              >
                {report.sentences.map((s) => (
                  <p key={s.text}>{s.text}</p>
                ))}
              </AiDraftBlock>
            )}
          </>
        )}
      </div>
    </div>
  )
}
