import { useRef, useState } from 'react'
import { Card } from '@blueprintjs/core'
import { useConsentTasks, useRecordConsent } from '@/api/hooks'
import type { ConsentTask } from '@/api/types'
import { QueryState } from '@/components/QueryState'
import { ConsentDialog } from './ConsentDialog'
import { ConsentQueue } from './ConsentQueue'

/** Spec 14.2 Admin tab. Built so far: the records-consent queue (spec 11 step 3, demo step 3). */
export function AdminTab() {
  const tasks = useConsentTasks()
  const decide = useRecordConsent()
  // The last reviewed task stays set after closing so the dialog can animate out and return focus.
  const [reviewing, setReviewing] = useState<ConsentTask | null>(null)
  const [open, setOpen] = useState(false)
  // After a decision the Review button has left the pending table, so focus lands on the card title.
  const decided = useRef(false)
  const title = useRef<HTMLSpanElement>(null)
  const review = (t: ConsentTask): void => {
    decide.reset()
    decided.current = false
    setReviewing(t)
    setOpen(true)
  }
  return (
    <div className="page">
      <h1 className="page-title">Admin</h1>
      <p className="muted">Admins record consent but cannot read clinical data.</p>
      <div className="grid">
        <Card className="span-8 card">
          <div className="card-head">
            <span className="card-title" tabIndex={-1} ref={title}>
              Records consent
            </span>
            <span className="small muted">Transcript requests from physicians</span>
          </div>
          <QueryState query={tasks}>{(d) => <ConsentQueue tasks={d.items} onReview={review} />}</QueryState>
        </Card>
        <Card className="span-4 card">
          <div className="card-head">
            <span className="card-title">Role matrix and care teams</span>
          </div>
          <p className="small muted">Not built yet: role assignment and care-team membership (spec 14.2).</p>
        </Card>
      </div>
      <ConsentDialog
        isOpen={open}
        task={reviewing}
        submitting={decide.isPending}
        error={decide.error}
        onClose={() => setOpen(false)}
        onClosed={() => {
          if (decided.current) title.current?.focus()
          decided.current = false
        }}
        onSubmit={(decision) => {
          if (!reviewing) return
          // Close only after the gateway confirms (and the queue has refetched).
          decide.mutate(
            { requestId: reviewing.id, decision },
            {
              onSuccess: () => {
                decided.current = true
                setOpen(false)
              }
            }
          )
        }}
      />
    </div>
  )
}
