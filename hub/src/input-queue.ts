type Waiter<T> = (result: IteratorResult<T>) => void

export class InputQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: Waiter<T>[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) throw new Error('InputQueue is closed')
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as never, done: true })
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.items.length > 0) { yield this.items.shift() as T; continue }
      if (this.closed) return
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve))
      if (result.done) return
      yield result.value
    }
  }
}
