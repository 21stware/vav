import { useEffect, useState, type RefObject } from 'react'
import {
  appSplitLayout,
  loadApplicationsWidth,
  type AppSplitLayout
} from './applicationsWidth'

/** Follow the app column, not the window — same idea as a tablet split view. */
export function useAppSplitLayout(rootRef: RefObject<HTMLElement | null>): AppSplitLayout {
  const [layout, setLayout] = useState<AppSplitLayout>(() =>
    appSplitLayout(loadApplicationsWidth())
  )

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const apply = (width: number): void => {
      setLayout(appSplitLayout(width))
    }
    apply(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootRef])

  return layout
}
