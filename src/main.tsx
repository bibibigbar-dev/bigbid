import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Pick up new deploys faster on mobile (cached SW was a common “button does nothing” cause)
    if (registration) {
      void registration.update()
      setInterval(() => void registration.update(), 60 * 60 * 1000)
    }
  },
})

void updateSW

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
