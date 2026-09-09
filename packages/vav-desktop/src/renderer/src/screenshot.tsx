import { createRoot } from 'react-dom/client'
import ScreenshotWindow from './ScreenshotWindow'
import './styles/screenshot.css'

document.documentElement.classList.add('is-screenshotting')

createRoot(document.getElementById('root')!).render(<ScreenshotWindow />)
