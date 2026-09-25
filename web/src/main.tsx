import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { HubProvider } from '@/lib/hub-context'
import { Console } from '@/Console'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubProvider>
      <Console />
    </HubProvider>
  </StrictMode>,
)
