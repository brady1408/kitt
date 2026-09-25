import type { ServerWebSocket } from 'bun'
import { join, resolve } from 'node:path'
import { ClientFrame, KITT_TARGET, type HubConfig, type ServerFrame } from './protocol'
import type { Bus } from './bus'
import type { Store } from './store'
import type { Registry } from './registry'
import type { KittSession } from './kitt-session'
import type { TaskManager } from './task-manager'
import type { Spokes } from './spokes'
import type { SystemMonitor } from './system-monitor'

export type HubDeps = {
  bus: Bus
  store: Store
  registry: Registry
  kitt: KittSession
  tasks: TaskManager
  spokes: Spokes
  system: SystemMonitor
  config: HubConfig
  ttsUrl?: string
  port: number
  hostname: string
  staticDir?: string
}

type SpokeConn = ReturnType<Spokes['connect']>
type ConnData = { kind: 'browser' } | { kind: 'spoke'; conn?: SpokeConn }
type Socket = ServerWebSocket<ConnData>

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function createHub(deps: HubDeps): { port: number; stop(): void } {
  const browsers = new Set<Socket>()
  deps.bus.subscribe((f) => {
    const data = JSON.stringify(f)
    for (const ws of browsers) ws.send(data)
  })

  const reply = (ws: Socket, f: ServerFrame): void => { ws.send(JSON.stringify(f)) }

  const snapshot = (): ServerFrame => ({
    type: 'snapshot',
    registry: deps.registry.list(),
    messages: deps.store.listAllMessages(200),
    tasks: deps.tasks.list(),
    usage: deps.kitt.usage(),
    system: deps.system.sample(),
    config: deps.config,
  })

  const handleClient = (ws: Socket, raw: string | Buffer): void => {
    let json: unknown
    try { json = JSON.parse(String(raw)) } catch {
      reply(ws, { type: 'error', code: 'bad_frame', text: 'Frame is not JSON.' })
      return
    }
    const parsed = ClientFrame.safeParse(json)
    if (!parsed.success) {
      reply(ws, { type: 'error', code: 'bad_frame', text: parsed.error.issues.map((i) => i.message).join('; ') })
      return
    }
    const f = parsed.data
    switch (f.type) {
      case 'snapshot':
        reply(ws, snapshot())
        return
      case 'chat.send':
        if (f.target === KITT_TARGET) { deps.kitt.send(f.text); return }
        if (!deps.spokes.deliver(f.target, f.text)) {
          reply(ws, { type: 'error', code: 'spoke_offline', text: 'That session is offline.', ref: f.target })
        }
        return
      case 'chat.clear':
        deps.kitt.clear()
        return
      case 'chat.interrupt':
        deps.kitt.interrupt().catch((err) => console.error('interrupt failed:', err))
        return
      case 'task.create':
        try { deps.tasks.create(f.prompt, f.cwd) } catch (e) {
          reply(ws, { type: 'error', code: (e as Error).message, text: 'Working directory must exist and be under your home directory.' })
        }
        return
      case 'task.cancel':
        deps.tasks.cancel(f.id)
        return
      case 'task.delete':
        try { deps.tasks.delete(f.id) } catch (e) {
          reply(ws, { type: 'error', code: (e as Error).message, text: 'Cancel the task before deleting it.' })
        }
        return
    }
  }

  const server = Bun.serve<ConnData>({
    port: deps.port,
    hostname: deps.hostname,
    fetch(req, srv): Response | undefined | Promise<Response> {
      const url = new URL(req.url)
      if (url.pathname === '/healthz') return new Response('ok')
      if (url.pathname === '/tts/voices') return proxyTts(deps.ttsUrl, '/voices')
      if (url.pathname === '/tts') return proxyTts(deps.ttsUrl, `/tts${url.search}`)
      if (url.pathname === '/ws') {
        if (!originAllowed(req)) return new Response('cross-origin websocket refused', { status: 403 })
        return srv.upgrade(req, { data: { kind: 'browser' } }) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      if (url.pathname === '/spoke') {
        const ip = srv.requestIP(req)?.address ?? ''
        if (!LOOPBACK.has(ip)) return new Response('spokes must connect from this machine', { status: 403 })
        return srv.upgrade(req, { data: { kind: 'spoke' } }) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      if (!deps.staticDir) return new Response('web build not configured', { status: 404 })
      return serveStatic(deps.staticDir, url.pathname)
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'browser') { browsers.add(ws); reply(ws, snapshot()); return }
        ws.data.conn = deps.spokes.connect((f) => ws.send(JSON.stringify(f)))
      },
      message(ws, raw) {
        if (ws.data.kind === 'browser') handleClient(ws, raw)
        else ws.data.conn?.handle(String(raw))
      },
      close(ws) {
        if (ws.data.kind === 'browser') browsers.delete(ws)
        else ws.data.conn?.close()
      },
    },
  })

  return { port: server.port ?? deps.port, stop: () => server.stop(true) }
}

// Browsers send Origin on WebSocket upgrades; a page from any other site must not be able to
// drive a bypassPermissions session. Non-browser clients (no Origin) are the LAN trust boundary.
function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try { return new URL(origin).host === req.headers.get('host') } catch { return false }
}

// The browser only ever talks to the hub; the sidecar stays on loopback. 503 lets the browser fall back to its own voice.
async function proxyTts(ttsUrl: string | undefined, path: string): Promise<Response> {
  if (!ttsUrl) return new Response('text-to-speech sidecar not configured', { status: 503 })
  try {
    const upstream = await fetch(ttsUrl + path, { signal: AbortSignal.timeout(60_000) })
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('text-to-speech sidecar unavailable', { status: 503 })
  }
}

async function serveStatic(dir: string, pathname: string): Promise<Response> {
  const root = resolve(dir)
  const requested = resolve(join(root, pathname === '/' ? 'index.html' : pathname))
  const inside = requested === root || requested.startsWith(root + '/')
  let file = inside ? Bun.file(requested) : null
  if (!file || !(await file.exists())) file = Bun.file(join(root, 'index.html'))
  if (!(await file.exists())) return new Response('web/dist is not built. Run: bun run web:build', { status: 404 })
  return new Response(file)
}
