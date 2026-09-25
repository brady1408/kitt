import { Markdown } from '@/components/Markdown'
import { useEffect, useRef, useState } from 'react'
import { Activity, Bot, ChevronDown, Gauge, Mic, MicOff, Play, Radio, Send, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import type { ChatMessage, SessionEntry, Task } from '@kitt/hub/protocol'
import { Button } from '@/components/ui/button'
import { FrontScanner, VoiceBox, Scanner } from '@/components/VoiceBox'
import { getLevel, resumeAudio, speak, startMic, stopMic, watchMediaElements } from '@/lib/audio-meter'
import { useHub } from '@/lib/hub-context'

const KITT = 'kitt'

export function Console() {
  const { state, actions } = useHub()
  const [target, setTarget] = useState(KITT)
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

  const messages = state.messages[target] ?? []
  const live = state.live[target] ?? null
  const busy = live !== null
  const targetEntry = state.registry.find((e) => e.id === target)
  const targetOffline = target !== KITT && targetEntry?.status === 'offline'

  useEffect(() => watchMediaElements(), [])
  useEffect(() => actions.onDone((msg) => {
    if (voiceRef.current && msg.target === targetRef.current && msg.text) speak(msg.text)
  }), [actions])
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (!busy && window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus()
  }, [messages, live, busy])

  const send = (text: string) => {
    const value = text.trim()
    if (!value || busy || targetOffline) return
    resumeAudio()
    window.speechSynthesis?.cancel()
    actions.sendChat(target, value)
    setInput('')
  }

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
    <div className="console-grid relative min-h-screen overflow-hidden bg-background p-3 text-foreground md:p-5">
      <div className="scanlines pointer-events-none fixed inset-0 z-50 opacity-15" />
      <header className="mx-auto mb-4 flex max-w-[1600px] items-center justify-between border-b border-border bg-card/60 px-4 py-3 panel-cut">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`h-2 w-2 ${state.connected ? 'animate-pulse bg-primary shadow-signal' : 'bg-destructive'}`} />
          <div><h1 className="font-display text-3xl leading-none text-primary">K.I.T.T.</h1><p className="truncate text-[9px] uppercase text-muted-foreground">Knight Industries Two Thousand</p></div>
        </div>
        <div className="hidden w-52 sm:block"><Scanner active={busy} /></div>
        <div className="text-right font-mono text-[9px] uppercase text-muted-foreground"><p className="text-accent">{state.connected ? 'Neural link active' : 'Neural link lost'}</p><p>Console / 04.18</p></div>
      </header>

      <div className="relative mb-4 -mx-3 md:-mx-5"><FrontScanner /></div>

      <div className="mx-auto grid max-w-[1600px] gap-4 xl:grid-cols-[250px_minmax(440px,1fr)_330px]">
        <aside className="space-y-4">
          <section className="border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Activity} status="Nominal">System status</PanelTitle>
            <Metric label="Neural load" value="64%" width="64%" />
            <Metric label="Memory buffer" value="38%" width="38%" />
            <Metric label="Secure comms" value="99%" width="99%" />
          </section>
          <UsagePanel />
          <section className="border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Bot} status={`${activeCount} active`}>Agent network</PanelTitle>
            {state.registry.map((entry) => (
              <AgentRow key={entry.id} entry={entry} selected={entry.id === target} onSelect={() => setTarget(entry.id)} />
            ))}
            {state.registry.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No sessions online.</p>}
          </section>
          <section className="relative h-44 overflow-hidden border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Radio} status="Scanning">Signal field</PanelTitle>
            <div className="absolute left-1/2 top-[62%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/25">
              <div className="absolute inset-3 rounded-full border border-dashed border-primary/30" />
              <div className="absolute left-1/2 top-1/2 h-px w-1/2 origin-left -rotate-45 bg-primary shadow-signal" />
              <div className="absolute left-[66%] top-[25%] h-1.5 w-1.5 animate-pulse bg-accent" />
            </div>
          </section>
        </aside>

        <main className="flex min-h-[720px] flex-col overflow-hidden border border-border bg-card/75 panel-cut">
          <div className="border-b border-border p-4"><VoiceBox getLevel={getLevel} /></div>
          {target !== KITT && (
            <div className="flex items-center justify-between border-b border-border bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase">
              <span>Channel → {targetEntry?.name ?? target} <span className="text-muted-foreground">{targetEntry?.cwd}</span>{targetOffline && <span className="ml-2 text-destructive">offline</span>}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setTarget(KITT)}><X />Back to KITT</Button>
            </div>
          )}
          <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
            {messages.length === 0 && !live && <div className="py-12 text-center"><p className="font-display text-2xl text-primary">Voice command ready</p><p className="mt-2 text-sm text-muted-foreground">Good evening. How may I assist you?</p></div>}
            {messages.map((message) => <MessageRow key={message.id} message={message} />)}
            {live && (
              <div className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 animate-pulse bg-primary shadow-signal" />
                <div className="prose prose-invert max-w-none text-sm text-foreground">
                  <span className="mb-1 block font-display text-sm text-primary">K.I.T.T. / RESPONSE</span>
                  {live.tools.map((t, i) => <ToolLine key={i} summary={t} />)}
                  {live.text ? <Markdown>{live.text}</Markdown> : <p className="animate-pulse font-mono text-xs uppercase text-accent">Processing command…</p>}
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
            <textarea ref={inputRef} rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(input) } }} placeholder={targetOffline ? 'Session offline' : 'Awaiting command…'} disabled={targetOffline} className="min-h-10 flex-1 resize-none border border-input bg-background px-3 py-2 text-sm outline-none placeholder:uppercase placeholder:text-muted-foreground focus:border-primary disabled:opacity-50" />
            {busy && target === KITT
              ? <Button type="button" size="icon" variant="outline" onClick={actions.interrupt} aria-label="Interrupt"><Square /></Button>
              : <Button type="submit" size="icon" disabled={busy || targetOffline || !input.trim()} aria-label="Send command"><Send /></Button>}
          </form>
        </main>

        <aside className="space-y-4">
          <section className="border border-border bg-card/75 p-3 panel-cut">
            <PanelTitle icon={Radio} status={listening ? 'Listening' : 'Online'}>Comms control</PanelTitle>
            <div className="mb-3 flex h-20 items-end justify-center gap-1 overflow-hidden border border-border bg-background/50 px-6 pb-3">
              {[34, 72, 48, 88, 56, 96, 44, 78, 36, 66, 52, 84].map((height, index) => <span key={index} className="signal-bar w-1 bg-primary" style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={listening ? 'default' : 'outline'} onClick={toggleMic}>{listening ? <MicOff /> : <Mic />}{listening ? 'Stop' : 'Talk'}</Button>
              <Button variant="outline" onClick={() => { setVoiceOn(!voiceOn); window.speechSynthesis?.cancel() }}>{voiceOn ? <Volume2 /> : <VolumeX />}Voice</Button>
            </div>
            <Button variant="ghost" size="sm" className="mt-2 w-full text-muted-foreground" disabled={target !== KITT} onClick={() => { window.speechSynthesis?.cancel(); actions.clearChat() }}><Trash2 />Clear conversation</Button>
          </section>
          <TaskPanel />
        </aside>
      </div>

      <footer className="mx-auto mt-4 flex max-w-[1600px] items-center justify-between border-t border-border pt-2 font-mono text-[9px] uppercase text-muted-foreground">
        <span>{state.connected ? 'All systems operational' : 'Reconnecting…'}</span><span className="hidden sm:inline">Encrypted channel / Agent mesh connected</span><span className="text-primary">KITT-OS 4.18</span>
      </footer>
    </div>
  )
}

