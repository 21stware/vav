import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, FilePlus2, FolderOpen, Plus, StickyNote, Upload, X } from 'lucide-react'
import { isDbSession, isKnowledgeSession, isTimerDefinition } from '@shared/sessionKind'
import { isLocalMachine, listedServices, LOCAL_MACHINE_ID, normalizeMachineId } from '@shared/workspaceHost'
import { parseStorageSource } from '@shared/storageSource'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'
import { hostMachineLabel } from '../lib/sidebarList'
import { openPickedFileSessions } from '../lib/openFileSession'
import { applicationsModeForConversation } from '../lib/applicationsWidth'
import { FileRecentsPanel } from './FileRecentsPanel'
import { FileSessionView } from './FileSessionView'
import { DataFileWorkspace } from './DataFileWorkspace'
import { DbWorkspace } from './DbWorkspace'
import { KnowledgeWorkspace } from './knowledge/KnowledgeWorkspace'
import { SessionPreviewPane } from './SessionPreviewPane'
import { usePreviewFilePath } from './usePreviewFilePath'
import { ScheduleEditor } from './ScheduleEditor'
import { TimerJobsPanel } from './sidebar/TimerJobsPanel'
import { SidebarServiceBar } from './sidebar/SidebarServiceBar'
import { Button, EmptyState } from './ui'

