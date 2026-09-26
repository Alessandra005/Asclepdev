import { useState } from 'react'
import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  ProgressBar,
  Radio,
  RadioGroup,
  TextArea
} from '@blueprintjs/core'
import type { Finding, ReviewAction, ReviewRequest } from '@/api/types'
import { RelativeTime } from './RelativeTime'

const LABELS = [
  { value: 'LUAD', label: 'LUAD / adenocarcinoma' },
  { value: 'LUSC', label: 'LUSC / squamous cell carcinoma' },
  { value: 'NORMAL', label: 'No malignancy' },
  { value: 'OTHER', label: 'Other (describe in note)' }
]

/** How a reviewed finding is shown everywhere (spec 14.4 colors). */
export const REVIEW_OUTCOME = {
  confirmed: { intent: 'success', title: 'Confirmed' },
  overridden: { intent: 'primary', title: 'Overridden' },
  rejected: { intent: 'none', title: 'Rejected' }
} as const

/**
 * Spec 14.4, the demo centerpiece. Original model label + confidence are always shown and never
 * rewritten; override sets final_label + note. Status only changes after the gateway confirms.
 */
export function ReviewPanel({
  finding,
  canReview,
  submitting,
  onSubmit
}: {
  finding: Finding
  canReview: boolean
  submitting: boolean
  onSubmit: (req: ReviewRequest) => void
}) {
  const [dialog, setDialog] = useState<Exclude<ReviewAction, 'confirm'> | null>(null)
  const [note, setNote] = useState('')
  const [label, setLabel] = useState('LUSC')
  const pct = Math.round(finding.confidence * 100)
  const done = finding.status === 'pending_review' ? null : REVIEW_OUTCOME[finding.status]

  const submit = (action: ReviewAction) => {
    const req: ReviewRequest = { action }
    if (action !== 'confirm') req.note = note.trim()
    if (action === 'override') req.final_label = label
    onSubmit(req)
    setDialog(null)
  }

  return (
    <div className="review-panel">
      {done ? (
        <Callout
          intent={done.intent}
          icon={done.intent === 'success' ? 'tick-circle' : 'info-sign'}
          title={`${done.title} by ${finding.reviewed_by}`}
        >
          {finding.reviewed_at && <RelativeTime iso={finding.reviewed_at} />}
          {finding.final_label && finding.status === 'overridden' && (
            <p>Final label: {finding.final_label}</p>
          )}
          {finding.review_note && <p className="muted">Note: {finding.review_note}</p>}
        </Callout>
      ) : (
        <Callout intent="warning" icon="warning-sign" title="AI finding, unverified">
          Requires attending review
        </Callout>
      )}

      <h2 className="finding-label">{finding.label_display}</h2>
      <div className="row between small">
        <span className="muted">Model confidence</span>
        <strong data-testid="confidence">{pct}%</strong>
      </div>
      <ProgressBar value={finding.confidence} intent="primary" stripes={false} animate={false} />
      <p className="mono small muted">
        {finding.model_name} / {finding.model_version}
      </p>

      {finding.status === 'pending_review' && (
        <>
          <div className="row gap">
            <Button
              intent="primary"
              text="Confirm"
              loading={submitting}
              disabled={!canReview || submitting}
              onClick={() => submit('confirm')}
            />
            <Button
              text="Override"
              disabled={!canReview || submitting}
              onClick={() => setDialog('override')}
            />
            <Button
              intent="danger"
              variant="outlined"
              text="Reject"
              disabled={!canReview || submitting}
              onClick={() => setDialog('reject')}
            />
          </div>
          <p className="small muted">
            {canReview
              ? 'Override and reject require a note.'
              : 'Only the attending physician can sign findings.'}
          </p>
        </>
      )}

      <Dialog
        isOpen={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'override' ? 'Override finding' : 'Reject finding'}
      >
        <DialogBody>
          {dialog === 'override' && (
            <RadioGroup
              label="Final label"
              selectedValue={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
            >
              {LABELS.filter((l) => l.value !== finding.label).map((l) => (
                <Radio key={l.value} value={l.value} label={l.label} />
              ))}
            </RadioGroup>
          )}
          <FormGroup label="Review note" labelInfo="(required)">
            <TextArea
              fill
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Review note"
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setDialog(null)} />
              <Button
                intent={dialog === 'reject' ? 'danger' : 'primary'}
                text={dialog === 'reject' ? 'Reject' : 'Save override'}
                disabled={!note.trim()}
                onClick={() => dialog && submit(dialog)}
              />
            </>
          }
        />
      </Dialog>
    </div>
  )
}
