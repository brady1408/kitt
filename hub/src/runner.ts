import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { InputQueue } from './input-queue'
import type { PlanWindow, TurnUsage } from './protocol'

export type RunnerEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'result'; ok: boolean; text: string; usage: TurnUsage; costUsd: number; apiMs?: number }
  | { type: 'ratelimit'; window: 'five_hour' | 'seven_day'; utilization: number; resetsAt: number; status: PlanWindow['status'] }
  | { type: 'exit'; error?: string }

export interface AgentRunner {
  events: AsyncIterable<RunnerEvent>
  send(text: string): void
  interrupt(): Promise<void>
  close(): void
}

export type RunnerOptions = {
  cwd: string
  appendSystemPrompt: string
  resume?: string
  sessionId?: string
  prompt?: string
}

export type RunnerFactory = (opts: RunnerOptions) => AgentRunner

const PRIMARY_KEYS = ['command', 'file_path', 'pattern', 'query', 'url', 'prompt', 'description', 'text']

export function summarizeTool(name: string, input: unknown): string {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const key = PRIMARY_KEYS.find((k) => obj[k] !== undefined)
  const primary = key !== undefined ? obj[key] : Object.values(obj)[0]
  if (primary === undefined) return name
  const s = typeof primary === 'string' ? primary : JSON.stringify(primary)
  return `${name} ${s.replace(/\s+/g, ' ').slice(0, 80)}`
}

export function contextWindowFor(model: string): number {
  return /haiku|-3-|-4-5/.test(model) ? 200_000 : 1_000_000
}

export function translate(m: SDKMessage): RunnerEvent[] {
  if (m.type === 'system' && m.subtype === 'init') {
    return [{ type: 'init', sessionId: m.session_id, model: m.model }]
  }
  if (m.type === 'stream_event') {
    const ev = m.event
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') return [{ type: 'delta', text: ev.delta.text }]
    return []
  }
  if (m.type === 'assistant') {
    const out: RunnerEvent[] = []
    for (const block of m.message.content) {
      if (block.type === 'tool_use') out.push({ type: 'tool', name: block.name, summary: summarizeTool(block.name, block.input) })
    }
    return out
  }
  if (m.type === 'rate_limit_event') return translateRateLimit(m.rate_limit_info)
  if (m.type === 'result') {
    const u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } =
      'usage' in m && m.usage ? m.usage : {}
    const ok = m.subtype === 'success' && !m.is_error
    return [{
      type: 'result',
      ok,
      text: m.subtype === 'success' ? m.result : '',
      usage: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
      },
      costUsd: (m as { total_cost_usd?: number }).total_cost_usd ?? 0,
      ...(typeof m.duration_api_ms === 'number' ? { apiMs: m.duration_api_ms } : {}),
    }]
  }
  return []
}

type RateLimitInfo = {
  status: PlanWindow['status']
  rateLimitType?: string
  utilization?: number
  resetsAt?: number
  unifiedWindows?: Partial<Record<string, { utilization?: number; resetsAt?: number }>>
}

const WINDOWS = ['five_hour', 'seven_day'] as const

function translateRateLimit(info: RateLimitInfo): RunnerEvent[] {
  const out: RunnerEvent[] = []
  if (info.unifiedWindows) {
    for (const window of WINDOWS) {
      const w = info.unifiedWindows[window]
      if (w && typeof w.utilization === 'number' && typeof w.resetsAt === 'number') {
        out.push({ type: 'ratelimit', window, utilization: w.utilization, resetsAt: w.resetsAt, status: info.status })
      }
    }
    return out
  }
  const window = WINDOWS.find((w) => w === info.rateLimitType)
  if (window && typeof info.utilization === 'number' && typeof info.resetsAt === 'number') {
    out.push({ type: 'ratelimit', window, utilization: info.utilization, resetsAt: info.resetsAt, status: info.status })
  }
  return out
}

export const sdkRunner: RunnerFactory = (opts) => {
  const input = new InputQueue<SDKUserMessage>()
  const abortController = new AbortController()
  const q = query({
    prompt: opts.prompt ?? input,
    options: {
      cwd: opts.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.appendSystemPrompt },
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    },
  })

  async function* events(): AsyncIterable<RunnerEvent> {
    try {
      for await (const m of q) {
        for (const ev of translate(m)) yield ev
      }
      yield { type: 'exit' }
    } catch (err) {
      yield { type: 'exit', error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    events: events(),
    send(text) {
      input.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: text } })
    },
    async interrupt() { await q.interrupt() },
    close() {
      try { input.close() } catch { /* already closed */ }
      q.close()
    },
  }
}
