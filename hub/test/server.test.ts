import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHub } from '../src/server'
import { createBus } from '../src/bus'
import { Store } from '../src/store'
import { Registry } from '../src/registry'
import { KittSession } from '../src/kitt-session'
import { TaskManager } from '../src/task-manager'
import { Spokes } from '../src/spokes'
import { fakeFactory } from './fake-runner'
import { PlanUsage } from '../src/plan-usage'

const stops: (() => void)[] = []
afterEach(() => { for (const s of stops.splice(0)) s() })

function boot() {
  const home = mkdtempSync(join(tmpdir(), 'kitt-home-'))
  mkdirSync(join(home, 'pa'))
  const store = new Store(':memory:')
  const registry = new Registry()
  const bus = createBus()
  const { factory, runners } = fakeFactory()
  const planUsage = new PlanUsage(store)
  const kitt = new KittSession({ factory, store, registry, planUsage, cwd: join(home, 'pa'), persona: 'p', emit: bus.emit })
  kitt.start()
  const tasks = new TaskManager({ factory, store, registry, planUsage, emit: bus.emit, defaultCwd: join(home, 'pa'), homeDir: home, taskPrompt: 't' })
  const spokes = new Spokes({ registry, store, emit: bus.emit })
  registry.onChange((entry) => bus.emit({ type: 'registry.update', entry }))
  const hub = createHub({ bus, store, registry, kitt, tasks, spokes, port: 0, hostname: '127.0.0.1' })
  stops.push(hub.stop)
  return { hub, runners, registry }
}

type Frame = { type: string; [key: string]: any }

async function open(port: number, path: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  const frames: Frame[] = []
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('ws error')) })
  const waitFor = async (pred: (f: Frame) => boolean, ms = 2000): Promise<Frame> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const hit = frames.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`no frame matched; got ${JSON.stringify(frames.map((f) => f.type))}`)
  }
  const send = (obj: unknown) => ws.send(JSON.stringify(obj))
  return { ws, frames, waitFor, send }
}

test('a browser gets a snapshot on connect and /healthz answers', async () => {
  const { hub } = boot()
  const b = await open(hub.port, '/ws')
  const snap = await b.waitFor((f) => f.type === 'snapshot')
  expect(snap).toMatchObject({ registry: [{ id: 'kitt' }], messages: [], tasks: [] })
  expect(await (await fetch(`http://127.0.0.1:${hub.port}/healthz`)).text()).toBe('ok')
})

test('malformed frames get an error and the socket stays open', async () => {
  const { hub } = boot()
  const b = await open(hub.port, '/ws')
  b.ws.send('{{')
  await b.waitFor((f) => f.type === 'error' && f.code === 'bad_frame')
  b.send({ type: 'chat.send', target: 'kitt', text: '   ' })
  await b.waitFor((f) => f.type === 'error' && f.code === 'bad_frame' && f !== b.frames[1])
  b.send({ type: 'snapshot' })
  expect((await b.waitFor((f) => f.type === 'snapshot' && f !== b.frames[0])).type).toBe('snapshot')
})

test('chat.send to kitt reaches the runner and is echoed to every browser', async () => {
  const { hub, runners } = boot()
  const a = await open(hub.port, '/ws')
  const b = await open(hub.port, '/ws')
  a.send({ type: 'chat.send', target: 'kitt', text: 'hello' })
  await b.waitFor((f) => f.type === 'chat.user' && f['message']?.text === 'hello')
  expect(runners[0]!.sent).toEqual(['hello'])
})

test('chat.send to an offline spoke is refused', async () => {
  const { hub } = boot()
  const b = await open(hub.port, '/ws')
  b.send({ type: 'chat.send', target: 'spoke:ghost', text: 'hi' })
  const err = await b.waitFor((f) => f.type === 'error')
  expect(err.code).toBe('spoke_offline')
})

test('a spoke registers, shows up in the registry, and its reply lands as chat.done', async () => {
  const { hub, registry } = boot()
  const b = await open(hub.port, '/ws')
  const s = await open(hub.port, '/spoke')
  s.send({ type: 'register', sessionId: 'abc', pid: 1, cwd: '/home/b/x', name: 'x' })
  await s.waitFor((f) => f.type === 'registered')
  await b.waitFor((f) => f.type === 'registry.update' && f['entry']?.id === 'spoke:abc')
  b.send({ type: 'chat.send', target: 'spoke:abc', text: 'ping' })
  await s.waitFor((f) => f.type === 'deliver' && f.text === 'ping')
  s.send({ type: 'reply', text: 'pong' })
  const done = await b.waitFor((f) => f.type === 'chat.done')
  expect(done).toMatchObject({ target: 'spoke:abc', message: { text: 'pong' } })
  s.ws.close()
  await b.waitFor((f) => f.type === 'registry.update' && f['entry']?.status === 'offline')
  expect(registry.get('spoke:abc')?.status).toBe('offline')
})

test('task.create with a cwd outside home is refused', async () => {
  const { hub } = boot()
  const b = await open(hub.port, '/ws')
  b.send({ type: 'task.create', prompt: 'x', cwd: '/etc' })
  const err = await b.waitFor((f) => f.type === 'error')
  expect(err.code).toBe('bad_cwd')
})

test('browser upgrades from a foreign origin are refused; same-host and absent origins pass', async () => {
  const { hub } = boot()
  const base = `http://127.0.0.1:${hub.port}`
  const upgrade = (origin?: string) => fetch(`${base}/ws`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(origin ? { Origin: origin } : {}) } })
  expect((await upgrade('http://evil.example')).status).toBe(403)
  const b = await open(hub.port, '/ws')
  await b.waitFor((f) => f.type === 'snapshot')
  expect(b.ws.readyState).toBe(WebSocket.OPEN)
})