export function ApplicationsPanel(): React.JSX.Element {
  const t = useT()
  const mode = useSessionStore((s) => s.applicationsMode)
  const setFilePreviewHost = useSessionStore((s) => s.setFilePreviewHost)
  const showFileList = useSessionStore((s) => s.showFileList)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const conversation = useSessionStore((s) => {
    const focused = s.focusedAppObjectId
      ? s.conversations.find((row) => row.id === s.focusedAppObjectId)
      : undefined
    if (focused && applicationsModeForConversation(focused) === s.applicationsMode) return focused
    const active = s.conversations.find((row) => row.id === s.activeId)
    if (active && applicationsModeForConversation(active) === s.applicationsMode) return active
    return undefined
  })
  const previewPath = usePreviewFilePath(conversation?.workingDirectory ?? null)
  const hosts = useSessionStore((s) => s.hosts)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  const seedRef = useRef({ mode, key: '' })

  useEffect(() => {
    setFilePreviewHost(true)
    return () => setFilePreviewHost(false)
  }, [setFilePreviewHost])

  const storageDetail = conversation?.fileId ? 'file' : filePreviewOpen ? 'preview' : null
  const scheduledDetail = conversation && isTimerDefinition(conversation)
  const dataDetail = conversation && isDbSession(conversation)
  const knowledgeDetail = conversation && isKnowledgeSession(conversation)
  const hasDetail =
    mode === 'storage'
      ? storageDetail !== null
      : mode === 'scheduled'
        ? !!scheduledDetail
        : mode === 'data'
          ? !!dataDetail
          : mode === 'knowledge'
            ? !!knowledgeDetail
            : mode === 'devices'
              ? deviceId !== null
              : false
  const detailKey = `${mode}:${conversation?.id ?? ''}:${storageDetail ?? ''}:${deviceId ?? ''}`

  useEffect(() => {
    // Reset the seed key so a focused object created during the mode change
    // (create-from-file, open file) still opens detail.
    seedRef.current = { mode, key: '' }
    setPane('list')
    if (mode !== 'devices') setDeviceId(null)
  }, [mode])

  useEffect(() => {
    if (seedRef.current.mode !== mode) return
    if (hasDetail && detailKey !== seedRef.current.key) setPane('detail')
  }, [detailKey, hasDetail, mode])

  const openDetail = (): void => setPane('detail')

  const backToList = (): void => {
    setPane('list')
    seedRef.current = { mode, key: `${mode}:` }
    if (mode === 'storage') {
      showFileList()
      setFilePreviewOpen(false)
    }
    if (mode === 'devices') setDeviceId(null)
  }

  const listTitle =
    mode === 'scheduled'
      ? t('sidebar.nav.scheduledTask')
      : mode === 'storage'
        ? t('sidebar.category.storage')
        : mode === 'data'
          ? t('sidebar.category.data')
          : mode === 'knowledge'
            ? t('sidebar.category.knowledge')
            : t('sidebar.devices')

  const detailTitle =
    mode === 'devices'
      ? (listedServices(hosts).find((row) => row.id === deviceId)?.name ?? listTitle)
      : mode === 'storage' && !conversation?.fileId && previewPath
        ? basename(previewPath)
        : (conversation?.title ?? listTitle)

  const showingDetail = pane === 'detail' && hasDetail

  return (
    <aside
      className="applications-panel app-panel"
      data-testid="applications-panel"
      data-app={mode}
      data-pane={showingDetail ? 'detail' : 'list'}
    >
      <AppChrome
        title={showingDetail ? detailTitle : listTitle}
        onBack={showingDetail ? backToList : undefined}
        backTestId={mode === 'storage' ? 'back-to-file-list' : 'app-back-to-list'}
        actions={
          showingDetail ? (
            mode === 'devices' && deviceId ? <DevicesDetailActions selectedId={deviceId} /> : null
          ) : (
            <AppListActions mode={mode} onOpenDetail={openDetail} />
          )
        }
      />
      <div
        className="applications-split"
        data-has-detail={hasDetail ? 'true' : 'false'}
        data-pane={showingDetail ? 'detail' : 'list'}
      >
        <div className="applications-object-list" data-testid="applications-object-list">
          {mode === 'scheduled' ? <ScheduledObjectList onOpenDetail={openDetail} /> : null}
          {mode === 'storage' ? <FileRecentsPanel embedded onOpenDetail={openDetail} /> : null}
          {mode === 'data' ? <DataObjectList onOpenDetail={openDetail} /> : null}
          {mode === 'knowledge' ? <KnowledgeObjectList onOpenDetail={openDetail} /> : null}
          {mode === 'devices' ? (
            <DevicesObjectList
              selectedId={deviceId}
              onSelect={(id) => {
                setDeviceId(id)
                openDetail()
              }}
            />
          ) : null}
        </div>
        {showingDetail ? (
          <div className="applications-object-detail" data-testid="applications-object-detail">
            {mode === 'scheduled' && conversation && isTimerDefinition(conversation) ? (
              <ScheduleEditor conversationId={conversation.id} />
            ) : null}
            {mode === 'storage' && conversation?.fileId ? (
              <FileSessionView
                conversationId={conversation.id}
                fileId={conversation.fileId}
                hideAgent
              />
            ) : null}
            {mode === 'storage' && !conversation?.fileId && filePreviewOpen ? (
              <SessionPreviewPane path={previewPath} />
            ) : null}
            {mode === 'data' && conversation && isDbSession(conversation) ? (
              conversation.dataFilePath ? (
                <DataFileWorkspace
                  conversationId={conversation.id}
                  path={conversation.dataFilePath}
                  hideAgent
                />
              ) : (
                <DbWorkspace conversationId={conversation.id} hideAgent />
              )
            ) : null}
            {mode === 'knowledge' && conversation && isKnowledgeSession(conversation) ? (
              <KnowledgeWorkspace conversationId={conversation.id} hideAgent />
            ) : null}
            {mode === 'devices' && deviceId !== null ? (
              <DevicesObjectDetail selectedId={deviceId} />
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function AppChrome({
  title,
  onBack,
  backTestId,
  actions
}: {
  title: string
  onBack?: () => void
  backTestId?: string
  actions?: ReactNode
}): React.JSX.Element {
  const t = useT()
  const hideApplications = (): void => {
    const store = useSessionStore.getState()
    if (store.applicationsVisible) store.toggleApplications()
  }
  return (
    <header className="app-chrome" data-testid="app-chrome">
      <div className="app-chrome-leading">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="app-chrome-back"
            testId={backTestId}
            icon={<ChevronLeft size={18} strokeWidth={2} aria-hidden />}
            title={t('sidebar.back')}
            onClick={onBack}
          />
        ) : null}
        <h1 className="app-chrome-title">{title}</h1>
      </div>
      <div className="app-chrome-trailing">
        {actions}
        <Button
          icon={<X size={15} strokeWidth={2} />}
          variant="ghost"
          testId="close-app"
          title={t('applications.close')}
          onClick={hideApplications}
        />
      </div>
    </header>
  )
}

function AppListActions({
  mode,
  onOpenDetail
}: {
  mode: ReturnType<typeof useSessionStore.getState>['applicationsMode']
  onOpenDetail: () => void
}): React.JSX.Element | null {
  const t = useT()
  const createScheduledConversation = useSessionStore((s) => s.createScheduledConversation)
  const createDbConversation = useSessionStore((s) => s.createDbConversation)
  const createDataFromFile = useSessionStore((s) => s.createDataFromFile)
  const createKnowledgeNote = useSessionStore((s) => s.createKnowledgeNote)
  const importKnowledgeDocument = useSessionStore((s) => s.importKnowledgeDocument)
  const filesSource = useSessionStore((s) => s.filesSource)
  const setFilesSource = useSessionStore((s) => s.setFilesSource)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const hosts = useSessionStore((s) => s.hosts)
  const machineLabel = isLocalMachine(windowMachineId)
    ? t('sidebar.thisMac')
    : hostMachineLabel(windowMachineId, hosts, LOCAL_MACHINE_ID, t('sidebar.thisMac'))

  const addDataFile = async (): Promise<void> => {
    const picked = await window.vav.files?.pickAttachments()
    if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
    await createDataFromFile(picked.paths[0])
    onOpenDetail()
  }

  if (mode === 'scheduled') {
    return (
      <Button
        variant="ghost"
        size="sm"
        testId="sidebar-create-scheduled"
        icon={<Plus size={14} strokeWidth={2} aria-hidden />}
        title={t('timer.new')}
        label={t('timer.new')}
        onClick={() => {
          void createScheduledConversation().then(onOpenDetail)
        }}
      />
    )
  }

  if (mode === 'storage') {
    return (
      <>
        <div className="font-select file-source-select app-chrome-select">
          <select
            className="text-field font-select-field"
            data-testid="file-source-select"
            aria-label={t('sidebar.filesSource')}
            value={filesSource}
            onChange={(event) => setFilesSource(parseStorageSource(event.target.value))}
          >
            <option value="recent">{t('sidebar.recentFiles')}</option>
            <option value="thisMac">{machineLabel}</option>
            <option value="icloud">{t('sidebar.iCloud')}</option>
            <option value="cloudDisk">{t('sidebar.cloudDisk')}</option>
          </select>
          <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
        </div>
        {filesSource === 'recent' && isLocalMachine(windowMachineId) ? (
          <Button
            variant="ghost"
            size="sm"
            testId="open-a-file"
            icon={<FolderOpen size={14} strokeWidth={2} aria-hidden />}
            title={t('sidebar.openAFile')}
            label={t('sidebar.openAFile')}
            onClick={() => {
              void openPickedFileSessions().then((opened) => {
                if (opened) onOpenDetail()
              })
            }}
          />
        ) : null}
      </>
    )
  }

  if (mode === 'data') {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          testId="empty-create-db"
          icon={<Plus size={14} strokeWidth={2} aria-hidden />}
          title={t('db.new')}
          label={t('db.new')}
          onClick={() => {
            void createDbConversation().then(onOpenDetail)
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          testId="empty-add-data-file"
          icon={<FilePlus2 size={14} strokeWidth={2} aria-hidden />}
          title={t('data.addFile')}
          label={t('data.addFile')}
          onClick={() => void addDataFile()}
        />
      </>
    )
  }

  if (mode === 'knowledge') {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          testId="empty-create-note"
          icon={<StickyNote size={14} strokeWidth={2} aria-hidden />}
          title={t('knowledge.newNote')}
          label={t('knowledge.newNote')}
          onClick={() => {
            void createKnowledgeNote().then(onOpenDetail)
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          testId="empty-import-knowledge"
          icon={<Upload size={14} strokeWidth={2} aria-hidden />}
          title={t('knowledge.importDocument')}
          label={t('knowledge.importDocument')}
          onClick={() => {
            void (async () => {
              const picked = await window.vav.files?.pickAttachments()
              if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
              await importKnowledgeDocument(picked.paths[0])
              onOpenDetail()
            })()
          }}
        />
      </>
    )
  }

  return <SidebarServiceBar variant="nav" testId="devices-menu" label={t('sidebar.switchService')} />
}

function ScheduledObjectList({ onOpenDetail }: { onOpenDetail: () => void }): React.JSX.Element {
  return (
    <div className="applications-home" data-testid="scheduled-home">
      <TimerJobsPanel embedded onOpenDetail={onOpenDetail} />
    </div>
  )
}

function DataObjectList({ onOpenDetail }: { onOpenDetail: () => void }): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const rows = conversations.filter((row) => isDbSession(row) && !row.archived)
  const focusedId = useSessionStore((s) => s.focusedAppObjectId ?? s.activeId)
  const selectConversation = useSessionStore((s) => s.selectConversation)

  return (
    <div className="applications-home" data-testid="data-home">
      {rows.length === 0 ? (
        <EmptyState title={t('data.emptyTitle')} description={t('data.emptyDesc')} />
      ) : (
        <ul className="applications-object-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="applications-object-row"
                data-testid="data-object-row"
                data-active={row.id === focusedId ? 'true' : 'false'}
                onClick={() => {
                  void selectConversation(row.id).then(onOpenDetail)
                }}
              >
                <span className="applications-object-row-title">{row.title}</span>
                <ChevronRight className="applications-object-row-chevron" size={16} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function KnowledgeObjectList({ onOpenDetail }: { onOpenDetail: () => void }): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const rows = conversations.filter((row) => isKnowledgeSession(row) && !row.archived)
  const focusedId = useSessionStore((s) => s.focusedAppObjectId ?? s.activeId)
  const selectConversation = useSessionStore((s) => s.selectConversation)

  return (
    <div className="applications-home" data-testid="knowledge-home">
      {rows.length === 0 ? (
        <EmptyState title={t('knowledge.emptyTitle')} description={t('knowledge.emptyDesc')} />
      ) : (
        <ul className="applications-object-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="applications-object-row"
                data-testid="knowledge-object-row"
                data-active={row.id === focusedId ? 'true' : 'false'}
                onClick={() => {
                  void selectConversation(row.id).then(onOpenDetail)
                }}
              >
                <span className="applications-object-row-title">{row.title}</span>
                <ChevronRight className="applications-object-row-chevron" size={16} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DevicesObjectList({
  selectedId,
  onSelect
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)

  return (
    <div className="applications-home" data-testid="devices-home">
      {services.length === 0 ? (
        <EmptyState title={t('sidebar.emptyRemoteTitle')} description={t('sidebar.devices')} />
      ) : (
        <ul className="applications-object-rows">
          {services.map((service) => (
            <li key={service.id}>
              <button
                type="button"
                className="applications-object-row"
                data-testid="device-object-row"
                data-machine-id={service.id}
                data-active={service.id === selectedId ? 'true' : 'false'}
                onClick={() => onSelect(service.id)}
              >
                <span className="applications-object-row-title">{service.name}</span>
                {isLocalMachine(service.id) ? (
                  <span className="applications-object-row-meta">{t('sidebar.thisMachine')}</span>
                ) : null}
                <ChevronRight className="applications-object-row-chevron" size={16} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DevicesDetailActions({ selectedId }: { selectedId: string }): React.JSX.Element | null {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const current = services.find((service) => service.id === selectedId) ?? services[0]
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)

  if (!current) return null

  const switchService = (machineId: string): void => {
    if (machineId === windowMachineId) return
    void (async () => {
      await useSessionStore.getState().switchMachine(machineId)
      await window.vav.hosts.show(machineId)
    })()
  }

  return (
    <>
      {current.id !== windowMachineId ? (
        <Button
          variant="ghost"
          size="sm"
          title={t('sidebar.switchService')}
          label={t('sidebar.switchService')}
          onClick={() => switchService(current.id)}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        title={t('sidebar.setDefaultService')}
        label={t('sidebar.setDefaultService')}
        onClick={() => void setDefaultMachine(current.id)}
      />
      <Button
        variant="ghost"
        size="sm"
        title={t('sidebar.pairDevice')}
        label={t('sidebar.pairDevice')}
        onClick={() => useSessionStore.getState().openSettings('connect', undefined, current.id)}
      />
    </>
  )
}

function DevicesObjectDetail({ selectedId }: { selectedId: string }): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const current = services.find((service) => service.id === selectedId) ?? services[0]
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))

  if (!current) {
    return <EmptyState title={t('sidebar.devices')} />
  }

  return (
    <div className="applications-home applications-device-detail" data-testid="devices-detail">
      <p className="applications-device-name">{current.name}</p>
      {isLocalMachine(current.id) ? (
        <p className="applications-device-meta">{t('sidebar.thisMachine')}</p>
      ) : null}
      {defaultMachineId === current.id ? (
        <p className="applications-device-meta">{t('sidebar.setDefaultService')}</p>
      ) : null}
      <div className="applications-device-more">
        <Button
          variant="secondary"
          size="sm"
          title={t('sidebar.configureService')}
          label={t('sidebar.configureService')}
          onClick={() => useSessionStore.getState().openSettings('agents', undefined, current.id)}
        />
        {!isLocalMachine(current.id) ? (
          <Button
            variant="secondary"
            size="sm"
            title={t('machines.forget')}
            label={t('machines.forget')}
            onClick={() => void window.vav.hosts.forget(current.id)}
          />
        ) : null}
        {current.id !== windowMachineId ? null : defaultMachineId === current.id ? null : (
          <Button
            variant="secondary"
            size="sm"
            title={t('sidebar.setDefaultService')}
            label={t('sidebar.setDefaultService')}
            onClick={() => void setDefaultMachine(current.id)}
          />
        )}
      </div>
    </div>
  )
}
