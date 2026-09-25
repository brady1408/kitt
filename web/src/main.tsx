import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { HubProvider, useHub } from '@/lib/hub-context'

function Status() {
  const { state } = useHub()
  return <pre className="p-4 text-xs">{state.connected ? 'connected' : 'connecting…'} · sessions {state.registry.length}</pre>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubProvider>
      <Status />
    </HubProvider>
  </StrictMode>,
)
