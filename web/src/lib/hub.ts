import { ServerFrame, type ClientFrame } from '@kitt/hub/protocol'

type FrameListener = (f: ServerFrame) => void
type StatusListener = (connected: boolean) => void

export class HubClient {
  private ws: WebSocket | null = null
  private backoff = 500
  private frameListeners = new Set<FrameListener>()
  private statusListeners = new Set<StatusListener>()
  private stopped = false

  constructor(private url: string) {}

  connect(): void {
    this.stopped = false
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => { this.backoff = 500; this.emitStatus(true) }
    ws.onmessage = (e) => {
      let json: unknown
      try { json = JSON.parse(String(e.data)) } catch { return }
      const parsed = ServerFrame.safeParse(json)
      if (!parsed.success) { console.warn('hub: unknown frame', json); return }
      for (const l of this.frameListeners) l(parsed.data)
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.emitStatus(false)
      if (this.stopped) return
      setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 10_000)
    }
    ws.onerror = () => { /* onclose follows */ }
  }

  disconnect(): void { this.stopped = true; this.ws?.close() }

  send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  onFrame(l: FrameListener): () => void { this.frameListeners.add(l); return () => { this.frameListeners.delete(l) } }
  onStatus(l: StatusListener): () => void { this.statusListeners.add(l); return () => { this.statusListeners.delete(l) } }

  private emitStatus(v: boolean): void { for (const l of this.statusListeners) l(v) }
}

export function defaultHubUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}
