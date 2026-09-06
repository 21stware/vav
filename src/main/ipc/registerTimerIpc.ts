import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { TimerJobInput } from '@shared/timer'
import type { TimerStore } from '../store/TimerStore'
import type { TimerScheduler } from '../timer/TimerScheduler'
import type { ConversationStore } from '../store/ConversationStore'

export function registerTimerIpc(
  ipcMain: IpcMain,
  store: TimerStore,
  scheduler: TimerScheduler,
  conversations: ConversationStore,
  broadcast: () => void
): void {
  ipcMain.handle(IPC.timersListJobs, () => store.listJobs())
  ipcMain.handle(IPC.timersCreateJob, (_event, input: TimerJobInput) => {
    const job = store.createJob(input)
    broadcast()
    return job
  })
  ipcMain.handle(
    IPC.timersUpdateJob,
    (_event, id: string, patch: Partial<TimerJobInput> & { enabled?: boolean }) => {
      const job = store.updateJob(id, patch)
      broadcast()
      return job
    }
  )
  ipcMain.handle(IPC.timersRemoveJob, (_event, id: string) => {
    const ok = store.removeJob(id)
    if (ok) broadcast()
    return ok
  })
  ipcMain.handle(IPC.timersRunNow, (_event, id: string) => {
    const result = scheduler.runNow(id)
    broadcast()
    return result
  })
  ipcMain.handle(IPC.timersListRuns, (_event, jobId?: string) => store.listRuns(jobId))
  ipcMain.handle(IPC.timersListSessions, () => conversations.listTimerMeta())
}
