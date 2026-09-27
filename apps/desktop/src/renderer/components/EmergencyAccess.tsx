import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  NonIdealState,
  TextArea
} from '@blueprintjs/core'
import { ErrorCallout } from './QueryState'

const MIN_REASON = 5 // the gateway rejects shorter reasons with VALIDATION_ERROR

/**
 * Break-the-glass (spec 13, demo step 9): a physician off the care team sees why the chart is closed
 * and may request 60 minutes of access with a typed reason. The admin gets a critical alert and the
 * audit row carries the reason. The dialog stays open until the gateway confirms.
 */
export function EmergencyAccess({
  submitting,
  error,
  onSubmit
}: {
  submitting: boolean
  error: unknown
  onSubmit: (reason: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const ready = reason.trim().length >= MIN_REASON && !submitting
  return (
    <>
      <NonIdealState
        icon="lock"
        title="You are not on this patient's care team"
        description="Access is need-to-know. In an emergency you can open this chart for 60 minutes; the reason is audited and the admin is alerted."
        action={
          <Button intent="danger" icon="warning-sign" text="Emergency access" onClick={() => setOpen(true)} />
        }
      />
      <Dialog isOpen={open} title="Emergency access" icon="warning-sign" onClose={() => setOpen(false)}>
        <DialogBody>
          <FormGroup label="Clinical reason" labelFor="ea-reason" labelInfo="(required)">
            <TextArea
              id="ea-reason"
              fill
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Patient in ED, attending unavailable"
            />
          </FormGroup>
          {!!error && <ErrorCallout error={error} />}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" disabled={submitting} onClick={() => setOpen(false)} />
              <Button
                intent="danger"
                text="Open chart for 60 minutes"
                disabled={!ready}
                loading={submitting}
                onClick={() => onSubmit(reason.trim())}
              />
            </>
          }
        />
      </Dialog>
    </>
  )
}
