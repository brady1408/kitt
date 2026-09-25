import type { Lamp } from '@/lib/lamps'
import { VoiceBox } from '@/components/VoiceBox'

export type SendMode = 'kitt' | 'task' | 'pursuit'

const LAMP_STYLE: Record<Lamp['tone'], { lit: string; off: string }> = {
  yellow: { lit: 'bg-amber text-black shadow-amber', off: 'bg-amber/15 text-amber/50' },
  red: { lit: 'bg-primary text-white shadow-signal', off: 'bg-primary/15 text-primary/45' },
}

const CONTROL_LAMPS = new Set<Lamp['id']>(['voice', 'mic'])

function LampPlate({ lamp, onClick, onPointer }: { lamp: Lamp; onClick?: () => void; onPointer?: (phase: 'down' | 'up') => void }) {
  const control = CONTROL_LAMPS.has(lamp.id)
  const style = LAMP_STYLE[lamp.tone][lamp.lit ? 'lit' : 'off']
  const held = onPointer !== undefined
  return (
    <button
      type="button"
      onClick={held ? undefined : onClick}
      onPointerDown={held ? (e) => { e.preventDefault(); onPointer('down') } : undefined}
      onPointerUp={held ? () => onPointer('up') : undefined}
      onPointerCancel={held ? () => onPointer('up') : undefined}
      onContextMenu={held ? (e) => e.preventDefault() : undefined}
      disabled={!control}
      aria-pressed={control ? lamp.lit : undefined}
      title={lamp.id === 'mic' ? 'Hold to talk, or tap to toggle. Space bar also holds to talk.' : control ? `Toggle ${lamp.label}` : `${lamp.label}${lamp.lit ? ' active' : ''}`}
      className={`flex h-7 w-14 items-center justify-center gap-1 rounded-[3px] text-[9px] font-bold uppercase leading-none tracking-wide transition-colors ${style} ${control ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
    >
      <span>{lamp.label}</span>
      {lamp.detail && <span className="font-mono text-[8px] opacity-80">{lamp.detail}</span>}
    </button>
  )
}

const MODES: { id: SendMode; lines: [string, string]; active: string; off: string; gauge: string }[] = [
  { id: 'kitt', lines: ['Normal', 'Cruise'], active: 'bg-green text-black shadow-green', off: 'bg-green/10 text-green/50', gauge: 'bg-green shadow-green' },
  { id: 'task', lines: ['Auto', 'Cruise'], active: 'bg-amber text-black shadow-amber', off: 'bg-amber/10 text-amber/50', gauge: 'bg-amber shadow-amber' },
  { id: 'pursuit', lines: ['Pursuit', ''], active: 'bg-primary text-white shadow-signal', off: 'bg-primary/10 text-primary/45', gauge: 'bg-primary shadow-signal' },
]

export function VoiceModule({ lamps, onLamp, onMicPointer, mode, onMode, getLevel }: {
  lamps: Lamp[]
  onLamp: (id: Lamp['id']) => void
  onMicPointer: (phase: 'down' | 'up') => void
  mode: SendMode
  onMode: (mode: SendMode) => void
  getLevel: () => number
}) {
  const column = (side: Lamp['side']) => lamps.filter((l) => l.side === side)
  return (
    <div className="border border-border bg-background/60 p-3">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <div className="flex flex-col gap-1.5">{column('left').map((l) => <LampPlate key={l.id} lamp={l} onClick={() => onLamp(l.id)} onPointer={l.id === 'mic' ? onMicPointer : undefined} />)}</div>
        <div className="min-w-0"><VoiceBox getLevel={getLevel} frameless /></div>
        <div className="flex flex-col gap-1.5">{column('right').map((l) => <LampPlate key={l.id} lamp={l} onClick={() => onLamp(l.id)} />)}</div>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] items-stretch gap-3">
        <div className="flex w-2 flex-col gap-1" aria-hidden="true">
          {MODES.map((m) => <span key={m.id} className={`flex-1 rounded-[2px] ${mode === m.id ? m.gauge : 'bg-secondary'}`} />)}
        </div>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Send mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => onMode(m.id)}
              className={`h-9 cursor-pointer rounded-[3px] text-[10px] font-bold uppercase leading-tight tracking-wide transition-colors hover:brightness-125 ${mode === m.id ? m.active : m.off}`}>
              {m.lines[0]}{m.lines[1] && <><br />{m.lines[1]}</>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
