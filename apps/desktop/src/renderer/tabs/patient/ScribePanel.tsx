import { useCallback, useState } from 'react'
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
import { scribeApi } from '@/api/hooks'
import { USE_MOCKS } from '@/api/client'
import type { Note, Patient, ScribeSession } from '@/api/types'
import { AiDraftBlock } from '@/components/AiDraftBlock'
import { ErrorCallout } from '@/components/QueryState'
import { useSession } from '@/state/session'
import { useScribeCapture } from './useScribeCapture'

type Phase = 'idle' | 'active' | 'stopping' | 'review' | 'done'

export function ScribePanel({ patient }: { patient: Patient }) {
  const user = useSession((s) => s.user)
  const can = useSession((s) => s.can)
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>('idle')
  const [consentOpen, setConsentOpen] = useState(false)
  const [consented, setConsented] = useState(false)
  const [consentRef, setConsentRef] = useState('')
  const [session, setSession] = useState<ScribeSession | null>(null)
  const [paused, setPaused] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const stop = useCallback(async () => {
    if (!session) return
    setPhase('stopping')
    try {
      const res = await scribeApi.stop(session.id)
      setNote(res.note)
      setDraft(res.note.body)
      setPhase('review')
    } catch (e) {
      setError(e)
      setPhase('active')
    }
  }, [session])

  const {
    videoRef,
    observations,
    cameraError,
    windows,
    dropped,
    reset: resetCapture
  } = useScribeCapture(phase === 'active' ? (session?.id ?? null) : null, paused, stop)

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
      const s = await scribeApi.start(patient.id, consentRef.trim())
      setSession(s)
      setPaused(false)
      resetCapture()
      setPhase('active')
      setConsentOpen(false)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const review = async (action: 'accept' | 'edit' | 'discard') => {
    if (!session) return
    setBusy(true)
    try {
      const n = await scribeApi.review(session.id, action === 'edit' ? { action, body: draft } : { action })
      setNote(n)
      setEditing(false)
      setPhase('done')
      // An approved note now appears in the Notes sub-tab (gateway-confirmed, not optimistic).
      void qc.invalidateQueries({ queryKey: [user?.id, 'patient', patient.id, 'notes'] })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="card span-12">
      <div className="card-head">
        <span className="card-title">Scribe / visit observations</span>
        {phase === 'active' && (
          <Tag intent="danger" icon="record" round className={paused ? '' : 'pulse'}>
            {paused ? 'Camera paused' : 'Camera active, nothing is recorded'}
          </Tag>
        )}
        <span className="spacer" />
        {phase === 'idle' && can('start_scribe') && (
          <Button intent="primary" icon="eye-open" text="Start Scribe" onClick={openConsent} />
        )}
        {phase === 'active' && (
          <>
            <Button
              icon={paused ? 'play' : 'pause'}
              text={paused ? 'Resume' : 'Pause'}
              onClick={() => setPaused((p) => !p)}
            />
            <Button intent="danger" icon="stop" text="Stop" onClick={() => void stop()} />
          </>
        )}
      </div>

      {error !== null && <ErrorCallout error={error} />}

      {phase === 'idle' && (
        <p className="muted">
          Camera only, never audio. Frames stay in memory on this machine and are never saved. Output stays a
          draft until the attending reviews it.
        </p>
      )}

      {(phase === 'active' || phase === 'stopping') && (
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
            <div className="small muted">
              {windows} windows analyzed{dropped > 0 && ` · ${dropped} dropped`} · consent{' '}
              <span className="mono">{session?.consent_ref}</span>
            </div>
          </div>
          <div className="scribe-obs">
            {observations.length === 0 ? (
              <p className="muted">Waiting for the first 10-second window...</p>
            ) : (
              <HTMLTable compact className="table-fill">
                <tbody>
                  {observations.map((o, i) => (
                    <tr key={i}>
                      <td className="mono small">{o.t}</td>
                      <td>
                        <Tag minimal>{o.category.replace('_', ' ')}</Tag>
                      </td>
                      <td>{o.text}</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
            {phase === 'stopping' && <p className="muted">Drafting the note from text observations...</p>}
          </div>
        </div>
      )}

      {(phase === 'review' || phase === 'done') && note && (
        <AiDraftBlock
          title={note.title}
          reviewed={
            phase === 'done'
              ? note.status === 'discarded'
                ? 'Discarded'
                : `Accepted by ${user?.full_name}`
              : null
          }
          ranOn="anthropic_api"
          footer={
            phase === 'review' && (
              <div className="row gap">
                {editing ? (
                  <Button
                    intent="primary"
                    text="Save edits"
                    loading={busy}
                    disabled={!can('review_scribe')}
                    onClick={() => void review('edit')}
                  />
                ) : (
                  <>
                    <Button
                      intent="primary"
                      text="Accept"
                      loading={busy}
                      disabled={!can('review_scribe')}
                      onClick={() => void review('accept')}
                    />
                    <Button text="Edit" disabled={!can('review_scribe')} onClick={() => setEditing(true)} />
                  </>
                )}
                <Button
                  intent="danger"
                  variant="outlined"
                  text="Discard"
                  disabled={!can('review_scribe') || busy}
                  onClick={() => void review('discard')}
                />
                {!can('review_scribe') && <span className="small muted">Only the attending can accept.</span>}
              </div>
            )
          }
        >
          {editing ? (
            <TextArea
              fill
              rows={12}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit note"
            />
          ) : note.status === 'discarded' ? (
            <p className="muted">Note discarded. Session metadata stays in the audit log.</p>
          ) : (
            <pre className="note-body">{note.body}</pre>
          )}
        </AiDraftBlock>
      )}

      <Dialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Record Scribe consent"
        icon="endorsed"
      >
        <DialogBody>
          <p>
            Ask {patient.name} for verbal consent. The camera describes observable behavior only. No audio, no
            saved video, and anyone else in frame is ignored.
          </p>
          <Checkbox
            checked={consented}
            onChange={(e) => setConsented(e.currentTarget.checked)}
            label={`${patient.name} gave verbal consent`}
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
                text="Start camera"
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
