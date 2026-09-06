import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { TimerStore } from '../store/TimerStore.ts'
import type { TimerScheduler } from '../timer/TimerScheduler.ts'

export function registerTimerIpc(
  ipcMain: IpcMain,
  store: TimerStore,
  scheduler: TimerScheduler,
  broadcast: (channel: string, payload?: unknown) => void
): void {
  ipcMain.handle(IPC.timerListJobs, () => store.listJobs())
  ipcMain.handle(
    IPC.timerUpsertJob,
    (
      _event,
      input: {
        id?: string
        title: string
        prompt: string
        everyMinutes?: number
        at?: number
        enabled?: boolean
      }
    ) => {
      const job = store.upsertJob(input)
      broadcast(IPC.timerChanged)
      return job
    }
  )
  ipcMain.handle(IPC.timerDeleteJob, (_event, id: string) => {
    const ok = store.deleteJob(String(id || ''))
    if (ok) broadcast(IPC.timerChanged)
    return ok
  })
  ipcMain.handle(IPC.timerListSessions, () => store.listSessions())
  ipcMain.handle(IPC.timerDeleteSessions, (_event, sessionIds: string[]) => {
    const removed = store.deleteSessions(Array.isArray(sessionIds) ? sessionIds : [])
    if (removed.length) broadcast(IPC.timerChanged)
    return removed
  })
  ipcMain.handle(IPC.timerRunNow, async (_event, jobId: string) => {
    const result = await scheduler.runNow(String(jobId || ''))
    broadcast(IPC.timerChanged)
    return result
  })
}
