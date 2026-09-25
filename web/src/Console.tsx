import { Markdown } from '@/components/Markdown'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Bot, ChevronDown, Gauge, Play, Radio, Send, Square, Trash2, Volume2, X } from 'lucide-react'
import type { ChatMessage, PlanWindow, SessionEntry, Task } from '@kitt/hub/protocol'
import { Button } from '@/components/ui/button'
import { FrontScanner } from '@/components/VoiceBox'
import { ActivityBar } from '@/components/ActivityBar'
import { getLevel, resumeAudio, speak, startMic, stopMic, watchMediaElements } from '@/lib/audio-meter'
import { useHub } from '@/lib/hub-context'
import { radarLayout } from '@/lib/radar'
import { deriveLamps, type Lamp } from '@/lib/lamps'
import { createNarrator } from '@/lib/narrator'
import type { ActivityEvent } from '@/lib/hub-store'
import { VoiceModule, type SendMode } from '@/components/VoiceModule'

const KITT = 'kitt'
const NO_MESSAGES: ChatMessage[] = []

export function Console() {
  const { state, actions } = useHub()
  const [mode, setMode] = useState<SendMode>('kitt')
  const [terminal, setTerminal] = useState<string | null>(null)
  const [taskCwd, setTaskCwd] = useState('')
  const target = mode === 'pursuit' && terminal ? terminal : KITT
  const [voiceOn, setVoiceOn] = useState(true)
  const voiceRef = useRef(voiceOn)
  voiceRef.current = voiceOn
  const targetRef = useRef(target)
  targetRef.current = target
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const recRef = useRef<{ stop: () => void } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const messages = state.messages[target] ?? NO_MESSAGES
  const live = state.live[target] ?? null
  const busy = live !== null
  const targetEntry = state.registry.find((e) => e.id === target)
  const terminalEntry = terminal ? state.registry.find((e) => e.id === terminal) : undefined
  const targetOffline = mode === 'pursuit' && (!terminalEntry || terminalEntry.status === 'offline')
  const selectSession = (entry: SessionEntry) => {
    if (entry.kind === 'spoke') { setTerminal(entry.id); setMode('pursuit') }
    else if (entry.kind === 'kitt') setMode('kitt')
  }
  const lamps = deriveLamps({
    voiceOn, listening, connected: state.connected,
    planStatus: state.usage.plan.fiveHour?.status ?? state.usage.plan.sevenDay?.status ?? 'allowed',
    system: state.system,
    tasksRunning: state.tasks.filter((t) => t.status === 'running').length,
    terminalsOnline: state.registry.filter((e) => e.kind === 'spoke' && e.status !== 'offline').length,
  })

  useEffect(() => watchMediaElements(), [])
  useEffect(() => {
    const narrator = createNarrator({
      speak: (text) => speak(text, { queue: true }),
      enabled: () => voiceRef.current,
      target: () => targetRef.current,
    })
    return actions.onFrame((frame) => narrator.handle(frame))
  }, [actions])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, live])
  const wasBusy = useRef(false)
  useEffect(() => {
    const finishedTurn = wasBusy.current && !busy
    wasBusy.current = busy
    if (!finishedTurn || !window.matchMedia('(min-width: 768px)').matches) return
    const active = document.activeElement
    const typingElsewhere = active instanceof HTMLElement && active !== inputRef.current && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
    if (!typingElsewhere) inputRef.current?.focus()
  }, [busy])

  const send = (text: string) => {
    const value = text.trim()
    if (!value) return
    if (mode === 'task') { actions.createTask(value, taskCwd.trim() || undefined); setInput(''); return }
    if (busy || targetOffline) return
    resumeAudio()
    window.speechSynthesis?.cancel()
    actions.sendChat(target, value)
    setInput('')
  }
  const onLamp = (id: Lamp['id']) => {
    if (id === 'voice') { setVoiceOn((v) => !v); window.speechSynthesis?.cancel() }
    if (id === 'mic') void toggleMic()
  }
  const placeholder = mode === 'task' ? `Assign a background operation… (${taskCwd.trim() || '~/pa'})`
    : targetOffline ? (terminalEntry ? 'Session offline' : 'Select a terminal on the radar or in Agent network')
    : mode === 'pursuit' ? `Transmit to ${terminalEntry?.name ?? 'terminal'}…` : 'Awaiting command…'

  const toggleMic = async () => {
    resumeAudio()
    if (listening) { recRef.current?.stop(); return }
    const w = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition
    try { await startMic() } catch { /* the browser shows its own permission feedback */ }
    if (!Recognition) { window.alert("Voice input isn't supported in this browser — try Chrome."); stopMic(); return }
    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    let finalText = ''
    recognition.onresult = (event: any) => {
      let interim = ''
      for (const result of event.results) result.isFinal ? (finalText = result[0].transcript) : (interim = result[0].transcript)
      setInput(finalText || interim)
    }
    recognition.onend = () => { setListening(false); stopMic(); if (finalText) send(finalText) }
    recRef.current = recognition
    recognition.start()
    setListening(true)
  }

  const activeCount = state.registry.filter((e) => e.status === 'working').length

  return (
    <div className="console-grid relative min-h-screen overflow-hidden bg-background p-3 text-foreground md:p-5 xl:flex xl:h-screen xl:flex-col">
      <div className="scanlines pointer-events-none fixed inset-0 z-50 opacity-15" />
      <header className="mx-auto mb-4 flex w-full max-w-[1600px] items-center justify-between border-b border-border bg-card/60 px-4 py-3 panel-cut">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`h-2 w-2 ${state.connected ? 'animate-pulse bg-primary shadow-signal' : 'bg-destructive'}`} />
          <div><h1 className="font-display text-3xl leading-none text-primary">K.I.T.T.</h1><p className="truncate text-[9px] uppercase text-muted-foreground">Knight Industries Two Thousand</p></div>
        </div>
        <div className="hidden w-56 sm:block"><ActivityBar registry={state.registry} connected={state.connected} /></div>
        <div className="text-right font-mono text-[9px] uppercase text-muted-foreground"><p className={state.connected ? 'text-green' : 'text-primary'}>{state.connected ? 'Neural link active' : 'Neural link lost'}</p><p>Console / 04.18</p></div>
      </header>

      <div className="relative mx-auto mb-4 w-full max-w-[1600px]"><FrontScanner /></div>

      <div className="mx-auto grid w-full max-w-[1600px] gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[250px_minmax(440px,1fr)_330px]">
        <aside className="space-y-4 xl:flex xl:min-h-0 xl:flex-col xl:overflow-y-auto">
          <SystemPanel connected={state.connected} planStatus={state.usage.plan.fiveHour?.status ?? state.usage.plan.sevenDay?.status ?? 'allowed'} />
          <UsagePanel />
          <section className="border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Bot} status={`${activeCount} active`}>Agent network</PanelTitle>
            {state.registry.map((entry) => (
              <AgentRow key={entry.id} entry={entry} selected={entry.id === target} onSelect={() => selectSession(entry)} />
            ))}
            {state.registry.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No sessions online.</p>}
          </section>
          <SignalField registry={state.registry} activity={state.activity} target={target} onSelect={(id) => { const e = state.registry.find((x) => x.id === id); if (e) selectSession(e) }} />
        </aside>

        <main className="flex min-h-[720px] flex-col overflow-hidden border border-border bg-card/75 panel-cut xl:min-h-0">
          {mode === 'pursuit' && (
            <div className="flex items-center justify-between border-b border-border bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase">
              <span>Pursuit → {terminalEntry?.name ?? 'no terminal selected'} <span className="text-muted-foreground">{terminalEntry?.cwd}</span>{terminalEntry && targetOffline && <span className="ml-2 text-destructive">offline</span>}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setMode('kitt')}><X />Normal cruise</Button>
            </div>
          )}
          {mode === 'task' && (
            <div className="flex items-center justify-between border-b border-border bg-amber/10 px-4 py-2 font-mono text-[10px] uppercase">
              <span className="text-amber">Auto cruise → commands dispatch as background tasks in {taskCwd.trim() || '~/pa'}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setMode('kitt')}><X />Normal cruise</Button>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
            {messages.length === 0 && !live && <div className="py-12 text-center"><p className="font-display text-2xl text-primary">Voice command ready</p><p className="mt-2 text-sm text-muted-foreground">Good evening. How may I assist you?</p></div>}
            {messages.map((message) => <MessageRow key={message.id} message={message} />)}
            {live && (
              <div className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 animate-pulse bg-primary shadow-signal" />
                <div className="prose prose-invert max-w-none text-sm text-foreground">
                  <span className="mb-1 block font-display text-sm text-primary">K.I.T.T. / RESPONSE</span>
                  {live.tools.map((t, i) => <ToolLine key={i} summary={t} />)}
                  {live.text ? <Markdown>{live.text}</Markdown> : <p className="animate-pulse font-mono text-xs uppercase text-amber">Processing command…</p>}
                </div>
              </div>
            )}
            {state.lastError && (
              <div className="flex items-center justify-between border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <span>{state.lastError}</span>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={actions.dismissError}><X /></Button>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={(event) => { event.preventDefault(); send(input) }} className="flex gap-2 border-t border-border bg-background/60 p-3">
            <textarea ref={inputRef} rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(input) } }} placeholder={placeholder} disabled={targetOffline} className="min-h-10 flex-1 resize-none border border-input bg-background px-3 py-2 text-sm outline-none placeholder:uppercase placeholder:text-muted-foreground focus:border-primary disabled:opacity-50" />
            {busy && mode === 'kitt'
              ? <Button type="button" size="icon" variant="outline" onClick={actions.interrupt} aria-label="Interrupt"><Square /></Button>
              : <Button type="submit" size="icon" disabled={(mode !== 'task' && busy) || targetOffline || !input.trim()} aria-label={mode === 'task' ? 'Dispatch task' : 'Send command'}>{mode === 'task' ? <Play /> : <Send />}</Button>}
          </form>
        </main>

        <aside className="space-y-4 xl:flex xl:min-h-0 xl:flex-col xl:overflow-y-auto">
          <section className="border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Radio} status={listening ? 'Listening' : mode === 'kitt' ? 'Normal cruise' : mode === 'task' ? 'Auto cruise' : 'Pursuit'}
              action={<Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" title="Clear KITT conversation" aria-label="Clear KITT conversation" onClick={() => { window.speechSynthesis?.cancel(); actions.clearChat() }}><Trash2 /></Button>}>
              Comms control
            </PanelTitle>
            <VoiceModule lamps={lamps} onLamp={onLamp} mode={mode} onMode={setMode} getLevel={getLevel} />
          </section>
          <TaskPanel cwd={taskCwd} onCwd={setTaskCwd} />
        </aside>
      </div>

      <footer className="mx-auto mt-4 flex w-full max-w-[1600px] items-center justify-between border-t border-border pt-2 font-mono text-[9px] uppercase text-muted-foreground">
        <span>{state.connected ? 'All systems operational' : 'Reconnecting…'}</span><span className="hidden sm:inline">Encrypted channel / Agent mesh connected</span><span className="text-primary">KITT-OS 4.18</span>
      </footer>
    </div>
  )
}

