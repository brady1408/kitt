import { InputQueue } from '../src/input-queue'
import type { AgentRunner, RunnerEvent, RunnerFactory, RunnerOptions } from '../src/runner'

export class FakeRunner implements AgentRunner {
  private queue = new InputQueue<RunnerEvent>()
  events: AsyncIterable<RunnerEvent> = this.queue
  sent: string[] = []
  interrupted = 0
  closed = false

  send(text: string): void { this.sent.push(text) }
  async interrupt(): Promise<void> { this.interrupted++ }
  close(): void { this.closed = true; try { this.queue.close() } catch { /* closed */ } }
  emit(e: RunnerEvent): void { this.queue.push(e) }
  end(error?: string): void {
    this.queue.push(error === undefined ? { type: 'exit' } : { type: 'exit', error })
    this.queue.close()
  }
}

export function fakeFactory(): { factory: RunnerFactory; runners: FakeRunner[]; calls: RunnerOptions[] } {
  const runners: FakeRunner[] = []
  const calls: RunnerOptions[] = []
  const factory: RunnerFactory = (opts) => {
    calls.push(opts)
    const r = new FakeRunner()
    runners.push(r)
    return r
  }
  return { factory, runners, calls }
}