function PanelTitle({ icon: Icon, children, status }: { icon: typeof Activity; children: string; status?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
      <h2 className="flex items-center gap-2 font-display text-base uppercase text-primary"><Icon className="h-3.5 w-3.5" />{children}</h2>
      {status && <span className="font-mono text-[9px] uppercase text-accent">{status}</span>}
    </div>
  )
}

function Metric({ label, value, width }: { label: string; value: string; width: string }) {
  return <div className="mb-3"><div className="mb-1 flex justify-between text-[10px] uppercase text-muted-foreground"><span>{label}</span><span className="text-foreground">{value}</span></div><div className="h-1 bg-secondary"><div className="h-full bg-primary shadow-signal" style={{ width }} /></div></div>
}

function ToolLine({ summary }: { summary: string }) {
  return <p className="my-1 font-mono text-[10px] uppercase text-muted-foreground">→ {summary}</p>
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'system') return <p className="text-center font-mono text-[10px] uppercase text-accent">{message.text}</p>
  if (message.role === 'user') return <div className="flex justify-end"><div className="max-w-[82%] border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{message.text}</div></div>
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
  working: 'animate-pulse bg-primary shadow-signal', idle: 'bg-accent', offline: 'bg-muted-foreground/40', error: 'bg-destructive',
}
const KIND_LABEL: Record<SessionEntry['kind'], string> = { kitt: 'core', task: 'task', spoke: 'terminal' }

