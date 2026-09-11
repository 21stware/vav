import { screen } from 'electron'
import { displaysLookAsleep } from '../../shared/displaySleep.ts'

/** Live check — display sleep / lid-close can empty the display list. */
export function currentDisplaysLookAsleep(): boolean {
  try {
    return displaysLookAsleep(screen.getAllDisplays())
  } catch {
    return true
  }
}
