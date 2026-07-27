import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * In-transcript find (⌘F). Independent from the sidebar filter, which matches
 * conversation titles only (main-chat-search.rpml annotation 2).
 */
export function SearchStrip(): React.JSX.Element {
  const t = useT()
  const search = useSessionStore((s) => s.search)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const stepSearch = useSessionStore((s) => s.stepSearch)
  const closeSearch = useSessionStore((s) => s.closeSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const total = search.matchIds.length
  const hasQuery = search.query.trim().length > 0

  return (
    <div className="search-strip">
      <Search size={13} style={{ opacity: 0.6 }} />
      <input
        ref={inputRef}
        className="text-field"
        style={{ flex: 1 }}
        placeholder={t('search.placeholder')}
        value={search.query}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            stepSearch(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            closeSearch()
          }
        }}
      />
      {hasQuery && (
        <span className="muted" style={{ minWidth: 42, textAlign: 'right' }}>
          {total === 0 ? t('search.noMatch') : `${search.index + 1} / ${total}`}
        </span>
      )}
      <Button
        icon={<ChevronUp size={13} />}
        size="sm"
        title={t('search.previous', { shortcut: keys('⌘⇧G') })}
        disabled={total === 0}
        onClick={() => stepSearch(-1)}
      />
      <Button
        icon={<ChevronDown size={13} />}
        size="sm"
        title={t('search.next', { shortcut: keys('⌘G') })}
        disabled={total === 0}
        onClick={() => stepSearch(1)}
      />
      <Button icon={<X size={13} />} size="sm" title={t('common.close')} onClick={closeSearch} />
    </div>
  )
}
