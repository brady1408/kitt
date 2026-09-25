import { homedir, networkInterfaces, userInfo } from 'node:os'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBus } from './bus'
import { Store } from './store'
import { Registry } from './registry'
import { KittSession } from './kitt-session'
import { TaskManager } from './task-manager'
import { Spokes } from './spokes'
import { PlanUsage } from './plan-usage'
import { SystemMonitor } from './system-monitor'
import { ensureSelfSignedCert } from './tls'
import { createHub } from './server'
import { sdkRunner } from './runner'
import { kittPersona, TASK_PROMPT } from './persona'

const HOME = homedir()
const PORT = Number(process.env['KITT_PORT'] ?? 7331)
const LOCAL_PORT = Number(process.env['KITT_LOCAL_PORT'] ?? 7330)
const TLS_ENABLED = process.env['KITT_TLS'] !== 'off'
const HOST = process.env['KITT_HOST'] ?? '0.0.0.0'
const DATA_DIR = process.env['KITT_DATA_DIR'] ?? join(HOME, '.local', 'share', 'kitt')
const WORKDIR = process.env['KITT_WORKDIR'] ?? HOME
const OPERATOR = process.env['KITT_OPERATOR'] ?? userInfo().username
const TTS_URL = process.env['KITT_TTS_URL'] ?? 'http://127.0.0.1:7333'
const STATIC_DIR = resolve(import.meta.dir, '..', '..', 'web', 'dist')

mkdirSync(DATA_DIR, { recursive: true })

const bus = createBus()
const store = new Store(join(DATA_DIR, 'kitt.db'))
const registry = new Registry()
const planUsage = new PlanUsage(store)
const system = new SystemMonitor()
system.start(5_000, bus.emit)
registry.onChange((entry) => bus.emit({ type: 'registry.update', entry }))
registry.onRemove((id) => bus.emit({ type: 'registry.remove', id }))

const tasks = new TaskManager({
  factory: sdkRunner, store, registry, planUsage, system, emit: bus.emit, defaultCwd: WORKDIR, homeDir: HOME, taskPrompt: TASK_PROMPT,
})
tasks.markInterruptedOnStartup()

const kitt = new KittSession({ factory: sdkRunner, store, registry, planUsage, system, cwd: WORKDIR, persona: kittPersona(OPERATOR), emit: bus.emit })
kitt.start()

const spokes = new Spokes({ registry, store, emit: bus.emit })
setInterval(() => spokes.sweep(), 15_000)

const lanAddresses = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal).map((i) => i!.address)
const tls = TLS_ENABLED ? ensureSelfSignedCert(DATA_DIR, lanAddresses) : undefined

const hub = createHub({
  bus, store, registry, kitt, tasks, spokes, system, config: { workdir: WORKDIR }, ttsUrl: TTS_URL,
  port: PORT, hostname: HOST, localPort: LOCAL_PORT, staticDir: STATIC_DIR, ...(tls ? { tls } : {}),
})
const scheme = tls ? 'https' : 'http'
console.log(`kitt hub listening on ${scheme}://${HOST}:${hub.port} (local http://127.0.0.1:${hub.localPort}; data: ${DATA_DIR}, workdir: ${WORKDIR}, operator: ${OPERATOR})`)
if (tls) console.log(`self-signed certificate: trust it once per device; download at http://127.0.0.1:${hub.localPort}/cert.pem or ${scheme}://<this-ip>:${hub.port}/cert.pem`)
