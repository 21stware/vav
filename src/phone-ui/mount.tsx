import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PhoneApp } from './PhoneApp'
import type { PhoneTransport } from './phoneTransport'
import { installLiveResizeTracking } from '../renderer/src/lib/liveResize'
import { installWindowFocusTracking } from '../renderer/src/lib/windowFocus'

export function mountPhoneApp(transport: PhoneTransport): void {
  const root = document.getElementById('root')
  if (!root) throw new Error('phone-ui: #root missing')
  installLiveResizeTracking()
  installWindowFocusTracking()
  createRoot(root).render(
    <StrictMode>
      <PhoneApp transport={transport} />
    </StrictMode>
  )
}