function SystemPanel({ connected, planStatus }: { connected: boolean; planStatus: PlanWindow['status'] }) {
  const { state } = useHub()
  const s = state.system
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const degraded = !connected || planStatus === 'rejected' || (s !== null && (s.load > 0.8 || s.memUsed > 0.9 || s.diskUsed > 0.9))
  const warning = planStatus === 'allowed_warning' || (s !== null && (s.load > 0.6 || s.memUsed > 0.8 || s.diskUsed > 0.8))
  const badge = !connected ? 'Link lost' : degraded ? 'Degraded' : warning ? 'Warning' : 'Nominal'
  const apiPct = s?.apiMs == null ? 0 : Math.min(1, s.apiMs / 30_000)
  return (
    <section className="border border-border bg-card/75 p-3 panel-cut">
      <PanelTitle icon={Activity} status={badge}>System status</PanelTitle>
      <Metric label="Neural load" value={s ? pct(s.load) : '—'} width={s ? pct(s.load) : '0%'} tone={s && s.load > 0.8 ? 'red' : 'amber'} />
      <Metric label="Memory buffer" value={s ? pct(s.memUsed) : '—'} width={s ? pct(s.memUsed) : '0%'} tone={s && s.memUsed > 0.9 ? 'red' : 'amber'} />
      <Metric label="Drive space" value={s ? `${pct(s.diskUsed)} · ${s.diskFreeGb} GB free` : '—'} width={s ? pct(s.diskUsed) : '0%'} tone={s && s.diskUsed > 0.9 ? 'red' : 'amber'} />
      <Metric label="Secure comms" value={s?.apiMs == null ? (connected ? 'Standing by' : 'Offline') : `${(s.apiMs / 1000).toFixed(1)}s`} width={`${Math.round(apiPct * 100)}%`} tone={connected ? 'amber' : 'red'} />
    </section>
  )
}

