import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_MAC, PLATFORM } from './lib/platform'
import { installLiveResizeTracking } from './lib/liveResize'
import { installSiblingRepaint } from './lib/siblingRepaint'
import { installWindowFocusTracking } from './lib/windowFocus'
import '@xterm/xterm/css/xterm.css'
import './styles/index.css'

// Window roots are code-split so Settings / Token Usage / Session don't parse
// the main App + FileViewer + office graph on open.
const App = lazy(() => import('./App'))
const SettingsWindow = lazy(() => import('./SettingsWindow'))
const ConnectWindow = lazy(() => import('./ConnectWindow'))
const SessionWindow = lazy(() => import('./SessionWindow'))
const FilePreviewWindow = lazy(() => import('./FilePreviewWindow'))
const AppClipWindow = lazy(() => import('./AppClipWindow'))
const TokenUsageWindow = lazy(() => import('./TokenUsageWindow'))
const ProviderAccountWindow = lazy(() => import('./ProviderAccountWindow'))

// The window controls sit on opposite ends on macOS and Windows, and the
// stylesheet has to leave room for whichever end that is before first paint.
document.documentElement.dataset.platform = PLATFORM
installLiveResizeTracking()
installSiblingRepaint()
installWindowFocusTracking()

// One bundle, several window kinds; main says which one it is opening.
const params = new URLSearchParams(window.location.search)
const view = params.get('view')
const conversationId = params.get('conversationId')
const filePath = params.get('path')
// Main shell defaults to system glass until settings hydrate (Appearance can turn it off).
if (IS_MAC && !view) {
  document.documentElement.dataset.vibrancy = 'true'
}

function Root(): React.JSX.Element {
  if (view === 'settings') return <SettingsWindow />
  if (view === 'connect') return <ConnectWindow />
  // Session companions: cold (conversationId in query) or warm pool (warm=1, no id).
  if (view === 'session') return <SessionWindow conversationId={conversationId || ''} />
  // Warm shells load with view=file-preview&warm=1 and no path yet.
  if (view === 'file-preview') return <FilePreviewWindow path={filePath || ''} />
  if (view === 'app-window') return <AppClipWindow path={filePath || ''} />
  if (view === 'token-usage' && conversationId) {
    return <TokenUsageWindow conversationId={conversationId} />
  }
  if (view === 'provider-account' && conversationId) {
    return <ProviderAccountWindow conversationId={conversationId} />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>
)
