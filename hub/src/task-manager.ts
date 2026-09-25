import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { AgentRunner, RunnerFactory } from './runner'
import type { Store } from './store'
import type { PlanUsage } from './plan-usage'
import type { SystemMonitor } from './system-monitor'
import type { Registry } from './registry'
import type { ServerFrame, Task } from './protocol'

export type TaskDeps = {
  factory: RunnerFactory
  store: Store
  registry: Registry
  planUsage: PlanUsage
  system: SystemMonitor
  emit: (f: ServerFrame) => void
  defaultCwd: string
  homeDir: string
  taskPrompt: string
  maxRunning?: number
}

export class TaskManager {
  private running = new Map<string, AgentRunner>()
  private cancelling = new Set<string>()

  constructor(private deps: TaskDeps) {}

  markInterruptedOnStartup(): void {
    for (const t of this.deps.store.listTasks()) {
      if (t.status === 'running' || t.status === 'queued') {
        this.deps.store.upsertTask({ ...t, status: 'interrupted', finishedAt: Date.now() })
      }
    }
  }

  list(): Task[] {
    return this.deps.store.listTasks()
  }

  create(prompt: string, cwd?: string): Task {
    const task: Task = {
      id: randomUUID(), prompt, cwd: this.resolveCwd(cwd), status: 'queued', output: '',
      createdAt: Date.now(), finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0,
    }
    this.save(task)
    this.pump()
    return task
  }

  cancel(id: string): void {
    const runner = this.running.get(id)
    if (runner) {
      this.cancelling.add(id)
      runner.close()
      return
    }
    const queued = this.list().find((t) => t.id === id && t.status === 'queued')
    if (queued) this.save({ ...queued, status: 'cancelled', finishedAt: Date.now() })
  }

  delete(id: string): void {
    if (this.running.has(id)) throw new Error('task_running')
    this.deps.store.deleteTask(id)
    this.deps.emit({ type: 'task.deleted', id })
  }

  private resolveCwd(cwd?: string): string {
    const home = resolve(this.deps.homeDir)
    const trimmed = cwd?.trim() ?? ''
    const raw = trimmed ? trimmed.replace(/^~(?=$|\/)/, home) : this.deps.defaultCwd
    const dir = resolve(raw)
    const roots = [home, resolve(this.deps.defaultCwd)]
    if (!roots.some((root) => dir === root || dir.startsWith(root + sep))) throw new Error('bad_cwd')
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('bad_cwd')
    return dir
  }

  private finalizeIfRunning(id: string, current: Task, error?: string): Task {
    if (current.status !== 'running') return current
    const next: Task = {
      ...current,
      status: this.cancelling.has(id) ? 'cancelled' : 'error',
      finishedAt: Date.now(),
      output: error ? `${current.output}\n\nError: ${error}`.trim() : current.output,
    }
    this.save(next)
    return next
  }

  private save(task: Task): void {
    this.deps.store.upsertTask(task)
    this.deps.emit({ type: 'task.update', task })
  }

  private pump(): void {
    const max = this.deps.maxRunning ?? 3
    const queued = this.list().filter((t) => t.status === 'queued').reverse()
    for (const t of queued) {
      if (this.running.size >= max) break
      this.start(t)
    }
  }

  private start(task: Task): void {
    const runner = this.deps.factory({ cwd: task.cwd, appendSystemPrompt: this.deps.taskPrompt, prompt: task.prompt })
    this.running.set(task.id, runner)
    this.deps.registry.upsert({
      id: task.id, kind: 'task', name: task.prompt.slice(0, 40), cwd: task.cwd, status: 'working', lastActivity: Date.now(),
    })
    let current: Task = { ...task, status: 'running' }
    this.save(current)
    void (async () => {
      try {
      for await (const ev of runner.events) {
        if (ev.type === 'block') {
          if (current.output.trim() && !current.output.endsWith('\n\n')) {
            current = { ...current, output: `${current.output}\n\n` }
          }
        } else if (ev.type === 'delta') {
          current = { ...current, output: current.output + ev.text }
          this.save(current)
        } else if (ev.type === 'tool') {
          current = { ...current, output: `${current.output}\n\n_→ ${ev.summary}_\n\n` }
          this.save(current)
        } else if (ev.type === 'result') {
          if (ev.apiMs !== undefined) this.deps.system.noteApi(ev.apiMs)
          const usageIn = ev.usage.input + ev.usage.cacheRead + ev.usage.cacheCreate
          current = {
            ...current, status: ev.ok ? 'done' : 'error', output: current.output.trim() || ev.text,
            finishedAt: Date.now(), usageIn, usageOut: ev.usage.output, costUsd: ev.costUsd,
          }
          this.deps.store.recordUsage('task', usageIn, ev.usage.output)
          this.save(current)
        } else if (ev.type === 'ratelimit') {
          this.deps.planUsage.update(ev)
        } else if (ev.type === 'exit') {
          current = this.finalizeIfRunning(task.id, current, ev.error)
        }
      }
      } catch (err) {
        console.error(`task ${task.id} loop failed:`, err)
      } finally {
        try { current = this.finalizeIfRunning(task.id, current) } catch (err) { console.error(`task ${task.id} finalize failed:`, err) }
        this.running.delete(task.id)
        this.cancelling.delete(task.id)
        this.deps.registry.remove(task.id)
        this.pump()
      }
    })()
  }
}
