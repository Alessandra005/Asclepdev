import { useRef, useState } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, FormGroup, HTMLTable, InputGroup } from '@blueprintjs/core'
import type { ConsentDecision, ConsentTask } from '@/api/types'
import { ErrorCallout } from '@/components/QueryState'
import { RelativeTime } from '@/components/RelativeTime'

/**
 * Spec 11 step 3 (demo simplification): the admin enters the consent reference, then records consent
 * or denies. Both decisions carry the reference. The caller closes the dialog only after the gateway
 * confirms, so a failure keeps it open with the error.
 *
 * Keep it mounted and toggle isOpen: Blueprint returns focus to the opener only on an isOpen change.
 */
export function ConsentDialog({
  isOpen,
  task,
  submitting,
  error,
  onSubmit,
  onClose,
  onClosed
}: {
  isOpen: boolean
  /** The request under review. Keep the last one after closing so the exit transition has content. */
  task: ConsentTask | null
  submitting: boolean
  error: Error | null
  onSubmit: (d: ConsentDecision) => void
  onClose: () => void
  /** After the close transition, once Blueprint has returned focus to the opener. */
  onClosed?: () => void
}) {
  const [consentRef, setConsentRef] = useState('')
  const [granted, setGranted] = useState<boolean | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const ready = consentRef.trim().length > 0 && !submitting
  const decide = (g: boolean): void => {
    setGranted(g)
    onSubmit({ consent_ref: consentRef.trim(), granted: g })
  }
  return (
    <Dialog
      isOpen={isOpen && task !== null}
      onClose={onClose}
      // Focus the input once open rather than with autoFocus: Blueprint records the element to return
      // focus to after the content mounts, so an autoFocused input would replace the Review button.
      onOpened={() => input.current?.focus()}
      onClosed={() => {
        setConsentRef('')
        setGranted(null)
        onClosed?.()
      }}
      title="Records transfer consent"
      icon="endorsed"
      canEscapeKeyClose={!submitting}
      canOutsideClickClose={!submitting}
      isCloseButtonShown={!submitting}
    >
      {task && (
        <>
          <DialogBody>
            <p>
              {task.from_provider} releases records only after the patient&apos;s consent is recorded. Without
              consent, the request can only be denied.
            </p>
            <HTMLTable compact className="kv">
              <tbody>
                <tr>
                  <th>Patient</th>
                  <td>
                    {task.patient_name} <span className="mono small muted">{task.patient_mrn}</span>
                  </td>
                </tr>
                <tr>
                  <th>From</th>
                  <td>{task.from_provider}</td>
                </tr>
                <tr>
                  <th>Requested</th>
                  <td>
                    {task.requested_by_name}, <RelativeTime iso={task.created_at} />
                  </td>
                </tr>
              </tbody>
            </HTMLTable>
            <FormGroup
              className="mt"
              label="Consent reference"
              labelFor="consent-ref"
              labelInfo="(required)"
              helperText="The signed form or the refusal on file. A denial needs one too."
            >
              <InputGroup
                id="consent-ref"
                className="mono"
                placeholder="e.g. Signed form #2231"
                value={consentRef}
                onChange={(e) => setConsentRef(e.target.value)}
                inputRef={input}
              />
            </FormGroup>
            {error && <ErrorCallout error={error} />}
          </DialogBody>
          <DialogFooter
            actions={
              <>
                <Button text="Cancel" disabled={submitting} onClick={onClose} />
                <Button
                  intent="danger"
                  text="Deny"
                  disabled={!ready}
                  loading={submitting && granted === false}
                  onClick={() => decide(false)}
                />
                <Button
                  intent="primary"
                  text="Record consent"
                  disabled={!ready}
                  loading={submitting && granted === true}
                  onClick={() => decide(true)}
                />
              </>
            }
          />
        </>
      )}
    </Dialog>
  )
}
