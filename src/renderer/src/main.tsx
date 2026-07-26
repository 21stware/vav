import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import SettingsWindow from './SettingsWindow'
import SessionWindow from './SessionWindow'
import { PLATFORM } from './lib/platform'
import './styles/index.css'
import '@xterm/xterm/css/xterm.css'

// The window controls sit on opposite ends on macOS and Windows, and the
// stylesheet has to leave room for whichever end that is before first paint.
document.documentElement.dataset.platform = PLATFORM

// One bundle, three window kinds; main says which one it is opening.
const params = new URLSearchParams(window.location.search)
const view = params.get('view')
const conversationId = params.get('conversationId')

function Root(): React.JSX.Element {
  if (view === 'settings') return <SettingsWindow />
  if (view === 'session' && conversationId) return <SessionWindow conversationId={conversationId} />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
