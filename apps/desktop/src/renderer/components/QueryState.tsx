import type { ReactNode } from 'react'
import { Button, Callout, NonIdealState, Spinner, type IconName } from '@blueprintjs/core'
import type { UseQueryResult } from '@tanstack/react-query'
import { GatewayError } from '@/api/client'

/** Spec 14.5: every data view has loading, empty and error states. Use this wrapper everywhere. */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children
}: {
  query: UseQueryResult<T>
  isEmpty?: (data: T) => boolean
  empty?: { icon?: IconName; title: string; description?: string }
  children: (data: T) => ReactNode
}) {
  if (query.isPending)
    return (
      <div className="state-center">
        <Spinner size={24} />
      </div>
    )
  if (query.isError) return <ErrorCallout error={query.error} onRetry={() => void query.refetch()} />
  if (isEmpty?.(query.data) && empty) {
    return <NonIdealState icon={empty.icon ?? 'inbox'} title={empty.title} description={empty.description} />
  }
  return <>{children(query.data)}</>
}

export function ErrorCallout({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const ge = error instanceof GatewayError ? error : null
  const denied = ge?.status === 403
  return (
    <Callout
      intent={denied ? 'warning' : 'danger'}
      icon={denied ? 'lock' : 'error'}
      title={denied ? 'Access denied' : 'Something went wrong'}
    >
      <p>{ge?.message ?? (error instanceof Error ? error.message : 'Unknown error')}</p>
      {ge?.requestId && <p className="muted mono small">Request {ge.requestId}</p>}
      {onRetry && !denied && <Button size="small" icon="refresh" text="Retry" onClick={onRetry} />}
    </Callout>
  )
}
