import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, PanelRight, Save, Star } from 'lucide-react'
import type { FileAssociationStatus, FileInspectResult } from '@shared/ipc'
import type { PreviewRef } from '@shared/types'
import { formatBytes } from '../lib/format'
import { highlightCode, languageFromPath } from '../lib/highlightCode'
import { MarkdownView } from './MarkdownView'
import {
  formatBadge,
  parseBlocksForPath,
  csvColId,
  parseCsvModel,
  parseNotebookBlocks,
  blockAtLine,
  findBlockById,
  parentBlockOf,
  type PreviewBlock
} from '../lib/previewBlocks'
import { basename, dirname } from '../lib/path'
import { useT } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import { SessionDetail } from './SessionDetail'
import { Button, EmptyState, InlineAlert, Modal } from './ui'

const PANEL_WIDTH_KEY = 'vav.filePreviewAgentPanelWidth'

function loadPanelWidth(): number {
  try {
    const n = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    if (n >= 280 && n <= 520) return n
  } catch {
    // ignore
  }
  return 360
}

type ConfirmIntent = 'done' | 'close'

/**
 * File preview (file-preview.rpml).
 * Preview and Edit share the same rendered canvas. Edit adds DevTools-style
 * block selection for Agent context — never swaps into a source/code editor.
 */
