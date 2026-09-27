import { useCallback, useEffect, useRef, useState } from 'react'
import { liveScribeApi } from '@/api/hooks'
import { isMocked } from '@/api/client'
import type { ScribeObservation, TranscriptSegment } from '@/api/types'

const FRAME_MS = 1000 // 1 frame/s
const WINDOW_MS = 10_000 // POST a window every 10 s
const MAX_FRAMES = 10 // ring buffer cap (spec 10.5 privacy rule 2)
const LONG_SIDE = 512
const AUTO_STOP_MS = 30 * 60_000
const MOTION_THRESHOLD = 0.02 // mean grey-level change between frames that counts as movement

/** A captured frame: JPEG in RAM, when it was taken (ms since start), and how much changed since the last one. */
export interface CapturedFrame {
  blob: Blob
  atMs: number
  motion: number
}

/**
 * Picks what the VLM sees, like the vlmlol prototype: the frame BEFORE movement started, the frame of PEAK
 * movement, and the frame AFTER. A still window sends one frame (posture). Fewer images = more accurate
 * answers from a small local model and far faster calls.
 */
export function pickFrames(frames: CapturedFrame[]): CapturedFrame[] {
  if (frames.length === 0) return []
  const last = frames.length - 1
  let peak = 0
  frames.forEach((f, i) => {
    if (i > 0 && f.motion > (frames[peak]?.motion ?? 0)) peak = i
  })
  if (peak === 0 || (frames[peak]?.motion ?? 0) < MOTION_THRESHOLD) return [frames[last]!]
  const start = frames.findIndex((f, i) => i > 0 && f.motion >= MOTION_THRESHOLD)
  const picked = [...new Set([Math.max(0, start - 1), peak, last])].sort((a, b) => a - b)
  return picked.map((i) => frames[i]!)
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function newRecorder(stream: MediaStream): MediaRecorder {
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) =>
    MediaRecorder.isTypeSupported(t)
  )
  return new MediaRecorder(stream, type ? { mimeType: type } : undefined)
}

/**
 * Camera + microphone capture for LiveScribing. Frames live in a 10-frame RAM ring buffer and audio in one
 * in-memory recorder per window; both are dropped as soon as the window is sent. Nothing touches disk.
 * Each window's audio is a self-contained clip: the recorder restarts at every cut so Whisper can decode it.
 * If a window is still processing, the next tick is skipped and the audio keeps recording, so no speech is lost.
 */
