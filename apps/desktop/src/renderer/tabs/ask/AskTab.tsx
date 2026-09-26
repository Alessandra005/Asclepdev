import { useState, type FormEvent } from 'react'
import { Button, Callout, Card, InputGroup, Tag } from '@blueprintjs/core'
import { useAsk, usePatient } from '@/api/hooks'
import { AiDraftBlock } from '@/components/AiDraftBlock'
import { CitationChip } from '@/components/CitationChip'
import { ErrorCallout } from '@/components/QueryState'
import { useUi } from '@/state/ui'

const SUGGESTED = [
  "What is Gregory's treatment status and is pembrolizumab available?",
  "How was Gregory breathing during today's visit?"
]

/**
 * Microsoft track rule: the core experience is not a chat window. Ask is a one-shot, cited lookup
 * scoped to the selected patient. Answers are drafts with citations, not a conversation.
 */
export function AskTab() {
  const patientId = useUi((s) => s.selectedPatientId)
  const patient = usePatient(patientId)
  const ask = useAsk()
  const [question, setQuestion] = useState('')

  const submit = (e?: FormEvent, text = question) => {
    e?.preventDefault()
    if (!text.trim()) return
    setQuestion(text)
    ask.mutate({ question: text.trim(), patient_id: patientId ?? undefined })
  }

  return (
    <div className="page ask">
      <Card className="card">
        <form onSubmit={submit} className="row gap">
          <InputGroup
            large
            fill
            leftIcon="search-template"
            placeholder={
              patient.data
                ? `Look something up about ${patient.data.name}...`
                : 'Look something up across your patients...'
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" intent="primary" text="Look up" loading={ask.isPending} large />
        </form>
        <div className="chips mt">
          {SUGGESTED.map((s) => (
            <Tag key={s} interactive minimal onClick={() => submit(undefined, s)}>
              {s}
            </Tag>
          ))}
        </div>
      </Card>
      {ask.isError && <ErrorCallout error={ask.error} onRetry={() => submit()} />}
      {ask.data && (
        <AiDraftBlock
          title="Answer"
          ranOn="anthropic_api"
          footer={
            <div className="chips">
              {ask.data.citations.map((c) => (
                <CitationChip key={c.id} citation={c} />
              ))}
            </div>
          }
        >
          {/* SPEC-QUESTION: render answer_md with a markdown renderer? Not in the spec 6 library list. */}
          <p dangerouslySetInnerHTML={{ __html: escapeBold(ask.data.answer_md) }} />
        </AiDraftBlock>
      )}
      {!ask.data && !ask.isPending && (
        <Callout icon="info-sign" className="mt">
          Every answer cites its sources. Unreviewed drafts and other patients' data are never used.
        </Callout>
      )}
    </div>
  )
}

/** Minimal, safe **bold** support: escape everything, then re-enable <strong>. */
function escapeBold(md: string): string {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}
