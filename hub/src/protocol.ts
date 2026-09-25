import { z } from 'zod'

export const KITT_TARGET = 'kitt'

export const SessionKind = z.enum(['kitt', 'task', 'spoke'])
export const SessionStatus = z.enum(['idle', 'working', 'offline', 'error'])
export const SessionEntry = z.object({
  id: z.string(),
  kind: SessionKind,
  name: z.string(),
  cwd: z.string(),
  status: SessionStatus,
  lastActivity: z.number(),
  sessionId: z.string().optional(),
  pid: z.number().optional(),
})
export type SessionEntry = z.infer<typeof SessionEntry>

export const ChatMessage = z.object({
  id: z.string(),
  target: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
  toolSummary: z.string().nullable(),
  createdAt: z.number(),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const TaskStatus = z.enum(['queued', 'running', 'done', 'error', 'cancelled', 'interrupted'])
export const Task = z.object({
  id: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  status: TaskStatus,
  output: z.string(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
  usageIn: z.number(),
  usageOut: z.number(),
  costUsd: z.number(),
})
export type Task = z.infer<typeof Task>

export const TurnUsage = z.object({
  input: z.number(), output: z.number(), cacheRead: z.number(), cacheCreate: z.number(),
})
export type TurnUsage = z.infer<typeof TurnUsage>

export const Usage = z.object({
  context: z.number(), contextWindow: z.number(), h5: z.number(), d7: z.number(),
})
export type Usage = z.infer<typeof Usage>

const text = z.string().trim().min(1).max(20000)

export const ClientFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('chat.send'), target: z.string().min(1), text }),
  z.object({ type: z.literal('chat.clear') }),
  z.object({ type: z.literal('chat.interrupt') }),
  z.object({ type: z.literal('task.create'), prompt: text, cwd: z.string().optional() }),
  z.object({ type: z.literal('task.cancel'), id: z.string() }),
  z.object({ type: z.literal('task.delete'), id: z.string() }),
])
export type ClientFrame = z.infer<typeof ClientFrame>

export const ServerFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), registry: z.array(SessionEntry), messages: z.array(ChatMessage), tasks: z.array(Task), usage: Usage }),
  z.object({ type: z.literal('registry.update'), entry: SessionEntry }),
  z.object({ type: z.literal('chat.user'), message: ChatMessage }),
  z.object({ type: z.literal('chat.delta'), target: z.string(), turnId: z.string(), text: z.string() }),
  z.object({ type: z.literal('chat.tool'), target: z.string(), turnId: z.string(), name: z.string(), summary: z.string() }),
  z.object({ type: z.literal('chat.done'), target: z.string(), turnId: z.string(), message: ChatMessage, usage: TurnUsage.nullable() }),
  z.object({ type: z.literal('chat.system'), target: z.string(), text: z.string() }),
  z.object({ type: z.literal('task.update'), task: Task }),
  z.object({ type: z.literal('usage.update'), usage: Usage }),
  z.object({ type: z.literal('error'), code: z.string(), text: z.string(), ref: z.string().optional() }),
])
export type ServerFrame = z.infer<typeof ServerFrame>

export const SpokeFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('register'), sessionId: z.string().min(1), pid: z.number(), cwd: z.string(), name: z.string() }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({ type: z.literal('reply'), text: z.string(), replyTo: z.string().optional() }),
])
export type SpokeFrame = z.infer<typeof SpokeFrame>

export const HubToSpokeFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('registered'), id: z.string() }),
  z.object({ type: z.literal('deliver'), messageId: z.string(), text: z.string() }),
])
export type HubToSpokeFrame = z.infer<typeof HubToSpokeFrame>
