import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PhoneApp } from './PhoneApp'
import type { PhoneTransport } from './phoneTransport'
import '../renderer/src/styles/app-shell.css'
import '../renderer/src/styles/app-rest.css'
import './phone.css'

export function mountPhoneApp(transport: PhoneTransport): void {
  const root = document.getElementById('root')
  if (!root) throw new Error('phone-ui: #root missing')
  createRoot(root).render(
    <StrictMode>
      <PhoneApp transport={transport} />
    </StrictMode>
  )
}
