import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { ZipArchiveInfo, ZipEntryInfo } from '@shared/ipc'
import type { PreviewBlock } from '@shared/previewBlock'
import { handleClickPickMouseDown } from '../lib/clickPick'
import { formatBytes } from '../lib/format'
import { useT } from '../i18n/useT'

type ZipTreeNode = {
  path: string
  name: string
  isDirectory: boolean
  entry: ZipEntryInfo | null
  children: ZipTreeNode[]
}

function buildTree(entries: ZipEntryInfo[]): ZipTreeNode[] {
  const root: ZipTreeNode[] = []
  const dirMap = new Map<string, ZipTreeNode>()

  const ensureDir = (dirPath: string): ZipTreeNode => {
    const norm = dirPath.endsWith('/') ? dirPath : `${dirPath}/`
    const existing = dirMap.get(norm)
    if (existing) return existing
    const parts = norm.replace(/\/+$/, '').split('/').filter(Boolean)
    const name = parts.length ? `${parts[parts.length - 1]}/` : '/'
    const node: ZipTreeNode = {
      path: norm,
      name,
      isDirectory: true,
      entry: null,
      children: []
    }
    dirMap.set(norm, node)
    if (parts.length <= 1) {
      root.push(node)
    } else {
      const parentPath = `${parts.slice(0, -1).join('/')}/`
      ensureDir(parentPath).children.push(node)
    }
    return node
  }

  for (const entry of entries) {
    const raw = entry.path.replace(/\\/g, '/')
    if (!raw || raw === '/') continue
    if (entry.isDirectory || raw.endsWith('/')) {
      const node = ensureDir(raw)
      node.entry = entry
      continue
    }
    const parts = raw.split('/').filter(Boolean)
    const name = parts[parts.length - 1] ?? raw
    const node: ZipTreeNode = {
      path: raw,
      name,
      isDirectory: false,
      entry,
      children: []
    }
    if (parts.length === 1) {
      root.push(node)
    } else {
      const parentPath = `${parts.slice(0, -1).join('/')}/`
      ensureDir(parentPath).children.push(node)
    }
  }

  const sortNodes = (nodes: ZipTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(root)
  return root
}

function entryToBlock(entry: ZipEntryInfo, children?: ZipEntryInfo[]): PreviewBlock {
  const lines = [
    entry.isDirectory ? `DIR ${entry.path}` : `FILE ${entry.path}`,
    `compressed: ${entry.compressedSize}`,
    `uncompressed: ${entry.uncompressedSize}`
  ]
  if (entry.modifiedAt) lines.push(`modified: ${new Date(entry.modifiedAt).toISOString()}`)
  if (entry.isDirectory && children?.length) {
    lines.push('children:')
    for (const c of children.slice(0, 50)) {
      lines.push(`  ${c.isDirectory ? 'D' : 'F'} ${c.name} (${c.uncompressedSize})`)
    }
  }
  return {
    id: `zip:${entry.path}`,
    kind: entry.isDirectory ? 'section' : 'code',
    text: lines.join('\n'),
    label: `ZIP · ${entry.path}`,
    startLine: 1,
    endLine: 1
  }
}

export function ZipArchiveView({
  name,
  zip,
  truncated = false,
  passwordProtected = false,
  selecting,
  selectedIds,
  onSelect
}: {
  name: string
  zip: ZipArchiveInfo
  truncated?: boolean
  /** Structure listed without password; encrypted entry bodies not extracted. */
  passwordProtected?: boolean
  selecting: boolean
  selectedIds: string[]
  onSelect: (block: PreviewBlock, event?: React.MouseEvent | null) => void
}): React.JSX.Element {
  const t = useT()
  const tree = useMemo(() => buildTree(zip.entries), [zip.entries])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand top-level dirs by default.
    const init = new Set<string>()
    for (const n of tree) {
      if (n.isDirectory) init.add(n.path)
    }
    return init
  })

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: ZipTreeNode, depth: number): React.ReactNode => {
    const id = `zip:${node.path}`
    const selected = selectedIds.includes(id)
    const isOpen = node.isDirectory && expanded.has(node.path)
    const childEntries = node.children
      .map((c) => c.entry)
      .filter((e): e is ZipEntryInfo => !!e)

    return (
      <div key={node.path} className="zip-tree-node">
        <div
          className={`zip-tree-row${selected ? ' selected' : ''}${selecting ? ' selectable' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onMouseDown={(event) => {
            if (!selecting) return
            if (event.button !== 0) return
            const entry: ZipEntryInfo = node.entry ?? {
              path: node.path,
              name: node.name,
              isDirectory: node.isDirectory,
              compressedSize: 0,
              uncompressedSize: 0
            }
            handleClickPickMouseDown(event, () =>
              onSelect(entryToBlock(entry, childEntries))
            )
          }}
        >
          {node.isDirectory ? (
            <button
              type="button"
              className="zip-tree-chevron"
              aria-label={isOpen ? t('preview.zipCollapse') : t('preview.zipExpand')}
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.path)
              }}
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="zip-tree-chevron-spacer" />
          )}
          <span className="zip-tree-icon" aria-hidden>
            {node.isDirectory ? (
              isOpen ? (
                <FolderOpen size={14} />
              ) : (
                <Folder size={14} />
              )
            ) : (
              <File size={14} />
            )}
          </span>
          <span className="zip-tree-name">{node.name}</span>
          {!node.isDirectory && node.entry && (
            <span className="zip-tree-meta muted tiny">
              {formatBytes(node.entry.uncompressedSize)}
            </span>
          )}
        </div>
        {node.isDirectory && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="zip-archive-view">
      <div className="zip-archive-head">
        <Folder size={16} className="zip-archive-head-icon" aria-hidden />
        <span className="zip-archive-title">{name}</span>
        <span className="muted tiny">
          {passwordProtected
            ? t('preview.zipPassword')
            : truncated
              ? t('preview.zipTruncated')
              : t('preview.zipEntries', { n: zip.entryCount })}
        </span>
      </div>
      {passwordProtected && (
        <p className="zip-archive-note muted tiny">{t('preview.zipPasswordHint')}</p>
      )}
      {tree.length === 0 ? (
        <div className="zip-archive-empty muted">
          {passwordProtected
            ? t('preview.zipPasswordEmpty')
            : truncated
              ? t('preview.zipIndexFailed')
              : t('preview.zipEmpty')}
        </div>
      ) : (
        <div className="zip-archive-tree">{tree.map((n) => renderNode(n, 0))}</div>
      )}
    </div>
  )
}
