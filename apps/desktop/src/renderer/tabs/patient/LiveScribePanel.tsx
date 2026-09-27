import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLTable,
  InputGroup,
  Tag,
  TextArea
} from '@blueprintjs/core'
import { liveScribeApi, useLiveScribeSessions } from '@/api/hooks'
import { USE_MOCKS } from '@/api/client'
import type { LiveScribeSession, Patient } from '@/api/types'
import { AiDraftBlock } from '@/components/AiDraftBlock'
import { ErrorCallout, QueryState } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'
import { useSession } from '@/state/session'
import { ActionChecklist, LiveTimeline } from './LiveScribeParts'
import { useLiveScribeCapture } from './useLiveScribeCapture'

const STATUS_LABEL: Record<LiveScribeSession['status'], string> = {
  active: 'In progress',
  review: 'Awaiting review',
  report_draft: 'Report draft',
  accepted: 'Accepted',
  discarded: 'Discarded'
}

/**
 * LiveScribing: camera + conversation during the visit. The gateway stores the transcript, observations and
 * flagged actions (possible symptoms) in MongoDB; the attending checks which actions go into the report.
 */
export function LiveScribePanel({ patient }: { patient: Patient }) {
  const user = useSession((s) => s.user)
  const can = useSession((s) => s.can)
  const qc = useQueryClient()
  const [session, setSession] = useState<LiveScribeSession | null>(null)
  const [stopping, setStopping] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [consented, setConsented] = useState(false)
  const [consentRef, setConsentRef] = useState('')
  const [paused, setPaused] = useState(false)
  const [preview, setPreview] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [choosing, setChoosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showTimeline, setShowTimeline] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const refreshList = useCallback(
    () => void qc.invalidateQueries({ queryKey: [user?.id, 'patient', patient.id, 'live-scribe'] }),
    [qc, user?.id, patient.id]
  )
  const open = useCallback((s: LiveScribeSession) => {
    setSession(s)
    setSelected(new Set(s.actions.filter((a) => a.included).map((a) => a.id)))
    setDraft(s.report?.body ?? '')
    setChoosing(false)
    setEditing(false)
  }, [])

  const active = session?.status === 'active' && !stopping
  const stopRef = useRef<() => void>(() => {})
  const {
    videoRef,
    observations,
    transcript,
    cameraError,
    micError,
    windows,
    failed,
    flush,
    reset: resetCapture
  } = useLiveScribeCapture(
    patient.id,
    session?.status === 'active' ? session.id : null,
    paused,
    // Auto-stop after 30 minutes goes through the same path as the Stop button.
    useCallback(() => stopRef.current(), [])
  )

  const stop = async () => {
    if (!session) return
    setStopping(true)
    setError(null)
    try {
      await flush() // send the last partial window so the end of the conversation is kept
      open(await liveScribeApi.stop(patient.id, session.id))
      refreshList()
    } catch (e) {
      setError(e)
    } finally {
      setStopping(false)
    }
  }
  useEffect(() => {
    stopRef.current = () => void stop()
  })

  const openConsent = () => {
    const d = new Date()
    setConsentRef(
      `verbal-${d.toISOString().slice(0, 10)}-${(user?.full_name ?? 'x').replace(/[^A-Z]/g, '').toLowerCase()}`
    )
    setConsented(false)
    setConsentOpen(true)
  }
  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      const s = await liveScribeApi.start(patient.id, consentRef.trim())
      resetCapture()
      setPaused(false)
      open(s)
      setConsentOpen(false)
      refreshList()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const run = async (fn: () => Promise<LiveScribeSession>) => {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      open(await fn())
      refreshList()
      void qc.invalidateQueries({ queryKey: [user?.id, 'patient', patient.id, 'notes'] })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const canReview = can('review_scribe')
  const status = session?.status
  const showChecklist = status === 'review' || (status === 'report_draft' && choosing)
  const reviewNote = !canReview && (
    <span className="small muted">Only the attending can choose and sign.</span>
  )

  return (
    <Card className="card span-12">
      <div className="card-head">
        <span className="card-title">LiveScribing / visit conversation and observations</span>
        {active && (
          <Tag intent="danger" icon="record" round className={paused ? '' : 'pulse'}>
            {paused ? 'Paused' : 'Camera and mic active, nothing is recorded'}
          </Tag>
        )}
        <span className="spacer" />
        {!active && !stopping && status !== 'review' && status !== 'report_draft' && can('start_scribe') && (
          <Button intent="primary" icon="record" text="LiveScribing" onClick={openConsent} />
        )}
        {(active || stopping) && (
          <>
            <Button
              icon={paused ? 'play' : 'pause'}
              text={paused ? 'Resume' : 'Pause'}
              disabled={stopping}
              onClick={() => setPaused((p) => !p)}
            />
            <Button intent="danger" icon="stop" text="Stop" loading={stopping} onClick={() => void stop()} />
          </>
        )}
      </div>

      {error !== null && <ErrorCallout error={error} />}

      {!session && (
        <p className="muted">
          Camera and microphone. Frames and audio stay in memory on this machine and are never saved. Only the
          text transcript, observations and flagged possible symptoms are stored. Output stays a draft until
          the attending reviews it.
        </p>
      )}

      {session && (active || stopping) && (
        <div className="scribe-live">
          <div className="scribe-cam">
            <video ref={videoRef} autoPlay muted playsInline className={preview ? '' : 'hidden'} />
            {!preview && <div className="cam-off muted small">Preview hidden</div>}
            <Button
              size="small"
              variant="minimal"
              icon={preview ? 'eye-off' : 'eye-open'}
              text={preview ? 'Hide preview' : 'Show preview'}
              onClick={() => setPreview((p) => !p)}
            />
            {cameraError && (
              <Callout intent="warning" compact icon="video">
                {cameraError}.{' '}
                {USE_MOCKS ? 'Mock observations will still play.' : 'Check camera permissions.'}
              </Callout>
            )}
            {micError && (
              <Callout intent="warning" compact icon="volume-off">
                {micError}.
              </Callout>
            )}
            <div className="small muted">
              {windows} windows analyzed{failed > 0 && ` · ${failed} failed`} · consent{' '}
              <span className="mono">{session.consent_ref}</span>
            </div>
          </div>
          <div className="scribe-obs">
            <LiveTimeline
              observations={observations}
              transcript={transcript}
              empty="Waiting for the first 10-second window..."
            />
            {stopping && <p className="muted">Saving the conversation and flagging possible symptoms...</p>}
          </div>
        </div>
      )}

      {session && status !== 'active' && (
        <>
          {showChecklist && (
            <AiDraftBlock
              title="Possible symptoms (AI draft)"
              ranOn="local"
              footer={
                <div className="row gap">
                  <Button
                    intent="primary"
                    text={`Add ${selected.size} to scribing report`}
                    loading={busy}
                    disabled={!canReview}
                    onClick={() =>
                      void run(() => liveScribeApi.report(patient.id, session.id, [...selected]))
                    }
                  />
                  {reviewNote}
                </div>
              }
            >
              {session.summary && <p>{session.summary}</p>}
              <ActionChecklist
                actions={session.actions}
                selected={selected}
                onToggle={toggle}
                canChoose={canReview}
              />
            </AiDraftBlock>
          )}

          {session.report && !showChecklist && (
            <AiDraftBlock
              title="Scribing report"
              ranOn="local"
              reviewed={
                status === 'accepted'
                  ? `Accepted by ${session.report.reviewed_by_name}`
                  : status === 'discarded'
                    ? 'Discarded'
                    : null
              }
              footer={
                status === 'report_draft' && (
                  <div className="row gap">
                    {editing ? (
                      <Button
                        intent="primary"
                        text="Save edits"
                        loading={busy}
                        disabled={!canReview}
                        onClick={() =>
                          void run(() =>
                            liveScribeApi.review(patient.id, session.id, { action: 'edit', body: draft })
                          )
                        }
                      />
                    ) : (
                      <>
                        <Button
                          intent="primary"
                          text="Accept"
                          loading={busy}
                          disabled={!canReview}
                          onClick={() =>
                            void run(() => liveScribeApi.review(patient.id, session.id, { action: 'accept' }))
                          }
                        />
                        <Button text="Edit" disabled={!canReview} onClick={() => setEditing(true)} />
                        <Button
                          text="Change symptoms"
                          disabled={!canReview}
                          onClick={() => setChoosing(true)}
                        />
                      </>
                    )}
                    <Button
                      intent="danger"
                      variant="outlined"
                      text="Discard"
                      disabled={!canReview || busy}
                      onClick={() =>
                        void run(() => liveScribeApi.review(patient.id, session.id, { action: 'discard' }))
                      }
                    />
                    {reviewNote}
                  </div>
                )
              }
            >
              {editing ? (
                <TextArea
                  fill
                  rows={14}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Edit scribing report"
                />
              ) : status === 'discarded' ? (
                <p className="muted">
                  Report discarded. The conversation and actions stay stored with the session.
                </p>
              ) : (
                <pre className="note-body">{session.report.body}</pre>
              )}
            </AiDraftBlock>
          )}

          <div className="row gap mt">
            <Button
              variant="minimal"
              icon={showTimeline ? 'chevron-down' : 'chevron-right'}
              text={`Conversation and observations (${session.transcript.length} said, ${session.observations.length} seen)`}
              onClick={() => setShowTimeline((v) => !v)}
            />
            <span className="spacer" />
            <Button variant="minimal" icon="cross" text="Close session" onClick={() => setSession(null)} />
          </div>
          {showTimeline && (
            <LiveTimeline
              observations={session.observations}
              transcript={session.transcript}
              empty="Nothing was captured in this session."
            />
          )}
        </>
      )}

      {!active && !stopping && (
        <PastSessions patient={patient} onOpen={open} currentId={session?.id ?? null} />
      )}

      <Dialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Record LiveScribing consent"
        icon="endorsed"
      >
        <DialogBody>
          <p>
            Ask {patient.name} for verbal consent. LiveScribing uses the camera and the microphone: the
            conversation is transcribed on this machine and the text is saved with the visit. No audio or
            video is saved, and anyone else in frame is ignored.
          </p>
          <Checkbox
            checked={consented}
            onChange={(e) => setConsented(e.currentTarget.checked)}
            label={`${patient.name} gave verbal consent to camera observation and conversation transcription`}
          />
          <FormGroup label="Consent reference" labelInfo="(required)">
            <InputGroup value={consentRef} onChange={(e) => setConsentRef(e.target.value)} className="mono" />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setConsentOpen(false)} />
              <Button
                intent="primary"
                text="Start LiveScribing"
                loading={busy}
                disabled={!consented || !consentRef.trim()}
                onClick={() => void start()}
              />
            </>
          }
        />
      </Dialog>
    </Card>
  )
}

