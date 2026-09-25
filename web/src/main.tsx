import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { HubProvider } from '@/lib/hub-context'
import { Console } from '@/Console'
import { ErrorBoundary } from '@/components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HubProvider>
        <Console />
      </HubProvider>
    </ErrorBoundary>
  </StrictMode>,
)