export function FileViewer({
  path: initialPath,
  parentConversationId,
  embedded = false
}: {
  path: string
  origin?: 'dock' | 'session'
  parentConversationId?: string | null
  /** Workspace view: no titlebar drag chrome / no nested agent drawer. */
  embedded?: boolean
}): React.JSX.Element {
  const t = useT()
  const [filePath, setFilePath] = useState(initialPath)
  const [info, setInfo] = useState<FileInspectResult | null>(null)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lastSelected, setLastSelected] = useState<string | null>(null)
  const [drillStack, setDrillStack] = useState<PreviewBlock[]>([])
  const [agentConversationId, setAgentConversationId] = useState<string | null>(
    embedded ? (parentConversationId ?? null) : null
  )
  const previewAgentByPath = useSessionStore((s) => s.previewAgentByPath)
  const [baselineContent, setBaselineContent] = useState<string | null>(null)
  const [workingContent, setWorkingContent] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmIntent | null>(null)
  const [assoc, setAssoc] = useState<FileAssociationStatus | null>(null)
  const createConversation = useSessionStore((s) => s.createConversation)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const setPreviewRefs = useSessionStore((s) => s.setPreviewRefs)
  const activeRefs = useSessionStore((s) =>
    agentConversationId ? s.previewRefs[agentConversationId] : undefined
  )
  const storePickMode = useSessionStore((s) =>
    agentConversationId ? !!s.pickMode[agentConversationId] : false
  )
  const showDialog = useSessionStore((s) => s.showDialog)
  const showToast = useSessionStore((s) => s.showToast)
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  // Workspace view (and any parent) may change `path` without remounting.
  // Do not key this off local `filePath` — Save As updates that independently.
  useEffect(() => {
    setFilePath(initialPath)
    setInfo(null)
    setAgentPanelOpen(false)
    setSelectedIds([])
    setLastSelected(null)
    setDrillStack([])
    setWorkingContent(null)
    setBaselineContent(null)
    setHasUnsavedChanges(false)
    setConfirm(null)
  }, [initialPath])

  const refreshAssoc = useCallback(async (): Promise<void> => {
    const status = await window.vav.settings.fileAssociationForPath(filePathRef.current)
    setAssoc(status)
  }, [])

  useEffect(() => {
    void refreshAssoc()
  }, [filePath, refreshAssoc])

  const reloadInfo = useCallback(async (path: string): Promise<FileInspectResult> => {
    const result = await window.vav.files.inspect(path)
    setInfo(result)
    if (result.name && !embedded) document.title = result.name
    return result
  }, [embedded])

  useEffect(() => {
    let cancelled = false
    void reloadInfo(filePath).then((result) => {
      if (cancelled) return
      if (result.text == null) return
      setWorkingContent(result.text)
      if (agentPanelOpen) {
        setBaselineContent(result.text)
        setHasUnsavedChanges(false)
      }
    })
    return () => {
      cancelled = true
    }
    // agentPanelOpen intentionally omitted — opening panel snapshots in toggleAgentPanel.
  }, [filePath, reloadInfo])

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
    } catch {
      // ignore
    }
  }, [panelWidth])

  useEffect(() => {
    void window.vav.window.setPreviewCloseGuard(hasUnsavedChanges)
  }, [hasUnsavedChanges])

  useEffect(() => {
    return window.vav.window.onPreviewCloseAttempt(() => {
      setConfirm('close')
    })
  }, [])

  /** Agent fs_write / Change Review write landed on this file. */
  useEffect(() => {
    if (!agentPanelOpen) return
    return window.vav.agent.onEvent((event) => {
      if (event.type !== 'fs-changed') return
      if (event.filePath !== filePathRef.current) return
      void (async () => {
        const result = await reloadInfo(filePathRef.current)
        if (result.text == null) return
        setWorkingContent(result.text)
        setHasUnsavedChanges(true)
      })()
    })
  }, [agentPanelOpen, reloadInfo])

  const displayText = workingContent ?? info?.text ?? ''
  const isMarkdown =
    /\.(md|markdown|mdx)$/i.test(filePath) || (info?.mime ?? '').includes('markdown')
  const isNotebook = /\.ipynb$/i.test(filePath)
  const isCsv = info?.kind === 'csv' || /\.(csv|tsv)$/i.test(filePath)
  const badge = formatBadge(filePath, info?.kind ?? 'text')

  const syncBlocks = useMemo((): PreviewBlock[] => {
    if (info?.text == null && workingContent == null) return []
    if (isCsv) return parseCsvModel(displayText).blocks.filter((b) => b.kind !== 'table')
    return parseBlocksForPath(filePath, displayText)
  }, [displayText, info, filePath, isCsv, workingContent])

  const rootBlocks = syncBlocks

  const allBlocks = useMemo(() => collectBlocks(rootBlocks), [rootBlocks])
  /** Shift-range order: all blocks in document order (DevTools-style, any depth). */
  const flatOrder = useMemo(() => allBlocks.map((b) => b.id), [allBlocks])

  const mediaBlock = useMemo((): PreviewBlock | null => {
    if (!info || (!info.dataUrl && info.kind !== 'pdf')) return null
    return {
      id: 'media',
      kind: 'paragraph',
      text: `${info.kind}: ${filePath}`,
      startLine: 1,
      endLine: 1,
      label: info.name
    }
  }, [info, filePath])

  const selectedBlocks = useMemo(() => {
    if (mediaBlock && selectedIds.includes(mediaBlock.id)) return [mediaBlock]
    return allBlocks.filter((b) => selectedIds.includes(b.id))
  }, [allBlocks, selectedIds, mediaBlock])

  /** Block selection only active when Pick mode is toggled on. */
  const hasConversationContext = embedded
    ? !!parentConversationId
    : agentPanelOpen
  const selectable =
    storePickMode &&
    hasConversationContext &&
    !!info &&
    !info.error &&
    (info.kind === 'text' ||
      info.kind === 'csv' ||
      info.kind === 'pdf' ||
      !!info.dataUrl)

  /** Pick mode: clicking a block creates a comment card. Normal mode: selects. */
  const applySelection = (id: string, event: React.MouseEvent): void => {
    if (!selectable || !agentConversationId) return
    event.stopPropagation()
    if (storePickMode) {
      const block = findBlockById(rootBlocks, id)
      if (!block) return
      const refId = `${filePath}::${id}`
      const existing = useSessionStore.getState().commentCards[agentConversationId] ?? []
      // Remove cards with empty comment that are NOT the one being picked now.
      const cleaned = existing.filter(
        (c) => c.comment.trim() || c.ref.id === refId
      )
      if (cleaned.some((c) => c.ref.id === refId)) {
        // Already picked — just focus its comment input.
        useSessionStore.getState().focusCommentCard(refId)
        return
      }
      useSessionStore.getState().setCommentCards(agentConversationId, [
        ...cleaned,
        { ref: blockToRef(filePath, badge, block), comment: '' }
      ])
      useSessionStore.getState().focusCommentCard(refId)
      return
    }
    if (event.shiftKey && lastSelected) {
      const a = flatOrder.indexOf(lastSelected)
      const b = flatOrder.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a]
        setSelectedIds(flatOrder.slice(start, end + 1))
        setLastSelected(id)
        return
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      )
      setLastSelected(id)
      return
    }
    setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]))
    setLastSelected(id)
  }

  const selectByLine = (line: number, event: React.MouseEvent): void => {
    const hit = blockAtLine(rootBlocks, line, drillStack)
    if (hit) applySelection(hit.id, event)
  }

  const drillInto = (block?: PreviewBlock | null): void => {
    const target =
      block ??
      (selectedIds.length === 1 ? findBlockById(rootBlocks, selectedIds[0]!) : null)
    if (!target?.children?.length) return
    setDrillStack((prev) => [...prev, target])
    setSelectedIds([])
    setLastSelected(null)
  }

  const popDrill = (): boolean => {
    if (drillStack.length === 0) return false
    const top = drillStack[drillStack.length - 1]!
    setDrillStack((prev) => prev.slice(0, -1))
    setSelectedIds([top.id])
    setLastSelected(top.id)
    return true
  }

  /** Mirror the canvas selection into composer chips (comment blocks). */
  const pushSelectionRefs = useCallback(
    (conversationId: string, focused: PreviewBlock[]): void => {
      setPreviewRefs(conversationId, focused.map((b) => blockToRef(filePath, badge, b)))
    },
    [setPreviewRefs, filePath, badge]
  )

  const selectionKey = selectedIds.join('|')
  useEffect(() => {
    if (!agentPanelOpen || !agentConversationId) return
    pushSelectionRefs(agentConversationId, selectedBlocks)
  }, [agentPanelOpen, agentConversationId, selectionKey, pushSelectionRefs])

  // Removing a chip in the composer deselects the block on the canvas too.
  useEffect(() => {
    if (!agentPanelOpen || !agentConversationId || !activeRefs) return
    const keep = new Set(activeRefs.map((r) => r.id))
    setSelectedIds((prev) => {
      const next = prev.filter((id) => keep.has(`${filePath}::${id}`))
      return next.length === prev.length ? prev : next
    })
  }, [activeRefs, agentPanelOpen, agentConversationId, filePath])

  const closeAgentPanel = (): void => {
    if (agentConversationId) {
      useSessionStore.getState().clearPreviewRefs(agentConversationId)
      useSessionStore.getState().clearCommentCards(agentConversationId)
      useSessionStore.getState().setPickMode(agentConversationId, false)
    }
    setAgentPanelOpen(false)
    setSelectedIds([])
    setLastSelected(null)
    setDrillStack([])
    setConfirm(null)
  }

  const toggleAgentPanel = async (): Promise<void> => {
    if (agentPanelOpen) {
      // Closing panel — check unsaved changes first.
      if (hasUnsavedChanges) {
        setConfirm('done')
        return
      }
      closeAgentPanel()
      return
    }

    // Opening panel — snapshot baseline for dirty tracking.
    const text = info?.text ?? ''
    setBaselineContent(text)
    setWorkingContent(text)
    setHasUnsavedChanges(false)
    setAgentPanelOpen(true)

    let id = agentConversationId
    if (!id && parentConversationId) {
      id = parentConversationId
      setAgentConversationId(id)
      if (!embedded) await selectConversation(id)
    } else if (id) {
      if (!embedded) await selectConversation(id)
    } else if (!embedded) {
      // Standalone file preview: restore file-bound conversation if it exists.
      const existing = previewAgentByPath[filePath]
      if (existing && useSessionStore.getState().conversations.some((c) => c.id === existing)) {
        id = existing
        setAgentConversationId(id)
        await selectConversation(id)
      } else {
        await createConversation({ workingDirectory: dirname(filePath) })
        id = useSessionStore.getState().activeId
        setAgentConversationId(id)
        useSessionStore.getState().setPreviewAgentForPath(filePath, id)
      }
    }

    if (id) pushSelectionRefs(id, selectedBlocks)
    useSessionStore.getState().focusComposer()
  }

  const save = async (): Promise<boolean> => {
    const content = workingContent ?? info?.text ?? ''
    const result = await window.vav.files.write(filePath, content)
    if (!result.ok) {
      showToast({
        kind: 'error',
        title: t('preview.saveFailed'),
        description: result.error
      })
      return false
    }
    setBaselineContent(content)
    setHasUnsavedChanges(false)
    await reloadInfo(filePath)
    showToast({ kind: 'success', title: t('preview.saved') })
    return true
  }

  const saveAs = async (): Promise<boolean> => {
    const content = workingContent ?? info?.text ?? ''
    const originalPath = filePath
    const result = await window.vav.files.saveAs(originalPath, content)
    if (!result.ok) {
      if (!result.cancelled) {
        showToast({
          kind: 'error',
          title: t('preview.saveFailed'),
          description: result.error
        })
      }
      return false
    }
    // Spec: original file stays at the edit-entry snapshot.
    if (baselineContent != null && result.path !== originalPath) {
      await window.vav.files.write(originalPath, baselineContent)
    }
    setFilePath(result.path)
    setBaselineContent(content)
    setWorkingContent(content)
    setHasUnsavedChanges(false)
    await reloadInfo(result.path)
    showToast({ kind: 'success', title: t('preview.saved') })
    return true
  }

  const discard = async (): Promise<void> => {
    if (baselineContent != null) {
      await window.vav.files.write(filePath, baselineContent)
      setWorkingContent(baselineContent)
      await reloadInfo(filePath)
    }
    setHasUnsavedChanges(false)
  }

  const requestClose = (): void => {
    if (hasUnsavedChanges) {
      setConfirm('close')
      return
    }
    window.close()
  }

  const confirmSave = async (): Promise<void> => {
    const intent = confirm
    const ok = await save()
    if (!ok) return
    setConfirm(null)
    if (intent === 'close') {
      void window.vav.window.forcePreviewClose()
      return
    }
    closeAgentPanel()
  }

  const confirmDiscard = async (): Promise<void> => {
    const intent = confirm
    await discard()
    setConfirm(null)
    if (intent === 'close') {
      void window.vav.window.setPreviewCloseGuard(false)
      void window.vav.window.forcePreviewClose()
      return
    }
    closeAgentPanel()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (confirm) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setConfirm(null)
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        requestClose()
        return
      }
      if (agentPanelOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (event.shiftKey) void saveAs()
        else if (hasUnsavedChanges) void save()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (storePickMode && agentConversationId) {
          useSessionStore.getState().setPickMode(agentConversationId, false)
          return
        }
        if (agentPanelOpen && popDrill()) return
        if (agentPanelOpen) void toggleAgentPanel()
        else if (!embedded) window.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agentPanelOpen, hasUnsavedChanges, confirm, drillStack, storePickMode, agentConversationId, embedded])

  const statusLeft = useMemo(() => {
    if (!info) return t('common.loading')
    const parts: string[] = []
    if (info.size) parts.push(formatBytes(info.size))
    if (info.lineCount != null) parts.push(t('files.lines', { n: info.lineCount }))
    parts.push(badge)
    parts.push(filePath)
    if (info.truncated) parts.push(t('common.truncated'))
    if (hasUnsavedChanges) parts.push('•')
    return parts.join(' · ')
  }, [info, badge, filePath, t, hasUnsavedChanges])

  const statusRight = useMemo(() => {
    if (!agentPanelOpen || selectedBlocks.length === 0) return ''
    const first = selectedBlocks[0]
    if (selectedBlocks.length === 1 && first?.label) return first.label
    if (selectedBlocks.length === 1 && first) {
      return t('preview.blocksSelectedLines', {
        n: 1,
        start: first.startLine,
        end: first.endLine
      })
    }
    return t('preview.blocksSelected', { n: selectedBlocks.length })
  }, [agentPanelOpen, selectedBlocks, t])

  return (
    <div
      className={`file-preview-shell${agentPanelOpen && !embedded ? ' agent-open' : ''}${embedded ? ' embedded' : ''}`}
    >
      <header className={`file-viewer-header${embedded ? '' : ' titlebar-drag'}`}>
        <div className={`file-viewer-lead${embedded ? '' : ' titlebar-no-drag'}`}>
          <span className="file-viewer-name">{info?.name ?? basename(filePath)}</span>
          <span className={`preview-badge kind-${badge.toLowerCase()}`}>{badge}</span>
          {assoc && (
            <Button
              icon={<Star size={13} />}
              size="sm"
              className={`preview-star-btn${assoc.isVav ? ' is-default' : ''}`}
              title={
                assoc.isVav
                  ? t('assoc.starTooltipOn')
                  : t('assoc.starTooltip', { ext: assoc.extensions[0]?.replace(/^\./, '') ?? '' })
              }
              onClick={() => {
                if (assoc.isVav) {
                  showDialog({
                    title: t('assoc.unsetTitle', { label: assoc.label }),
                    body: t('assoc.unsetBody', { label: assoc.label }),
                    confirmLabel: t('assoc.unsetAction'),
                    destructive: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await window.vav.settings.unsetFileAssociation(assoc.id)
                          await refreshAssoc()
                          showToast({
                            kind: 'success',
                            title: t('assoc.unsetSuccess', { label: assoc.label })
                          })
                        } catch (err) {
                          showToast({
                            kind: 'error',
                            title: t('assoc.setFailed'),
                            description: (err as Error).message
                          })
                        }
                      })()
                    }
                  })
                  return
                }
                showDialog({
                  title: t('assoc.setTitle', { label: assoc.label }),
                  body: t('assoc.setBody', {
                    label: assoc.label,
                    ext: assoc.extensions.join(', '),
                    current: assoc.defaultApp || t('assoc.unset')
                  }),
                  confirmLabel: t('assoc.setAsDefault'),
                  onConfirm: () => {
                    void (async () => {
                      try {
                        await window.vav.settings.setFileAssociation(assoc.id)
                        await refreshAssoc()
                        showToast({
                          kind: 'success',
                          title: t('assoc.setSuccess', { label: assoc.label })
                        })
                      } catch (err) {
                        showToast({
                          kind: 'error',
                          title: t('assoc.setFailed'),
                          description: (err as Error).message
                        })
                      }
                    })()
                  }
                })
              }}
            />
          )}
        </div>
        <span className="spacer" />
        <div className={`file-viewer-actions${embedded ? '' : ' titlebar-no-drag'}`}>
          <Button
            icon={<Save size={13} />}
            label={t('preview.save')}
            variant="primary"
            size="sm"
            disabled={!hasUnsavedChanges}
            title={`${t('preview.save')} (⌘S)`}
            onClick={() => void save()}
          />
          <Button
            icon={<FilePlus size={13} />}
            label={t('preview.saveAs')}
            variant="secondary"
            size="sm"
            title={`${t('preview.saveAs')} (⌘⇧S)`}
            onClick={() => void saveAs()}
          />
          {!embedded && (
            <Button
              icon={<PanelRight size={13} />}
              variant="ghost"
              size="sm"
              title={t('preview.agentPanel')}
              onClick={() => void toggleAgentPanel()}
            />
          )}
        </div>
      </header>

      <div className="file-preview-main">
        <div className={`file-viewer-body${selectable ? ' selecting' : ''}${storePickMode ? ' pick-mode' : ''}`}>
          {!info && <div className="muted">{t('common.loading')}</div>}
          {info?.error && info.kind !== 'pdf' && (
            <InlineAlert kind="error" title={t('preview.loadFailed')} message={info.error} />
          )}
          {info && !info.error && info.kind === 'csv' && (
            <CsvView
              text={displayText}
              selecting={selectable}
              selectedIds={selectedIds}
              onSelect={applySelection}
            />
          )}
          {info && info.dataUrl && info.kind === 'image' && (
            <MediaSelectFrame
              selecting={selectable}
              selected={selectedIds.includes('media')}
              onSelect={(event) => applySelection('media', event)}
            >
              <img className="file-viewer-media" src={info.dataUrl} alt={info.name} />
            </MediaSelectFrame>
          )}
          {info && info.dataUrl && info.kind === 'audio' && (
            <MediaSelectFrame
              selecting={selectable}
              selected={selectedIds.includes('media')}
              onSelect={(event) => applySelection('media', event)}
            >
              <audio className="file-viewer-media" controls src={info.dataUrl} />
            </MediaSelectFrame>
          )}
          {info && info.dataUrl && info.kind === 'video' && (
            <MediaSelectFrame
              selecting={selectable}
              selected={selectedIds.includes('media')}
              onSelect={(event) => applySelection('media', event)}
            >
              <video className="file-viewer-media" controls src={info.dataUrl} />
            </MediaSelectFrame>
          )}
          {info && info.kind === 'pdf' && (
            <MediaSelectFrame
              selecting={selectable}
              selected={selectedIds.includes('media')}
              onSelect={(event) => applySelection('media', event)}
            >
              <iframe
                className="file-viewer-pdf"
                title={info.name}
                src={`vav-local://preview/?path=${encodeURIComponent(filePath)}`}
              />
            </MediaSelectFrame>
          )}
          {info && !info.error && info.kind === 'text' && (
            <>
              {selectable && drillStack.length > 0 && (
                <div className="preview-drill-bar">
                  {drillStack.map((block, index) => (
                    <button
                      key={`${block.id}-${index}`}
                      type="button"
                      className="preview-drill-crumb"
                      onClick={() => {
                        setDrillStack((prev) => prev.slice(0, index + 1))
                        setSelectedIds([])
                        setLastSelected(null)
                      }}
                    >
                      {block.label ?? block.id}
                    </button>
                  ))}
                  <span className="muted tiny">{t('preview.drillHint')}</span>
                </div>
              )}
              <DocumentView
                path={filePath}
                text={displayText}
                markdown={isMarkdown}
                notebook={isNotebook}
                selecting={selectable}
                blocks={rootBlocks}
                drillStack={drillStack}
                selectedIds={selectedIds}
                selectedBlocks={selectedBlocks}
                onSelectBlock={applySelection}
                onSelectLine={selectByLine}
                onDrillIn={drillInto}
                onAskAgent={(prompt, target) => {
                  setSelectedIds([target.id])
                  setLastSelected(target.id)
                  const id =
                    agentConversationId ??
                    parentConversationId ??
                    useSessionStore.getState().activeId
                  useSessionStore.getState().setDraft(id, prompt)
                  useSessionStore.getState().setPreviewRefs(id, [blockToRef(filePath, badge, target)])
                  useSessionStore.getState().focusComposer()
                }}
              />
            </>
          )}
          {info && !info.error && info.kind === 'binary' && (
            <EmptyState
              title={t('preview.unsupported')}
              description={t('preview.unsupportedDesc')}
            >
              <Button
                label={t('files.quickLook')}
                size="sm"
                onClick={() => void window.vav.files.quickLook(filePath)}
              />
            </EmptyState>
          )}
        </div>

        {agentPanelOpen && !embedded && (
          <aside className="preview-agent-panel" style={{ width: panelWidth }}>
            <div
              className="preview-agent-resizer"
              onMouseDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startW = panelWidth
                const onMove = (e: MouseEvent): void => {
                  const next = Math.min(520, Math.max(280, startW + (startX - e.clientX)))
                  setPanelWidth(next)
                }
                const onUp = (): void => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            {parentConversationId && (
              <div className="preview-agent-meta">
                <div className="muted tiny">{t('preview.fromSession')}</div>
              </div>
            )}
            {agentConversationId ? (
              <SessionDetail variant="preview-edit" />
            ) : (
              <EmptyState
                title={t('preview.startChat')}
                description={t('preview.startChatDesc')}
              />
            )}
          </aside>
        )}
      </div>

      <footer className="file-preview-statusbar">
        <span>{statusLeft}</span>
        <span className="spacer" />
        {statusRight && <span>{statusRight}</span>}
      </footer>

      {confirm && (
        <Modal
          title={t('preview.unsavedTitle')}
          onDismiss={() => setConfirm(null)}
          actions={
            <>
              <Button label={t('common.cancel')} onClick={() => setConfirm(null)} />
              <Button
                label={t('preview.discard')}
                variant="danger"
                onClick={() => void confirmDiscard()}
              />
              <Button
                label={t('preview.save')}
                variant="primary"
                onClick={() => void confirmSave()}
              />
            </>
          }
        >
          <p>{t('preview.unsavedBody', { name: info?.name ?? basename(filePath) })}</p>
          <p className="muted tiny">{t('preview.unsavedHint')}</p>
        </Modal>
      )}
    </div>
  )
}

