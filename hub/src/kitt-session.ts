import { randomUUID } from 'node:crypto'
import type { AgentRunner, RunnerFactory } from './runner'
import { contextWindowFor } from './runner'
import type { Store } from './store'
import type { Registry } from './registry'
import type { ChatMessage, ServerFrame, TurnUsage, Usage } from './protocol'
import { KITT_TARGET } from './protocol'

const H5 = 5 * 3600e3
const D7 = 7 * 864e5
export const SESSION_KEY = 'kitt_session_id'

export type KittDeps = {
  factory: RunnerFactory
  store: Store
  registry: Registry
  cwd: string
  persona: string
  emit: (f: ServerFrame) => void
}

type Turn = { turnId: string; text: string; buffer: string }

export class KittSession {
  private runner: AgentRunner | null = null
  private queue: { turnId: string; text: string }[] = []
  private inFlight: Turn | null = null
  private sawInit = false
  private startedWithResume = false
  private model = ''
  private lastContext = 0

  constructor(private deps: KittDeps) {}

  start(): void {
    this.launch(this.storedSessionId())
  }

  send(text: string): ChatMessage {
    const msg = this.deps.store.insertMessage({
      id: randomUUID(), target: KITT_TARGET, role: 'user', text, toolSummary: null, createdAt: Date.now(),
    })
    this.deps.emit({ type: 'chat.user', message: msg })
    this.queue.push({ turnId: randomUUID(), text })
    if (!this.runner) this.launch(this.storedSessionId())
    this.pump()
    return msg
  }

  clear(): void {
    const old = this.runner
    this.runner = null
    old?.close()
    this.queue = []
    this.inFlight = null
    this.lastContext = 0
    this.deps.store.clearMessages(KITT_TARGET)
    this.deps.store.kvSet(SESSION_KEY, '')
    this.launch(undefined)
    this.deps.emit({ type: 'chat.system', target: KITT_TARGET, text: 'Fresh session started.' })
    this.deps.emit({ type: 'usage.update', usage: this.usage() })
  }

  async interrupt(): Promise<void> {
    await this.runner?.interrupt()
  }

  usage(): Usage {
    return {
      context: this.lastContext,
      contextWindow: contextWindowFor(this.model),
      h5: this.deps.store.sumUsageSince(H5),
      d7: this.deps.store.sumUsageSince(D7),
    }
  }

  private storedSessionId(): string | undefined {
    return this.deps.store.kvGet(SESSION_KEY) || undefined
  }

  private launch(resume: string | undefined): void {
    this.sawInit = false
    this.startedWithResume = resume !== undefined
    const runner = this.deps.factory({
      cwd: this.deps.cwd,
      appendSystemPrompt: this.deps.persona,
      ...(resume ? { resume } : {}),
    })
    this.runner = runner
    this.deps.registry.upsert({
      id: KITT_TARGET, kind: 'kitt', name: 'K.I.T.T.', cwd: this.deps.cwd, status: 'idle',
      lastActivity: Date.now(), ...(resume ? { sessionId: resume } : {}),
    })
    void this.consume(runner)
  }

  private pump(): void {
    if (this.inFlight || !this.runner) return
    const next = this.queue.shift()
    if (!next) return
    this.inFlight = { ...next, buffer: '' }
    this.deps.registry.patch(KITT_TARGET, { status: 'working' })
    this.runner.send(next.text)
  }

  private async consume(runner: AgentRunner): Promise<void> {
    for await (const ev of runner.events) {
      if (runner !== this.runner) return
      switch (ev.type) {
        case 'init':
          this.model = ev.model
          if (!this.sawInit) {
            this.sawInit = true
            this.deps.store.kvSet(SESSION_KEY, ev.sessionId)
            this.deps.registry.patch(KITT_TARGET, { sessionId: ev.sessionId })
          }
          break
        case 'delta':
          if (this.inFlight) {
            this.inFlight.buffer += ev.text
            this.deps.emit({ type: 'chat.delta', target: KITT_TARGET, turnId: this.inFlight.turnId, text: ev.text })
          }
          break
        case 'tool':
          if (this.inFlight) {
            this.deps.store.insertMessage({
              id: randomUUID(), target: KITT_TARGET, role: 'assistant', text: '', toolSummary: ev.summary, createdAt: Date.now(),
            })
            this.deps.emit({ type: 'chat.tool', target: KITT_TARGET, turnId: this.inFlight.turnId, name: ev.name, summary: ev.summary })
          }
          break
        case 'result':
          this.finishTurn(ev.text, ev.usage, ev.ok)
          break
        case 'exit':
          this.handleExit(ev.error)
          return
      }
    }
  }

  private finishTurn(resultText: string, usage: TurnUsage, ok: boolean): void {
    const turn = this.inFlight
    if (!turn) return
    const text = turn.buffer.trim() || resultText
    const msg = this.deps.store.insertMessage({
      id: randomUUID(), target: KITT_TARGET, role: 'assistant', text, toolSummary: null, createdAt: Date.now(),
    })
    const contextTokens = usage.input + usage.cacheRead + usage.cacheCreate
    this.deps.store.recordUsage('kitt', contextTokens, usage.output)
    this.lastContext = contextTokens
    this.inFlight = null
    this.deps.registry.patch(KITT_TARGET, { status: ok ? 'idle' : 'error' })
    this.deps.emit({ type: 'chat.done', target: KITT_TARGET, turnId: turn.turnId, message: msg, usage })
    this.deps.emit({ type: 'usage.update', usage: this.usage() })
    this.pump()
  }

  private handleExit(error?: string): void {
    this.runner = null
    if (!this.sawInit && this.startedWithResume) {
      this.deps.store.kvSet(SESSION_KEY, '')
      this.deps.emit({ type: 'chat.system', target: KITT_TARGET, text: 'Could not resume the previous session. Starting fresh.' })
      if (this.inFlight) {
        this.queue.unshift({ turnId: this.inFlight.turnId, text: this.inFlight.text })
        this.inFlight = null
      }
      this.launch(undefined)
      this.pump()
      return
    }
    const hadTurn = this.inFlight !== null
    this.inFlight = null
    this.deps.registry.patch(KITT_TARGET, { status: 'error' })
    this.deps.emit({
      type: 'chat.system', target: KITT_TARGET,
      text: `KITT session ended${error ? `: ${error}` : ''}. It will resume on your next message.`,
    })
    if (hadTurn) this.deps.emit({ type: 'error', code: 'session_exit', text: 'The session ended mid-turn. Send your message again.' })
  }
}
