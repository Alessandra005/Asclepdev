import { useState } from 'react'
import { Button, Card, FileInput, NonIdealState, ProgressBar, Slider } from '@blueprintjs/core'
import { useClassify, useDraftReport, useFindings, useReviewFinding, useSlides } from '@/api/hooks'
import type { Finding, Patient, Report, Slide } from '@/api/types'
import { AiDraftBlock } from '@/components/AiDraftBlock'
import { AuthedImage } from '@/components/AuthedImage'
import { CitationChip } from '@/components/CitationChip'
import { ErrorCallout, QueryState } from '@/components/QueryState'
import { LocalProcessingPill } from '@/components/LocalProcessingPill'
import { RequirePatient } from '@/components/RequirePatient'
import { ReviewPanel } from '@/components/ReviewPanel'
import { useSession } from '@/state/session'

export function LabTab() {
  const canRun = useSession((s) => s.can('run_lab_technician'))
  // Spec 13: nurses cannot run or view the Lab Technician; say so instead of showing a 403.
  if (!canRun) return <LabNotForRole />
  return <RequirePatient>{(p) => <LabBody patient={p} />}</RequirePatient>
}

/** Spec 10.1 fixed headings render as section labels; anything without a kind is a sentence. */
export function ReportSentences({ sentences }: { sentences: Report['sentences'] }) {
  return (
    <>
      {sentences.map((s, i) =>
        s.kind === 'heading' ? (
          <div key={i} className="label">
            {s.text}
          </div>
        ) : (
          <p key={i}>{s.text}</p>
        )
      )}
    </>
  )
}

export function LabNotForRole() {
  return (
    <NonIdealState
      icon="lab-test"
      title="The Lab tab is for physicians and lab staff"
      description="Findings you can see are on the patient's Findings tab."
    />
  )
}

function LabBody({ patient }: { patient: Patient }) {
  const slides = useSlides(patient.id)
  const findings = useFindings(patient.id)
  return (
    <QueryState
      query={slides}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        icon: 'lab-test',
        title: 'No slides for this patient',
        description: 'Upload a slide under a specimen to run the Lab Technician.'
      }}
    >
      {(d) => {
        const slide = d.items[0]! // newest first
        const finding = findings.data?.items.find((f) => f.id === slide.finding_id) ?? null
        return (
          <>
            {findings.isError && (
              <ErrorCallout error={findings.error} onRetry={() => void findings.refetch()} />
            )}
            <SlideWorkspace key={slide.id} patient={patient} slide={slide} finding={finding} />
          </>
        )
      }}
    </QueryState>
  )
}

/**
 * finding null = not analyzed yet: Analyze classifies the slide, then drafts the Resident report.
 * The classify result shows at once; the refetched /findings row replaces it (review status etc.).
 */
function SlideWorkspace({
  patient,
  slide,
  finding
}: {
  patient: Patient
  slide: Slide
  finding: Finding | null
}) {
  const can = useSession((s) => s.can)
  const user = useSession((s) => s.user)
  const [opacity, setOpacity] = useState(0.5)
  const classify = useClassify(patient.id)
  const draft = useDraftReport()
  const review = useReviewFinding(patient.id)
  const current = finding ?? classify.data ?? null
  const analyzed = current !== null
  const report = draft.data ?? null

  const analyze = async () => {
    const f = await classify.mutateAsync(slide.id)
    draft.mutate(f.id)
  }
  const busy = classify.isPending || draft.isPending

  return (
    <div className="page lab">
      <div className="lab-left">
        <div className="row between">
          <h2 className="h2">{slide.specimen_label}</h2>
          <FileInput text="Upload slide" disabled />
        </div>
        {/* Heatmap PNG matches the thumbnail's size, so two stacked images line up (no deep-zoom needed). */}
        <div className="slide-viewer">
          {current?.thumbnail_url ? (
            <>
              <AuthedImage url={current.thumbnail_url} alt="Slide thumbnail" className="slide-img" />
              {current.heatmap_url && (
                <AuthedImage
                  url={current.heatmap_url}
                  alt="Model heatmap"
                  className="slide-img"
                  style={{ opacity }}
                />
              )}
            </>
          ) : (
            <>
              <div className="slide-tissue" />
              {analyzed && <div className="slide-heatmap" style={{ opacity }} />}
              <span className="slide-caption muted small">
                Slide + heatmap viewer · placeholder, not model output
              </span>
            </>
          )}
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
          {current?.tile_urls.length
            ? current.tile_urls.map((u, i) => (
                <AuthedImage key={u} url={u} alt={`Evidence tile ${i + 1}`} className="tile" />
              ))
            : [1, 2, 3, 4].map((i) => (
                <div key={i} className="tile muted small">
                  Tile {i}
                </div>
              ))}
        </div>
      </div>

      <div className="lab-right">
        {!current ? (
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
                finding={current}
                canReview={can('review_findings')}
                submitting={review.isPending}
                onSubmit={(req) => review.mutate({ findingId: current.id, req })}
              />
              {review.isError && <ErrorCallout error={review.error} />}
            </Card>
            {draft.isPending && <ProgressBar intent="primary" />}
            {draft.isError && <ErrorCallout error={draft.error} onRetry={() => draft.mutate(current.id)} />}
            {!report && draft.isIdle && (
              <Button icon="document" text="Draft Resident report" onClick={() => draft.mutate(current.id)} />
            )}
            {report && (
              <AiDraftBlock
                title="Resident report"
                ranOn="anthropic_api"
                reviewed={
                  current.status !== 'pending_review'
                    ? `Reviewed by ${current.reviewed_by ?? user?.full_name}`
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
                <ReportSentences sentences={report.sentences} />
              </AiDraftBlock>
            )}
          </>
        )}
      </div>
    </div>
  )
}
