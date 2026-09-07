export type GithubListKeyEvent = {
  key: string
  preventDefault: () => void
}

export type GithubListScrollParent = {
  current: {
    querySelector: (selector: string) => { scrollIntoView: (opts: { block: string }) => void } | null
  } | null
}

/** Arrow/Home/End/Enter keyboard navigation for GitHub tray listboxes. */
export function makeListKeyDown({
  count,
  setIndex,
  selectAt,
  previewAt,
  scrollParent,
  rowAttr
}: {
  count: number
  setIndex: (updater: (prev: number) => number) => void
  selectAt: (index: number) => void
  previewAt?: (index: number) => void
  scrollParent: GithubListScrollParent
  rowAttr: string
}): (event: GithubListKeyEvent) => void {
  const reveal = (index: number): void => {
    const scroll = (): void => {
      scrollParent.current
        ?.querySelector(`[${rowAttr}="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll)
    else scroll()
  }
  return (event) => {
    if (count === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((prev) => {
        const next = Math.max(0, Math.min(count - 1, prev + (event.key === 'ArrowDown' ? 1 : -1)))
        selectAt(next)
        reveal(next)
        return next
      })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : count - 1
      setIndex(() => next)
      selectAt(next)
      reveal(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIndex((prev) => {
        if (previewAt) previewAt(prev)
        else selectAt(prev)
        return prev
      })
    }
  }
}
