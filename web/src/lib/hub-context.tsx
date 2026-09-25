import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import type { ChatMessage } from '@kitt/hub/protocol'
import { HubClient, defaultHubUrl } from './hub'
import { initialState, reduce, type HubState } from './hub-store'

type Actions = {
  sendChat(target: string, text: string): void
  clearChat(): void
  interrupt(): void
  createTask(prompt: string, cwd?: string): void
  cancelTask(id: string): void
  deleteTask(id: string): void
  onDone(l: (message: ChatMessage) => void): () => void
  dismissError(): void
}

const HubContext = createContext<{ state: HubState; actions: Actions } | null>(null)

export function HubProvider({ children, url }: { children: ReactNode; url?: string }) {
  const [state, dispatch] = useReducer(reduce, initialState)
  const clientRef = useRef<HubClient | null>(null)
  const doneListeners = useRef(new Set<(m: ChatMessage) => void>())

  useEffect(() => {
    const client = new HubClient(url ?? defaultHubUrl())
    clientRef.current = client
    const offFrame = client.onFrame((frame) => {
      dispatch({ type: 'frame', frame })
      if (frame.type === 'chat.done') for (const l of doneListeners.current) l(frame.message)
    })
    const offStatus = client.onStatus((value) => dispatch({ type: 'connected', value }))
    client.connect()
    return () => { offFrame(); offStatus(); client.disconnect() }
  }, [url])

  const actions = useMemo<Actions>(() => ({
    sendChat: (target, text) => clientRef.current?.send({ type: 'chat.send', target, text }),
    clearChat: () => clientRef.current?.send({ type: 'chat.clear' }),
    interrupt: () => clientRef.current?.send({ type: 'chat.interrupt' }),
    createTask: (prompt, cwd) => clientRef.current?.send({ type: 'task.create', prompt, ...(cwd ? { cwd } : {}) }),
    cancelTask: (id) => clientRef.current?.send({ type: 'task.cancel', id }),
    deleteTask: (id) => clientRef.current?.send({ type: 'task.delete', id }),
    onDone: (l) => { doneListeners.current.add(l); return () => { doneListeners.current.delete(l) } },
    dismissError: () => dispatch({ type: 'dismissError' }),
  }), [])

  return <HubContext.Provider value={{ state, actions }}>{children}</HubContext.Provider>
}

export function useHub() {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useHub must be used inside HubProvider')
  return ctx
}
