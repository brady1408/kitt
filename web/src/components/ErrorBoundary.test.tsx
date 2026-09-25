import { test, expect, afterAll } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(async () => { await GlobalRegistrator.unregister() })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ErrorBoundary } = await import('./ErrorBoundary')

function Boom(): never { throw new Error('boom went the reducer') }

test('a render error shows a crash message with the reason and a reload button instead of a blank page', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const quiet = console.error
  console.error = () => {}
  try {
    await act(async () => { root.render(<ErrorBoundary><Boom /></ErrorBoundary>) })
  } finally { console.error = quiet }
  expect(host.textContent).toContain('Console crashed')
  expect(host.textContent).toContain('boom went the reducer')
  expect(host.querySelector('button')?.textContent).toContain('Reload')
})
