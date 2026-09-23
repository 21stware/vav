import { useEffect } from 'react'
import { openInApp } from '../openInApp'

/** Agent catalog create/open → reveal the object in the right-hand column. */
export function useAppHostApply(): void {
  useEffect(() => {
    const api = window.vav?.apps
    if (!api?.onApply) return
    return api.onApply((event) => {
      if (event.type === 'open' || event.type === 'created') {
        void openInApp(event.url)
      }
    })
  }, [])
}
