import type { ApplicationsMode } from '../../state/sessionTypes'
import { createWarmComponent } from '../warmComponent'

export const warmFileSessionView = createWarmComponent(() =>
  import('../../components/FileSessionView').then((m) => m.FileSessionView)
)

export const warmSessionPreviewPane = createWarmComponent(() =>
  import('../../components/SessionPreviewPane').then((m) => m.SessionPreviewPane)
)

export const warmDataFileWorkspace = createWarmComponent(() =>
  import('../../components/DataFileWorkspace').then((m) => m.DataFileWorkspace)
)

export const warmDbWorkspace = createWarmComponent(() =>
  import('../../components/DbWorkspace').then((m) => m.DbWorkspace)
)

export const warmKnowledgeWorkspace = createWarmComponent(() =>
  import('../../components/knowledge/KnowledgeWorkspace').then((m) => m.KnowledgeWorkspace)
)

export const warmScheduleEditor = createWarmComponent(() =>
  import('../../components/ScheduleEditor').then((m) => m.ScheduleEditor)
)

export const warmMachineFilesBrowser = createWarmComponent(() =>
  import('../../components/filesPanel/MachineFilesBrowser').then((m) => m.MachineFilesBrowser)
)

export const warmTimerJobsPanel = createWarmComponent(() =>
  import('../../components/sidebar/TimerJobsPanel').then((m) => m.TimerJobsPanel)
)

export const warmSessionDetail = createWarmComponent(() =>
  import('../../components/SessionDetail').then((m) => m.SessionDetail)
)

/** Pull the mode's detail chunk without mounting it. */
export function prefetchAppModeSurfaces(mode: ApplicationsMode): void {
  if (mode === 'storage') {
    void warmFileSessionView.prefetch()
    void warmSessionPreviewPane.prefetch()
    void warmMachineFilesBrowser.prefetch()
    return
  }
  if (mode === 'data') {
    void warmDataFileWorkspace.prefetch()
    void warmDbWorkspace.prefetch()
    return
  }
  if (mode === 'knowledge') {
    void warmKnowledgeWorkspace.prefetch()
    return
  }
  if (mode === 'scheduled') {
    void warmScheduleEditor.prefetch()
    void warmTimerJobsPanel.prefetch()
  }
}
