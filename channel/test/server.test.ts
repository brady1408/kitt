import { test, expect, afterEach } from 'bun:test'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const c of cleanups.splice(0)) await c() })

function fakeHub() {
  const received: Record<string, unknown>[] = []
  const sockets: ServerWebSocket<unknown>[] = []
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/spoke') return srv.upgrade(req) ? undefined : new Response('no', { status: 400 })
      return new Response('not found', { status: 404 })
    },
    websocket: {
      open(ws) { sockets.push(ws) },
      message(_ws, raw) { received.push(JSON.parse(String(raw))) },
    },
  })
  cleanups.push(() => server.stop(true))
  const waitFor = async (pred: (f: Record<string, unknown>) => boolean, ms = 3000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const hit = received.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`no hub frame matched; got ${JSON.stringify(received)}`)
  }
  return { port: server.port!, received, sockets, waitFor }
}

const ChannelNotification = z.object({
  method: z.literal('notifications/claude/channel'),
  params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }),
})

test('spoke registers with the hub, relays deliveries as channel notifications, and forwards replies', async () => {
  const hub = fakeHub()
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const notifications: z.infer<typeof ChannelNotification>[] = []
  client.setNotificationHandler(ChannelNotification, async (n) => { notifications.push(n) })
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', join(import.meta.dir, '..', 'server.ts')],
    env: {
      ...process.env as Record<string, string>,
      KITT_HUB_URL: `ws://127.0.0.1:${hub.port}/spoke`,
      KITT_CHANNEL: '1',
      CLAUDE_CODE_SESSION_ID: 'sess-test',
      CLAUDE_PROJECT_DIR: '/home/user/ws/demo',
      CLAUDE_PID: '4242',
    },
  })
  cleanups.push(() => client.close())
  await client.connect(transport)

  const reg = await hub.waitFor((f) => f['type'] === 'register')
  expect(reg).toEqual({ type: 'register', sessionId: 'sess-test', pid: 4242, cwd: '/home/user/ws/demo', name: 'demo' })

  const tools = await client.listTools()
  expect(tools.tools.map((t) => t.name)).toEqual(['reply'])

  hub.sockets[0]!.send(JSON.stringify({ type: 'registered', id: 'spoke:sess-test' }))
  hub.sockets[0]!.send(JSON.stringify({ type: 'deliver', messageId: 'm1', text: 'ping from console' }))
  const deadline = Date.now() + 3000
  while (notifications.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
  expect(notifications[0]?.params).toEqual({ content: 'ping from console', meta: { chat_id: 'kitt', message_id: 'm1', reply_via: 'mcp__kitt__reply' } })

  const result = await client.callTool({ name: 'reply', arguments: { text: 'pong' } })
  expect(JSON.stringify(result.content)).toContain('sent')
  const rep = await hub.waitFor((f) => f['type'] === 'reply')
  expect(rep).toEqual({ type: 'reply', text: 'pong' })
})

test('a spoke spawned by an SDK-driven session exposes no tools and never registers with the hub', async () => {
  const hub = fakeHub()
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', join(import.meta.dir, '..', 'server.ts')],
    env: {
      ...process.env as Record<string, string>,
      KITT_HUB_URL: `ws://127.0.0.1:${hub.port}/spoke`,
      CLAUDE_CODE_SESSION_ID: 'sess-sdk',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_PROJECT_DIR: '/home/user/projects',
      CLAUDE_PID: '1',
    },
  })
  cleanups.push(() => client.close())
  await client.connect(transport)
  expect((await client.listTools()).tools).toEqual([])
  await new Promise((r) => setTimeout(r, 800))
  expect(hub.received).toEqual([])
  expect(hub.sockets).toHaveLength(0)
})

test('a spoke in a plain interactive session (no KITT_CHANNEL) exposes no tools and never registers', async () => {
  const hub = fakeHub()
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const env: Record<string, string> = { ...process.env as Record<string, string>, KITT_HUB_URL: `ws://127.0.0.1:${hub.port}/spoke`, CLAUDE_CODE_SESSION_ID: 'sess-plain', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: '/home/user/ws/go', CLAUDE_PID: '2' }
  delete env['KITT_CHANNEL']
  const transport = new StdioClientTransport({ command: 'bun', args: ['run', join(import.meta.dir, '..', 'server.ts')], env })
  cleanups.push(() => client.close())
  await client.connect(transport)
  expect((await client.listTools()).tools).toEqual([])
  await new Promise((r) => setTimeout(r, 800))
  expect(hub.received).toEqual([])
  expect(hub.sockets).toHaveLength(0)
})
