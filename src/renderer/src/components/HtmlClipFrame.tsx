import { useEffect, useRef, useState } from 'react'
import { materializeAppUrl, preparedClipDocument, pushClipTheme } from '../lib/htmlClipRender'

/**
 * Interactive app surface for the file-preview window.
 * Loaded from vav-local so IndexedDB works (tldraw) without parent access.
 */
export function HtmlClipFrame({
  source,
  title = 'App',
  fill = false
}: {
  source: string
  title?: string
  /** Fill the parent (standalone app window). */
  fill?: boolean
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(520)
  const [src, setSrc] = useState<string | undefined>()
  const [srcDoc, setSrcDoc] = useState<string | undefined>()
  const [theme, setTheme] = useState(
    () => (typeof document !== 'undefined' ? document.documentElement.dataset.theme : '') || 'light'
  )

  useEffect(() => {
    const read = (): void => {
      setTheme(document.documentElement.dataset.theme || 'light')
    }
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (fill) {
      // Overlay: paint from srcdoc now. Do not wait on a clip write + stream URL.
      setSrc(undefined)
      setSrcDoc(preparedClipDocument(source, /xstate/i.test(title) ? 'xstate' : 'app'))
      return
    }
    let cancelled = false
    setSrcDoc(undefined)
    void materializeAppUrl(source).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [source, theme, fill, title])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data as { type?: string; height?: number } | null
      if (!data || data.type !== 'vav-html-clip') return
      if (fill) return
      if (typeof data.height === 'number' && Number.isFinite(data.height)) {
        setHeight(Math.max(240, Math.min(1600, Math.round(data.height))))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [src, fill])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !(src || srcDoc)) return
    const push = (): void => pushClipTheme(iframe)
    iframe.addEventListener('load', push)
    push()
    return () => iframe.removeEventListener('load', push)
  }, [src, srcDoc, theme])

  return (
    <div className={fill ? 'html-clip-stage is-fill' : 'html-clip-stage'}>
      <iframe
        ref={iframeRef}
        className="html-clip-frame"
        title={title}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
        referrerPolicy="no-referrer"
        src={src}
        srcDoc={!src ? srcDoc : undefined}
        style={fill ? { height: '100%' } : { height }}
      />
    </div>
  )
}