export function useLiveScribeCapture(
  patientId: string,
  sessionId: string | null,
  paused: boolean,
  onAutoStop: () => void
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const frames = useRef<CapturedFrame[]>([])
  const prevGrey = useRef<Uint8ClampedArray | null>(null)
  const inFlight = useRef(false)
  const startedAt = useRef(0)
  const windowFrom = useRef(0)
  const [observations, setObservations] = useState<ScribeObservation[]>([])
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([])
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [windows, setWindows] = useState(0)
  const [failed, setFailed] = useState(0)

  const stopMedia = useCallback(() => {
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null
      rec.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    frames.current = []
    prevGrey.current = null
  }, [])

  /** Ends the current audio clip and immediately starts the next one. Resolves null without a mic. */
  const cutAudio = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current
    const stream = streamRef.current
    if (!rec || rec.state !== 'recording' || !stream) return Promise.resolve(null)
    return new Promise((resolve) => {
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null)
      rec.stop()
      const next = newRecorder(new MediaStream(stream.getAudioTracks()))
      next.start()
      recorderRef.current = next
    })
  }, [])

  // Session clock: timestamps are seconds since LiveScribing started (pauses included).
  useEffect(() => {
    if (!sessionId) return
    startedAt.current = Date.now()
    windowFrom.current = 0
  }, [sessionId])

  // Acquire / release camera and microphone.
  useEffect(() => {
    if (!sessionId || paused) {
      stopMedia()
      return
    }
    let cancelled = false
    const attach = (stream: MediaStream) => {
      if (cancelled) return stream.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = new MediaStream(stream.getVideoTracks())
      if (stream.getAudioTracks().length && typeof MediaRecorder !== 'undefined') {
        const rec = newRecorder(new MediaStream(stream.getAudioTracks()))
        rec.start()
        recorderRef.current = rec
        setMicError(null)
      }
      setCameraError(stream.getVideoTracks().length ? null : 'Camera unavailable')
    }
    const media = navigator.mediaDevices
    const request = (withMic: boolean): Promise<MediaStream> =>
      media
        ? media.getUserMedia({
            video: true,
            audio: withMic ? { echoCancellation: true, noiseSuppression: true } : false
          })
        : Promise.reject(new Error('Camera unavailable'))
    request(true)
      .then(attach)
      .catch(() => {
        // No mic (or mic denied): keep the camera, say the conversation will not be transcribed.
        setMicError('Microphone unavailable, so the conversation is not being transcribed')
        return request(false)
          .then(attach)
          .catch((e: unknown) => setCameraError(e instanceof Error ? e.message : 'Camera unavailable'))
      })
    return () => {
      cancelled = true
      stopMedia()
    }
  }, [sessionId, paused, stopMedia])

  // 1 fps capture into the ring buffer.
  useEffect(() => {
    if (!sessionId || paused) return
    const canvas = document.createElement('canvas')
    const tiny = document.createElement('canvas') // 32x24 greyscale copy, only for the motion score
    tiny.width = 32
    tiny.height = 24
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v || !streamRef.current || v.videoWidth === 0) return
      const scale = LONG_SIDE / Math.max(v.videoWidth, v.videoHeight)
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height)
      const tctx = tiny.getContext('2d', { willReadFrequently: true })
      tctx?.drawImage(v, 0, 0, 32, 24)
      const px = tctx?.getImageData(0, 0, 32, 24).data
      let motion = 0
      if (px) {
        const grey = new Uint8ClampedArray(32 * 24)
        for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]!) / 3
        const prev = prevGrey.current
        if (prev) motion = grey.reduce((acc, g, i) => acc + Math.abs(g - prev[i]!), 0) / grey.length / 255
        prevGrey.current = grey
      }
      const atMs = Date.now() - startedAt.current
      canvas.toBlob(
        (b) => {
          if (!b) return
          frames.current.push({ blob: b, atMs, motion })
          if (frames.current.length > MAX_FRAMES) frames.current.shift()
        },
        'image/jpeg',
        0.8
      )
    }, FRAME_MS)
    return () => clearInterval(id)
  }, [sessionId, paused])

  /** Sends frames + the audio since the last cut as one window. */
  const sendWindow = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    const path = `/patients/${patientId}/live-scribe-sessions/${sessionId}/window`
    const batch = pickFrames(frames.current.splice(0))
    const nowMs = Date.now() - startedAt.current
    const from = windowFrom.current
    windowFrom.current = nowMs
    inFlight.current = true
    try {
      const audio = await cutAudio()
      if (!batch.length && !audio && !isMocked(path)) return
      const w = await liveScribeApi.window(patientId, sessionId, {
        start: clock(from),
        end: clock(nowMs),
        frames: batch.map((f) => f.blob),
        frameTimes: batch.map((f) => clock(f.atMs)),
        audio
      })
      setWindows((n) => n + 1)
      setObservations((prev) => [...prev, ...w.observations.filter((o) => o.confidence >= 0.5)])
      setTranscript((prev) => [...prev, ...w.transcript])
    } catch {
      setFailed((n) => n + 1)
    } finally {
      inFlight.current = false
    }
  }, [patientId, sessionId, cutAudio])

  // Every 10 s send a window. Busy: skip this tick and keep recording, so no speech is lost.
  useEffect(() => {
    if (!sessionId || paused) return
    const id = setInterval(() => {
      if (!inFlight.current) void sendWindow()
    }, WINDOW_MS)
    return () => clearInterval(id)
  }, [sessionId, paused, sendWindow])

  /** Before Stop: wait for any window in flight, then send what was captured since the last one. */
  const flush = useCallback(async (): Promise<void> => {
    const deadline = Date.now() + 120_000
    while (inFlight.current && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
    if (!paused && streamRef.current) await sendWindow()
  }, [paused, sendWindow])

  // Auto-stop after 30 minutes.
  useEffect(() => {
    if (!sessionId) return
    const id = setTimeout(onAutoStop, AUTO_STOP_MS)
    return () => clearTimeout(id)
  }, [sessionId, onAutoStop])

  const reset = useCallback(() => {
    stopMedia()
    setObservations([])
    setTranscript([])
    setWindows(0)
    setFailed(0)
  }, [stopMedia])

  return { videoRef, observations, transcript, cameraError, micError, windows, failed, flush, reset }
}