function collectBlocks(blocks: PreviewBlock[]): PreviewBlock[] {
  const out: PreviewBlock[] = []
  const walk = (list: PreviewBlock[]): void => {
    for (const b of list) {
      out.push(b)
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return out
}

/** One selected preview block → a composer comment-block reference. */
function blockToRef(path: string, badge: string, block: PreviewBlock): PreviewRef {
  return {
    id: `${path}::${block.id}`,
    filePath: path,
    label: block.label ?? `L${block.startLine}–${block.endLine}`,
    startLine: block.startLine,
    endLine: block.endLine,
    text: block.text,
    badge
  }
}

function MediaSelectFrame({
  selecting,
  selected,
  onSelect,
  children
}: {
  selecting: boolean
  selected: boolean
  onSelect: (event: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  if (!selecting) return <>{children}</>
  return (
    <div
      className={`preview-media-frame preview-select-region${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      {children}
    </div>
  )
}

/**
 * Same rendered document in preview and edit. Edit only enables inspect-style
 * block selection — never a source/code editor or inline cell inputs.
 */
function DocumentView({
  path,
  text,
  markdown,
  notebook,
  selecting,
  blocks,
  drillStack,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onDrillIn,
  onAskAgent
}: {
  path: string
  text: string
  markdown: boolean
  notebook: boolean
  selecting: boolean
  blocks: PreviewBlock[]
  drillStack: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event: React.MouseEvent) => void
  onSelectLine: (line: number, event: React.MouseEvent) => void
  onDrillIn: (block?: PreviewBlock | null) => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()

  if (markdown) {
    if (blocks.length === 0) {
      if (!text.trim()) {
        return (
          <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
        )
      }
      return (
        <div className={`preview-document${selecting ? ' selecting' : ''}`}>
          <MarkdownView source={text} filePath={path} />
        </div>
      )
    }
    return (
      <div className={`preview-document${selecting ? ' selecting' : ''}`}>
        {blocks.map((block) => (
          <MarkdownSelectRegion
            key={block.id}
            filePath={path}
            block={block}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelectBlock}
            onAskAgent={onAskAgent}
          />
        ))}
      </div>
    )
  }

  if (notebook) {
    const cells = parseNotebookBlocks(text)
    if (cells.length === 0) {
      return (
        <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
      )
    }
    return (
      <div className={`preview-document notebook${selecting ? ' selecting' : ''}`}>
        {cells.map((cell) => {
          const selected = selecting && selectedIds.includes(cell.id)
          const body = !cell.language ? (
            <MarkdownView source={cell.text} filePath={path} />
          ) : (
            <pre className="file-viewer-code">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{
                  __html: highlightCode(cell.text, cell.language || 'python')
                }}
              />
            </pre>
          )
          if (!selecting) {
            return (
              <div key={cell.id} className="preview-notebook-cell">
                {body}
              </div>
            )
          }
          return (
            <div
              key={cell.id}
              className={`preview-notebook-cell preview-select-region${selected ? ' selected' : ''}`}
              onClick={(event) => onSelectBlock(cell.id, event)}
              onContextMenu={(event) => {
                event.preventDefault()
                void window.vav.window
                  .popupMenu(
                    [
                      { id: 'copy', label: t('preview.copyBlock') },
                      { id: 'analyze', label: t('preview.analyzeBlock') },
                      { id: 'refactor', label: t('preview.refactorBlock') }
                    ],
                    { x: event.clientX, y: event.clientY }
                  )
                  .then((id) => {
                    if (id === 'copy') void window.vav.conversations.copyToClipboard(cell.text)
                    if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), cell)
                    if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), cell)
                  })
              }}
            >
              {body}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <CodeBlockCanvas
      path={path}
      text={text}
      selecting={selecting}
      blocks={blocks}
      drillStack={drillStack}
      selectedIds={selectedIds}
      selectedBlocks={selectedBlocks}
      onSelectBlock={onSelectBlock}
      onSelectLine={onSelectLine}
      onDrillIn={onDrillIn}
      onAskAgent={onAskAgent}
    />
  )
}

/**
 * Continuous highlighted source with whole-block outlines (not per-line paint).
 * Rendering and selection are separated: lines are memoized once, selection
 * overlays are absolutely positioned divs on top. A single delegated handler
 * on the container does hit-testing via blockAtLine.
 */
function CodeBlockCanvas({
  path,
  text,
  selecting,
  blocks,
  drillStack,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onDrillIn,
  onAskAgent
}: {
  path: string
  text: string
  selecting: boolean
  blocks: PreviewBlock[]
  drillStack: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event: React.MouseEvent) => void
  onSelectLine: (line: number, event: React.MouseEvent) => void
  onDrillIn: (block?: PreviewBlock | null) => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()
  const language = languageFromPath(path)
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLPreElement>(null)

  // Highlight every line once — never recompute on hover/selection changes.
  const highlightedLines = useMemo(() => {
    return lines.map((line) => highlightCode(line, language) || ' ')
  }, [lines, language])

  const hoverBlock =
    selecting && hoveredId && !selectedIds.includes(hoveredId)
      ? findBlockById(blocks, hoveredId)
      : null

  // Overlays: one div per selected/hovered block, absolutely positioned by
  // line range × lineHeight. Only a handful of divs — cheap to update.
  const overlays = useMemo(() => {
    if (!selecting) return []
    const result: {
      id: string
      startLine: number
      endLine: number
      selected: boolean
      hovered: boolean
    }[] = []
    for (const block of selectedBlocks) {
      result.push({
        id: block.id,
        startLine: block.startLine,
        endLine: block.endLine,
        selected: true,
        hovered: false
      })
    }
    if (hoverBlock) {
      result.push({
        id: hoverBlock.id,
        startLine: hoverBlock.startLine,
        endLine: hoverBlock.endLine,
        selected: false,
        hovered: true
      })
    }
    return result
  }, [selecting, selectedBlocks, hoverBlock])

  // Single delegated handler — hit-test via blockAtLine, no per-line listeners.
  const handleMouseMove = (event: React.MouseEvent): void => {
    if (!selecting) return
    const lineNo = lineFromEvent(event, containerRef.current)
    if (lineNo == null) return
    const hit = blockAtLine(blocks, lineNo, drillStack)
    setHoveredId(hit?.id ?? null)
  }

  const handleClick = (event: React.MouseEvent): void => {
    if (!selecting) return
    const lineNo = lineFromEvent(event, containerRef.current)
    if (lineNo == null) return
    onSelectLine(lineNo, event)
  }

  const handleDoubleClick = (event: React.MouseEvent): void => {
    if (!selecting) return
    event.preventDefault()
    const lineNo = lineFromEvent(event, containerRef.current)
    if (lineNo == null) return
    const hit = blockAtLine(blocks, lineNo, drillStack)
    if (!hit) return
    onSelectBlock(hit.id, event)
    onDrillIn(hit)
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!selecting) return
    event.preventDefault()
    const lineNo = lineFromEvent(event, containerRef.current)
    if (lineNo == null) return
    const hit = blockAtLine(blocks, lineNo, drillStack)
    if (!hit) return
    const parent = parentBlockOf(blocks, hit.id)
    void window.vav.window
      .popupMenu(
        [
          { id: 'copy', label: t('preview.copyBlock') },
          { id: 'analyze', label: t('preview.analyzeBlock') },
          { id: 'refactor', label: t('preview.refactorBlock') },
          ...(hit.children?.length ? [{ id: 'drill', label: t('preview.drillIn') }] : []),
          ...(parent ? [{ id: 'parent', label: t('preview.selectParent') }] : [])
        ],
        { x: event.clientX, y: event.clientY }
      )
      .then((id) => {
        if (id === 'copy') void window.vav.conversations.copyToClipboard(hit.text)
        if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), hit)
        if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), hit)
        if (id === 'drill') {
          onSelectBlock(hit.id, event)
          onDrillIn(hit)
        }
        if (id === 'parent' && parent) onSelectBlock(parent.id, event)
      })
  }

  return (
    <pre
      ref={containerRef}
      className={`file-viewer-code continuous${selecting ? ' selecting' : ''}`}
      onMouseMove={selecting ? handleMouseMove : undefined}
      onMouseLeave={() => setHoveredId(null)}
      onClick={selecting ? handleClick : undefined}
      onDoubleClick={selecting ? handleDoubleClick : undefined}
      onContextMenu={selecting ? handleContextMenu : undefined}
    >
      {highlightedLines.map((html, i) => (
        <div className="preview-code-line" key={i + 1}>
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ))}
      {overlays.map((ov) => (
        <div
          key={`ov-${ov.id}`}
          className={`preview-code-overlay${ov.selected ? ' selected' : ''}${ov.hovered ? ' hovered' : ''}`}
          style={{
            top: `calc((var(--code-line-height, 1.55em)) * ${ov.startLine - 1})`,
            height: `calc((var(--code-line-height, 1.55em)) * ${ov.endLine - ov.startLine + 1})`
          }}
        />
      ))}
    </pre>
  )
}

/** Hit-test: which line number is under the mouse? */
function lineFromEvent(
  event: React.MouseEvent,
  container: HTMLElement | null
): number | null {
  if (!container) return null
  const rect = container.getBoundingClientRect()
  const y = event.clientY - rect.top + container.scrollTop
  const lineHeight = parseFloat(getComputedStyle(container).lineHeight) || 20
  return Math.floor(y / lineHeight) + 1
}

/**
 * Same Markdown rendering with or without selection. When `selecting`, adds
 * DevTools-style hit targets — never a different document structure.
 */
function MarkdownSelectRegion({
  filePath,
  block,
  selecting,
  selectedIds,
  onSelect,
  onAskAgent,
  forceSelected = false
}: {
  filePath: string
  block: PreviewBlock
  selecting: boolean
  selectedIds: string[]
  onSelect: (id: string, event: React.MouseEvent) => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
  forceSelected?: boolean
}): React.JSX.Element {
  const t = useT()
  const children = block.children ?? []
  const section = children.find((c) => c.kind === 'heading-section')
  const inner = children.filter((c) => c.kind !== 'heading-section')
  const sectionSelected = selecting && !!section && selectedIds.includes(section.id)
  const selected =
    selecting && (forceSelected || selectedIds.includes(block.id) || sectionSelected)

  return (
    <div
      className={`preview-select-region kind-${block.kind}${selected ? ' selected' : ''}`}
      onClick={selecting ? (event) => onSelect(block.id, event) : undefined}
      onDoubleClick={
        selecting && section
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(section.id, event)
            }
          : undefined
      }
      onContextMenu={
        selecting
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              const items = [
                { id: 'copy', label: t('preview.copyBlock') },
                ...(section ? [{ id: 'section', label: t('preview.selectSection') }] : []),
                { id: 'analyze', label: t('preview.analyzeBlock') },
                { id: 'refactor', label: t('preview.refactorBlock') }
              ]
              void window.vav.window
                .popupMenu(items, { x: event.clientX, y: event.clientY })
                .then((id) => {
                  const target = id === 'section' && section ? section : block
                  if (id === 'copy') void window.vav.conversations.copyToClipboard(target.text)
                  if (id === 'section' && section) onSelect(section.id, event)
                  if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), target)
                  if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), target)
                })
            }
          : undefined
      }
    >
      {block.kind === 'code' ? (
        <pre className="file-viewer-code">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{
              __html: highlightCode(
                block.text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''),
                block.language
              )
            }}
          />
        </pre>
      ) : (
        <MarkdownView source={block.text} filePath={filePath} />
      )}
      {block.kind === 'heading' &&
        inner.map((child) => (
          <MarkdownSelectRegion
            key={child.id}
            filePath={filePath}
            block={child}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onAskAgent={onAskAgent}
            forceSelected={sectionSelected}
          />
        ))}
    </div>
  )
}

/** Table render shared by preview/edit; edit enables row/column block select. */
function CsvView({
  text,
  selecting,
  selectedIds,
  onSelect
}: {
  text: string
  selecting: boolean
  selectedIds: string[]
  onSelect: (id: string, event: React.MouseEvent) => void
}): React.JSX.Element {
  const t = useT()
  const model = parseCsvModel(text)

  if (model.headers.length === 0) return <div className="muted">{t('common.empty')}</div>

  return (
    <div className={`table-scroll file-viewer-table${selecting ? ' csv-selectable' : ''}`}>
      <table>
        <thead>
          <tr>
            <th className="csv-row-gutter" />
            {model.headers.map((cell, index) => {
              const id = csvColId(cell, index)
              return (
                <th
                  key={index}
                  className={selecting && selectedIds.includes(id) ? 'selected' : undefined}
                  onClick={selecting ? (event) => onSelect(id, event) : undefined}
                >
                  {cell}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, rowIndex) => {
            const rowId = `row-${rowIndex + 1}`
            return (
              <tr
                key={rowIndex}
                className={selecting && selectedIds.includes(rowId) ? 'selected' : undefined}
              >
                <td
                  className="csv-row-gutter"
                  onClick={selecting ? (event) => onSelect(rowId, event) : undefined}
                  title={selecting ? t('preview.selectRow') : undefined}
                >
                  {rowIndex + 1}
                </td>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
