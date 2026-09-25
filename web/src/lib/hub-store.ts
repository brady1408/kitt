import type { ChatMessage, ServerFrame, SessionEntry, SystemStats, Task, Usage } from '@kitt/hub/protocol'

export type LiveTurn = { turnId: string; text: string; tools: string[] }

export type ActivityEvent = {
  id: string
  at: number
  kind: 'tool' | 'task' | 'session' | 'plan' | 'system' | 'link'
  text: string
  tone: 'amber' | 'green' | 'red' | 'muted'
  sessionId?: string
}
const ACTIVITY_CAP = 200

// crypto.randomUUID is unavailable on insecure origins (the console is plain http on the LAN).
let seq = 0
const localId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`

export type HubState = {
  connected: boolean
  registry: SessionEntry[]
  messages: Record<string, ChatMessage[]>
  live: Record<string, LiveTurn | null>
  tasks: Task[]
  usage: Usage
  system: SystemStats | null
  activity: ActivityEvent[]
  linkLost: boolean
  lastError: string | null
}

export type HubAction =
  | { type: 'connected'; value: boolean }
  | { type: 'frame'; frame: ServerFrame }
  | { type: 'dismissError' }

export const initialState: HubState = {
  connected: false, registry: [], messages: {}, live: {}, tasks: [],
  usage: { context: 0, contextWindow: 1_000_000, plan: { fiveHour: null, sevenDay: null } }, system: null, activity: [], linkLost: false, lastError: null,
}

const KIND_ORDER: Record<SessionEntry['kind'], number> = { kitt: 0, task: 1, spoke: 2 }
const sortRegistry = (r: SessionEntry[]) => [...r].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))

function append(state: HubState, target: string, ...items: ChatMessage[]): HubState {
  return { ...state, messages: { ...state.messages, [target]: [...(state.messages[target] ?? []), ...items] } }
}

const event = (kind: ActivityEvent['kind'], text: string, tone: ActivityEvent['tone'], sessionId?: string): ActivityEvent =>
  ({ id: localId(), at: Date.now(), kind, text, tone, ...(sessionId ? { sessionId } : {}) })

const PLAN_RANK = { allowed: 0, allowed_warning: 1, rejected: 2 } as const
const worstPlan = (u: Usage) => {
  const statuses = [u.plan.fiveHour?.status, u.plan.sevenDay?.status].filter((s): s is keyof typeof PLAN_RANK => s !== undefined)
  return statuses.sort((a, b) => PLAN_RANK[b] - PLAN_RANK[a])[0] ?? 'allowed'
}
const TASK_TONE: Record<Task['status'], ActivityEvent['tone']> = { queued: 'muted', running: 'amber', done: 'green', error: 'red', cancelled: 'muted', interrupted: 'red' }
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)

/** Ticker lines derived from a frame, given the state before it is applied. */
function activityFor(prev: HubState, f: ServerFrame): ActivityEvent[] {
  switch (f.type) {
    case 'chat.tool':
      return [event('tool', f.summary, 'amber', f.target)]
    case 'chat.system':
      return [event('system', f.text, 'green', f.target)]
    case 'task.update': {
      const before = prev.tasks.find((t) => t.id === f.task.id)
      if (before && before.status === f.task.status) return []
      return [event('task', `Task ${f.task.status}: ${short(f.task.prompt)}`, TASK_TONE[f.task.status], f.task.id)]
    }
    case 'registry.update': {
      const before = prev.registry.find((e) => e.id === f.entry.id)
      if (f.entry.kind === 'spoke') {
        const wasOnline = before !== undefined && before.status !== 'offline'
        const isOnline = f.entry.status !== 'offline'
        if (!wasOnline && isOnline) return [event('session', `Terminal joined: ${f.entry.name}`, 'green', f.entry.id)]
        if (wasOnline && !isOnline) return [event('session', `Terminal offline: ${f.entry.name}`, 'muted', f.entry.id)]
        return []
      }
      if (f.entry.kind === 'kitt' && f.entry.status === 'error' && before?.status !== 'error') return [event('session', 'KITT session error', 'red', f.entry.id)]
      return []
    }
    case 'usage.update': {
      const was = worstPlan(prev.usage), now = worstPlan(f.usage)
      if (was === now) return []
      if (now === 'rejected') return [event('plan', 'Plan window rejected', 'red')]
      if (now === 'allowed_warning') return [event('plan', 'Plan window warning', 'amber')]
      return [event('plan', 'Plan window back to normal', 'green')]
    }
    case 'system.update': {
      const was = prev.system?.diskUsed ?? 0, now = f.stats.diskUsed
      if (was <= 0.9 && now > 0.9) return [event('system', 'Drive space above 90%', 'red')]
      if (was > 0.9 && now <= 0.9) return [event('system', 'Drive space back under 90%', 'green')]
      return []
    }
    default:
      return []
  }
}

const withActivity = (state: HubState, events: ActivityEvent[]): HubState =>
  events.length === 0 ? state : { ...state, activity: [...events.reverse(), ...state.activity].slice(0, ACTIVITY_CAP) }

export function reduce(state: HubState, action: HubAction): HubState {
  if (action.type === 'connected') {
    if (!action.value) return withActivity({ ...state, connected: false, linkLost: true }, [event('link', 'Link lost', 'red')])
    const restored = state.linkLost
    return withActivity({ ...state, connected: true, linkLost: false }, restored ? [event('link', 'Link restored', 'green')] : [])
  }
  if (action.type === 'dismissError') return { ...state, lastError: null }
  return withActivity(applyFrame(state, action.frame), activityFor(state, action.frame))
}

function applyFrame(state: HubState, f: ServerFrame): HubState {
  switch (f.type) {
    case 'snapshot': {
      const messages: Record<string, ChatMessage[]> = {}
      for (const m of f.messages) (messages[m.target] ??= []).push(m)
      return { ...state, registry: sortRegistry(f.registry), messages, live: {}, tasks: f.tasks, usage: f.usage, system: f.system }
    }
    case 'registry.update': {
      const rest = state.registry.filter((e) => e.id !== f.entry.id)
      return { ...state, registry: sortRegistry([...rest, f.entry]) }
    }
    case 'registry.remove':
      return { ...state, registry: state.registry.filter((e) => e.id !== f.id) }
    case 'chat.user':
      return append(state, f.message.target, f.message)
    case 'chat.delta': {
      const prev = state.live[f.target]
      const live: LiveTurn = prev && prev.turnId === f.turnId
        ? { ...prev, text: prev.text + f.text }
        : { turnId: f.turnId, text: f.text, tools: [] }
      return { ...state, live: { ...state.live, [f.target]: live } }
    }
    case 'chat.tool': {
      const prev = state.live[f.target]
      const live: LiveTurn = prev && prev.turnId === f.turnId
        ? { ...prev, tools: [...prev.tools, f.summary] }
        : { turnId: f.turnId, text: '', tools: [f.summary] }
      return { ...state, live: { ...state.live, [f.target]: live } }
    }
    case 'chat.done': {
      const prev = state.live[f.target]
      const toolLines: ChatMessage[] = (prev?.turnId === f.turnId ? prev.tools : []).map((summary, i) => ({
        id: `${f.turnId}-tool-${i}`, target: f.target, role: 'assistant', text: '', toolSummary: summary, createdAt: f.message.createdAt,
      }))
      const next = append(state, f.target, ...toolLines, f.message)
      return { ...next, live: { ...next.live, [f.target]: null } }
    }
    case 'chat.cleared':
      return { ...state, messages: { ...state.messages, [f.target]: [] }, live: { ...state.live, [f.target]: null } }
    case 'chat.system':
      return append(state, f.target, { id: localId(), target: f.target, role: 'system', text: f.text, toolSummary: null, createdAt: Date.now() })
    case 'task.update': {
      const rest = state.tasks.filter((t) => t.id !== f.task.id)
      return { ...state, tasks: [...rest, f.task].sort((a, b) => b.createdAt - a.createdAt) }
    }
    case 'task.deleted':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== f.id) }
    case 'usage.update':
      return { ...state, usage: f.usage }
    case 'system.update':
      return { ...state, system: f.stats }
    case 'error':
      return { ...state, lastError: f.text }
  }
}
