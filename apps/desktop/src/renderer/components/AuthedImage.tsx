import { useEffect, useState, type CSSProperties } from 'react'
import { Classes } from '@blueprintjs/core'
import { useFileBlob } from '@/api/hooks'

/** An image from gateway /files, fetched with the bearer token. The object URL lives only while mounted. */
export function AuthedImage({
  url,
  alt,
  className,
  style
}: {
  url: string
  alt: string
  className?: string
  style?: CSSProperties
}) {
  const q = useFileBlob(url)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!q.data) return
    const u = URL.createObjectURL(q.data)
    // The object URL is an external resource: create and revoke it here (useMemo breaks under StrictMode).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrc(u)
    return () => URL.revokeObjectURL(u)
  }, [q.data])
  if (q.isError) return <span className={`${className ?? ''} muted small`}>Image unavailable</span>
  if (!src) return <span className={`${className ?? ''} ${Classes.SKELETON}`} aria-label={`Loading ${alt}`} />
  return <img src={src} alt={alt} className={className} style={style} />
}
