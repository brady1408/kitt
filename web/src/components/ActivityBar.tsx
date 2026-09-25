import type { SessionEntry } from '@kitt/hub/protocol'
import { barSegments, type Segment } from '@/lib/activity-bar'

const SEGMENT_STYLE: Record<Segment, string> = {
  empty: 'bg-secondary',
  idle: 'bg-amber/35',
  working: 'bg-amber shadow-amber animate-pulse',
  error: 'bg-primary shadow-signal',
  offline: 'bg-muted-foreground/25',
  dark: 'bg-muted-foreground/15',
}

/** Header instrument bar: one LED segment per session, bright and pulsing while that session works. */
export function ActivityBar({ registry, connected }: { registry: SessionEntry[]; connected: boolean }) {
  const segments = barSegments(registry, connected)
  const working = registry.filter((e) => e.status === 'working').length
  const online = registry.filter((e) => e.status !== 'offline').length
  const label = !connected ? 'Hub link lost' : working > 0 ? `${working} of ${online} sessions working` : `${online} sessions idle`
  return (
    <div className="flex items-center gap-2" role="status" aria-label={label} title={label}>
      <div className="flex flex-1 gap-[3px]">
        {segments.map((s, i) => <span key={i} className={`h-2.5 flex-1 rounded-[1px] ${SEGMENT_STYLE[s]}`} />)}
      </div>
      <span className={`w-6 text-right font-mono text-[10px] ${connected ? 'text-green' : 'text-muted-foreground'}`}>{connected ? working : '--'}</span>
    </div>
  )
}
