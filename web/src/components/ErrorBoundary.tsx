import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }

/** Keeps a render error from blanking the whole console; shows the reason and a reload button instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('console render error', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-lg border border-destructive/50 bg-destructive/10 p-5">
          <h1 className="font-display text-2xl uppercase text-primary">Console crashed</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{this.state.error.message}</p>
          <p className="mt-3 text-sm">The hub and your sessions are unaffected. Reload to reconnect; if it happens again, the message above is what to report.</p>
          <button type="button" onClick={() => location.reload()} className="mt-4 border border-primary px-4 py-2 text-sm uppercase text-primary hover:bg-primary/10">Reload console</button>
        </div>
      </div>
    )
  }
}
