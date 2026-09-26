import { useCallback, useEffect, useRef, useState } from 'react'
import { scribeApi } from '@/api/hooks'
import { isMocked } from '@/api/client'
import type { ScribeObservation } from '@/api/types'

const FRAME_MS = 1000 // 1 frame/s
const WINDOW_MS = 10_000 // POST a window every 10 s
const MAX_FRAMES = 10 // ring buffer cap (spec 10.5 privacy rule 2)
const LONG_SIDE = 512
const AUTO_STOP_MS = 30 * 60_000

/**
 * Camera capture for the Scribe. Frames live only in this ring buffer in RAM and are dropped after
 * each window. Video only: audio is never requested (privacy rule 4).
 */
export function useScribeCapture(sessionId: string | null, paused: boolean, onAutoStop: () => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frames = useRef<Blob[]>([])
  const inFlight = useRef(false)
  const [observations, setObservations] = useState<ScribeObservation[]>([])
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [windows, setWindows] = useState(0)
  const [dropped, setDropped] = useState(0)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    frames.current = []
  }, [])

  // Acquire / release the camera.
  useEffect(() => {
    if (!sessionId || paused) {
      stopCamera()
      return
    }
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setCameraError(null)
      })
      .catch((e: unknown) => setCameraError(e instanceof Error ? e.message : 'Camera unavailable'))
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [sessionId, paused, stopCamera])

  // 1 fps capture into the ring buffer.
  useEffect(() => {
    if (!sessionId || paused) return
    const canvas = document.createElement('canvas')
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v || !streamRef.current || v.videoWidth === 0) return
      const scale = LONG_SIDE / Math.max(v.videoWidth, v.videoHeight)
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (b) => {
          if (!b) return
          frames.current.push(b)
          if (frames.current.length > MAX_FRAMES) frames.current.shift()
        },
        'image/jpeg',
        0.8
      )
    }, FRAME_MS)
    return () => clearInterval(id)
  }, [sessionId, paused])

  // Every 10 s send the window. If the previous one is still processing, drop this one (no queueing).
  useEffect(() => {
    if (!sessionId || paused) return
    const id = setInterval(() => {
      const batch = frames.current.splice(0)
      if (inFlight.current) {
        setDropped((n) => n + 1)
        return
      }
      if (batch.length === 0 && !isMocked(`/scribe-sessions/${sessionId}/window`)) return
      inFlight.current = true
      scribeApi
        .window(sessionId, batch)
        .then((w) => {
          setWindows((n) => n + 1)
          const keep = w.observations.filter((o) => o.confidence >= 0.5)
          setObservations((prev) => [...prev, ...keep])
        })
        .catch(() => setDropped((n) => n + 1))
        .finally(() => {
          inFlight.current = false
        })
    }, WINDOW_MS)
    return () => clearInterval(id)
  }, [sessionId, paused])

  // Auto-stop after 30 minutes.
  useEffect(() => {
    if (!sessionId) return
    const id = setTimeout(onAutoStop, AUTO_STOP_MS)
    return () => clearTimeout(id)
  }, [sessionId, onAutoStop])

  const reset = useCallback(() => {
    stopCamera()
    setObservations([])
    setWindows(0)
    setDropped(0)
  }, [stopCamera])

  return { videoRef, observations, cameraError, windows, dropped, stopCamera, reset }
}
