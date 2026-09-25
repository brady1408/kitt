import type { ChatMessage, ServerFrame, SessionEntry, SystemStats, Task, Usage } from '@kitt/hub/protocol'

export type LiveTurn = { turnId: string; text: string; tools: string[] }

export type HubState = {
  connected: boolean
  registry: SessionEntry[]
  messages: Record<string, ChatMessage[]>
  live: Record<string, LiveTurn | null>
  tasks: Task[]
  usage: Usage
  system: SystemStats | null
  lastError: string | null
}

export type HubAction =
  | { type: 'connected'; value: boolean }
  | { type: 'frame'; frame: ServerFrame }
  | { type: 'dismissError' }

export const initialState: HubState = {
  connected: false, registry: [], messages: {}, live: {}, tasks: [],
  usage: { context: 0, contextWindow: 1_000_000, plan: { fiveHour: null, sevenDay: null } }, system: null, lastError: null,
}

const KIND_ORDER: Record<SessionEntry['kind'], number> = { kitt: 0, task: 1, spoke: 2 }
const sortRegistry = (r: SessionEntry[]) => [...r].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))

function append(state: HubState, target: string, ...items: ChatMessage[]): HubState {
  return { ...state, messages: { ...state.messages, [target]: [...(state.messages[target] ?? []), ...items] } }
}

export function reduce(state: HubState, action: HubAction): HubState {
  if (action.type === 'connected') return { ...state, connected: action.value }
  if (action.type === 'dismissError') return { ...state, lastError: null }
  const f = action.frame
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
      return append(state, f.target, { id: crypto.randomUUID(), target: f.target, role: 'system', text: f.text, toolSummary: null, createdAt: Date.now() })
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
