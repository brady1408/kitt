#!/usr/bin/env bun
/**
 * KITT channel spoke. Claude Code spawns this over stdio for a session launched with
 *   claude --dangerously-load-development-channels server:kitt
 * It registers the session with the KITT hub, turns hub deliveries into channel
 * notifications, and exposes a `reply` tool that forwards text back to the hub.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { basename } from 'node:path'

const HUB_URL = process.env['KITT_HUB_URL'] ?? 'ws://127.0.0.1:7331/spoke'
const SESSION_ID = process.env['CLAUDE_CODE_SESSION_ID'] ?? `pid-${process.ppid}`
const CWD = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const PID = Number(process.env['CLAUDE_PID'] ?? process.ppid)
const NAME = basename(CWD) || 'session'
const HEARTBEAT_MS = 15_000
const MAX_BACKOFF_MS = 10_000

const log = (s: string) => process.stderr.write(`kitt channel: ${s}\n`)

let ws: WebSocket | null = null
let backoff = 500
let heartbeat: ReturnType<typeof setInterval> | null = null

const mcp = new Server(
  { name: 'kitt', version: '0.1.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: [
      'Messages from the KITT console arrive as <channel source="kitt" chat_id="kitt" message_id="...">.',
      'The sender is looking at the KITT console, not this terminal: text you print here never reaches them.',
      'For EVERY console message, call the mcp__kitt__reply tool with your answer as `text`. Do not answer in the transcript instead.',
      'Keep replies concise; the console may read them aloud.',
    ].join(' '),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message to the KITT console.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, reply_to: { type: 'string' } },
      required: ['text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true }
  const args = (req.params.arguments ?? {}) as { text?: string; reply_to?: string }
  const text = args.text ?? ''
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { content: [{ type: 'text', text: 'KITT hub is offline; reply not delivered.' }], isError: true }
  }
  ws.send(JSON.stringify({ type: 'reply', text, ...(args.reply_to ? { replyTo: args.reply_to } : {}) }))
  return { content: [{ type: 'text', text: 'sent' }] }
})

function connect(): void {
  const socket = new WebSocket(HUB_URL)
  ws = socket
  socket.onopen = () => {
    backoff = 500
    socket.send(JSON.stringify({ type: 'register', sessionId: SESSION_ID, pid: PID, cwd: CWD, name: NAME }))
    heartbeat = setInterval(() => socket.send(JSON.stringify({ type: 'heartbeat' })), HEARTBEAT_MS)
    log(`connected to ${HUB_URL} as ${SESSION_ID}`)
  }
  socket.onmessage = (event) => {
    let frame: { type?: string; messageId?: string; text?: string }
    try { frame = JSON.parse(String(event.data)) } catch { return }
    if (frame.type !== 'deliver' || typeof frame.text !== 'string') return
    void mcp.notification({
      method: 'notifications/claude/channel',
      params: { content: frame.text, meta: { chat_id: 'kitt', message_id: frame.messageId ?? '', reply_via: 'mcp__kitt__reply' } },
    }).catch((err) => log(`failed to deliver to Claude: ${err}`))
  }
  socket.onclose = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    if (ws === socket) ws = null
    setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
  socket.onerror = () => { /* onclose follows and schedules the retry */ }
}

await mcp.connect(new StdioServerTransport())
if (process.env['CLAUDE_CODE_ENTRYPOINT'] === 'sdk-cli') {
  log('spawned by an SDK-driven session; channel pushes cannot reach it, so not registering with the hub')
} else {
  connect()
}
process.stdin.on('end', () => process.exit(0))