function AgentRow({ entry, selected, onSelect }: { entry: SessionEntry; selected: boolean; onSelect: () => void }) {
  const dir = entry.cwd.split('/').filter(Boolean).slice(-2).join('/')
  return (
    <button type="button" onClick={onSelect} disabled={entry.kind === 'task'} className={`mb-2 flex w-full items-center gap-2 border p-2 text-left ${selected ? 'border-primary bg-primary/10' : 'border-border bg-background/45'} disabled:cursor-default`}>
      <span className={`h-2 w-2 shrink-0 ${STATUS_DOT[entry.status]}`} />
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium uppercase">{entry.name}</p><p className="truncate text-[10px] text-muted-foreground">{KIND_LABEL[entry.kind]} · {dir}</p></div>
      <span className="text-[9px] uppercase text-primary">{entry.status}</span>
    </button>
  )
}

function UsagePanel() {
  const { state } = useHub()
  const { context, contextWindow, h5, d7 } = state.usage
  const BUDGET_5H = 1_000_000, BUDGET_7D = 10_000_000
  const pct = (n: number, d: number) => Math.min(100, (n / d) * 100)
  const ctxPct = pct(context, contextWindow)
  return (
    <section className="border border-border bg-card/75 p-3 panel-cut">
      <PanelTitle icon={Gauge} status={`${context.toLocaleString()} tok`}>Agent metrics</PanelTitle>
      <Metric label="Context used" value={`${ctxPct.toFixed(1)}%`} width={`${ctxPct}%`} />
      <div className="mb-3 flex justify-between text-[10px] uppercase text-muted-foreground"><span>Context window</span><span className="text-foreground">{(contextWindow / 1000).toFixed(0)}K</span></div>
      <Metric label="5-hour usage" value={`${pct(h5, BUDGET_5H).toFixed(1)}%`} width={`${pct(h5, BUDGET_5H)}%`} />
      <Metric label="7-day usage" value={`${pct(d7, BUDGET_7D).toFixed(1)}%`} width={`${pct(d7, BUDGET_7D)}%`} />
    </section>
  )
}

const TASK_DOT: Record<Task['status'], string> = {
  queued: 'bg-muted-foreground/60', running: 'animate-pulse bg-accent', done: 'bg-primary', error: 'bg-destructive', cancelled: 'bg-muted-foreground/40', interrupted: 'bg-destructive/60',
}

function TaskPanel() {
  const { state, actions } = useHub()
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const running = state.tasks.filter((t) => t.status === 'running').length
  const run = () => {
    const value = prompt.trim()
    if (!value) return
    actions.createTask(value, cwd.trim() || undefined)
    setPrompt('')
  }
  return (
    <section className="flex min-h-[390px] flex-col border border-border bg-card/75 p-3 panel-cut">
      <PanelTitle icon={Bot} status={`${running} running`}>Task queue</PanelTitle>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} placeholder="Assign a background operation…" className="w-full resize-none border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
      <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Working directory (default ~/pa)" className="mt-2 w-full border border-input bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-primary" />
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