/** Earlier sessions for this patient: reopen one to read its conversation and actions (retrieved from MongoDB). */
function PastSessions({
  patient,
  onOpen,
  currentId
}: {
  patient: Patient
  onOpen: (s: LiveScribeSession) => void
  currentId: string | null
}) {
  const q = useLiveScribeSessions(patient.id)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const openOne = async (id: string) => {
    setLoading(id)
    setError(null)
    try {
      onOpen(await liveScribeApi.get(patient.id, id))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(null)
    }
  }
  return (
    <div className="mt">
      <div className="card-head">
        <span className="card-title">Earlier LiveScribing sessions</span>
      </div>
      {error !== null && <ErrorCallout error={error} />}
      <QueryState
        query={q}
        isEmpty={(d) => d.items.length === 0}
        empty={{ icon: 'mobile-video', title: 'No LiveScribing sessions yet' }}
      >
        {(d) => (
          <HTMLTable compact className="table-fill">
            <tbody>
              {d.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <RelativeTime iso={s.started_at} />
                  </td>
                  <td>
                    <Tag minimal intent={s.status === 'accepted' ? 'success' : 'none'}>
                      {STATUS_LABEL[s.status]}
                    </Tag>
                  </td>
                  <td className="small muted">
                    {s.counts.transcript} said · {s.counts.observations} seen · {s.counts.actions} possible
                    symptoms
                  </td>
                  <td className="small muted">{s.started_by_name}</td>
                  <td>
                    <Button
                      size="small"
                      text={s.id === currentId ? 'Open' : 'View'}
                      loading={loading === s.id}
                      disabled={s.status === 'active'}
                      onClick={() => void openOne(s.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </QueryState>
    </div>
  )
}