const RADAR = { inner: 0.42, outer: 0.86 }

const ACTIVITY_DOT: Record<ActivityEvent['tone'], string> = {
  amber: 'bg-amber', green: 'bg-green', red: 'bg-primary shadow-signal', muted: 'bg-muted-foreground/50',
}
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

function SignalField({ registry, activity, target, onSelect }: { registry: SessionEntry[]; activity: ActivityEvent[]; target: string; onSelect: (id: string) => void }) {
  const blips = radarLayout(registry, RADAR)
  const contacts = registry.filter((e) => e.status !== 'offline').length
  const known = new Set(registry.map((e) => e.id))
  return (
    <section className="flex flex-col overflow-hidden border border-border bg-card/75 p-3 panel-cut xl:min-h-0 xl:flex-1">
      <PanelTitle icon={Radio} status={`${contacts} contact${contacts === 1 ? '' : 's'}`}>Signal field</PanelTitle>
      <div className="relative mx-auto mb-3 h-28 w-28 shrink-0 rounded-full border border-primary/25">
        <div className="absolute inset-[16%] rounded-full border border-dashed border-primary/30" />
        <div className="radar-sweep absolute left-1/2 top-1/2 h-px w-1/2 origin-left bg-primary shadow-signal" />
        {blips.map(({ entry, x, y }) => (
          <button
            key={entry.id}
            type="button"
            title={`${entry.name} · ${entry.status}`}
            aria-label={`${entry.name}, ${entry.status}`}
            disabled={entry.kind === 'task'}
            onClick={() => onSelect(entry.id)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 disabled:cursor-default ${entry.id === target ? 'h-2.5 w-2.5 ring-1 ring-primary/70 ring-offset-1 ring-offset-background' : 'h-2 w-2'} ${STATUS_DOT[entry.status]}`}
            style={{ left: `${50 + x * 50}%`, top: `${50 + y * 50}%` }}
          />
        ))}
      </div>
      <ul className="min-h-0 max-h-40 flex-1 space-y-1 overflow-y-auto border-t border-border pt-2 font-mono text-[10px] uppercase xl:max-h-none" aria-label="Recent activity">
        {activity.length === 0 && <li className="py-3 text-center normal-case text-muted-foreground">No signals yet.</li>}
        {activity.map((a) => {
          const selectable = a.sessionId !== undefined && known.has(a.sessionId) && a.kind !== 'task'
          const row = (
            <>
              <span className="w-[4.2rem] shrink-0 text-muted-foreground">{clock(a.at)}</span>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 ${ACTIVITY_DOT[a.tone]}`} />
              <span className="min-w-0 truncate text-foreground/85">{a.text}</span>
            </>
          )
          return (
            <li key={a.id}>
              {selectable
                ? <button type="button" onClick={() => onSelect(a.sessionId!)} className="flex w-full items-start gap-2 text-left uppercase hover:text-primary">{row}</button>
                : <div className="flex items-start gap-2">{row}</div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PanelTitle({ icon: Icon, children, status, action }: { icon: typeof Activity; children: string; status?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
      <h2 className="flex items-center gap-2 font-display text-base uppercase text-primary"><Icon className="h-3.5 w-3.5" />{children}</h2>
      <span className="flex items-center gap-2">{status && <span className="font-mono text-[9px] uppercase text-green">{status}</span>}{action}</span>
    </div>
  )
}

type Tone = 'amber' | 'red'
const BAR: Record<Tone, string> = { amber: 'bg-amber shadow-amber', red: 'bg-primary shadow-signal' }

function Metric({ label, value, width, tone = 'amber' }: { label: string; value: string; width: string; tone?: Tone }) {
  return <div className="mb-3"><div className="mb-1 flex justify-between text-[10px] uppercase text-muted-foreground"><span>{label}</span><span className="font-mono text-green">{value}</span></div><div className="h-1 bg-secondary"><div className={`h-full ${BAR[tone]}`} style={{ width }} /></div></div>
}

function ToolLine({ summary }: { summary: string }) {
  return <p className="my-1 font-mono text-[10px] uppercase text-muted-foreground">→ {summary}</p>
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'system') return <p className="text-center font-mono text-[10px] uppercase text-green">{message.text}</p>
  if (message.role === 'user') return <div className="flex justify-end"><div className="max-w-[82%] border border-border bg-secondary/70 px-4 py-3 text-sm">{message.text}</div></div>
  if (message.toolSummary !== null) return <div className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0" /><ToolLine summary={message.toolSummary} /></div>
  return (
    <div className="flex gap-3">
      <span className="mt-1 h-2 w-2 shrink-0 bg-primary shadow-signal" />
      <div className="prose prose-invert max-w-none text-sm text-foreground">
        <span className="mb-1 block font-display text-sm text-primary">K.I.T.T. / RESPONSE</span>
        <Markdown>{message.text}</Markdown>
      </div>
    </div>
  )
}

const STATUS_DOT: Record<SessionEntry['status'], string> = {
  working: 'animate-pulse bg-primary shadow-signal', idle: 'bg-green shadow-green', offline: 'bg-muted-foreground/40', error: 'bg-destructive',
}
const STATUS_TEXT: Record<SessionEntry['status'], string> = {
  working: 'text-primary', idle: 'text-green', offline: 'text-muted-foreground', error: 'text-destructive',
}
const KIND_LABEL: Record<SessionEntry['kind'], string> = { kitt: 'core', task: 'task', spoke: 'terminal' }

function AgentRow({ entry, selected, onSelect }: { entry: SessionEntry; selected: boolean; onSelect: () => void }) {
  const dir = entry.cwd.split('/').filter(Boolean).slice(-2).join('/')
  return (
    <button type="button" onClick={onSelect} disabled={entry.kind === 'task'} className={`mb-2 flex w-full items-center gap-2 border p-2 text-left ${selected ? 'border-primary bg-primary/10' : 'border-border bg-background/45'} disabled:cursor-default`}>
      <span className={`h-2 w-2 shrink-0 ${STATUS_DOT[entry.status]}`} />
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium uppercase">{entry.name}</p><p className="truncate text-[10px] text-muted-foreground">{KIND_LABEL[entry.kind]} · {dir}</p></div>
      <span className={`text-[9px] uppercase ${STATUS_TEXT[entry.status]}`}>{entry.status}</span>
    </button>
  )
}

function resetsIn(epochSeconds: number, now: number): string {
  const mins = Math.max(0, Math.round((epochSeconds * 1000 - now) / 60_000))
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function PlanMeter({ label, window, now }: { label: string; window: PlanWindow | null; now: number }) {
  if (!window) return <Metric label={label} value="—" width="0%" />
  const pct = Math.min(100, window.utilization * 100)
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[10px] uppercase text-muted-foreground"><span>{label}</span><span className="font-mono text-green">{pct.toFixed(0)}% · resets {resetsIn(window.resetsAt, now)}</span></div>
      <div className="h-1 bg-secondary"><div className={`h-full ${window.status === 'allowed' ? BAR.amber : BAR.red}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function UsagePanel() {
  const { state } = useHub()
  const { context, contextWindow, plan } = state.usage
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const ctxPct = Math.min(100, (context / contextWindow) * 100)
  return (
    <section className="border border-border bg-card/75 p-3 panel-cut">
      <PanelTitle icon={Gauge} status={`${context.toLocaleString()} tok`}>Agent metrics</PanelTitle>
      <Metric label="Context used" value={`${ctxPct.toFixed(1)}%`} width={`${ctxPct}%`} />
      <div className="mb-3 flex justify-between text-[10px] uppercase text-muted-foreground"><span>Context window</span><span className="text-foreground">{(contextWindow / 1000).toFixed(0)}K</span></div>
      <PlanMeter label="5-hour plan usage" window={plan.fiveHour} now={now} />
      <PlanMeter label="7-day plan usage" window={plan.sevenDay} now={now} />
    </section>
  )
}

const TASK_DOT: Record<Task['status'], string> = {
  queued: 'bg-muted-foreground/60', running: 'animate-pulse bg-amber shadow-amber', done: 'bg-green shadow-green', error: 'bg-destructive', cancelled: 'bg-muted-foreground/40', interrupted: 'bg-destructive/60',
}

function TaskPanel({ cwd, onCwd }: { cwd: string; onCwd: (v: string) => void }) {
  const { state, actions } = useHub()
  const [prompt, setPrompt] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const running = state.tasks.filter((t) => t.status === 'running').length
  const run = () => {
    const value = prompt.trim()
    if (!value) return
    actions.createTask(value, cwd.trim() || undefined)
    setPrompt('')
  }
  return (
    <section className="flex min-h-[390px] flex-col border border-border bg-card/75 p-3 panel-cut xl:min-h-0 xl:flex-1">
      <PanelTitle icon={Bot} status={`${running} running`}>Task queue</PanelTitle>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} placeholder="Assign a background operation…" className="w-full resize-none border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
      <input value={cwd} onChange={(event) => onCwd(event.target.value)} placeholder="Working directory (default ~/pa)" className="mt-2 w-full border border-input bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-primary" />
      <Button onClick={run} disabled={!prompt.trim()} className="mt-2 w-full"><Play />Dispatch agent</Button>
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {state.tasks.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Queue clear. Agents standing by.</div>}
        {state.tasks.map((task) => (
          <div key={task.id} className="border border-border bg-background/50">
            <div className="flex items-start gap-2 p-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === task.id ? null : task.id)} className="h-auto min-w-0 flex-1 justify-start px-1 text-left">
                <span className={`h-2 w-2 shrink-0 ${TASK_DOT[task.status]}`} />
                <span className="line-clamp-2 whitespace-normal text-xs">{task.prompt}</span><ChevronDown className="ml-auto" />
              </Button>
              {task.status === 'running' || task.status === 'queued'
                ? <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => actions.cancelTask(task.id)} aria-label="Cancel task"><Square /></Button>
                : <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => actions.deleteTask(task.id)} aria-label="Remove task"><Trash2 /></Button>}
            </div>
            {open === task.id && (
              <div className="prose prose-invert max-w-none border-t border-border p-3 text-xs">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">{task.status} · {task.cwd}</p>
                <Markdown>{task.output || '_Agent working…_'}</Markdown>
                {task.status === 'done' && <Button variant="link" size="sm" className="mt-1 px-0" onClick={() => speak(task.output)}><Volume2 />Read aloud</Button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
