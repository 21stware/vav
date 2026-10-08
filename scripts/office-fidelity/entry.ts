/**
 * Browser half of the office fidelity harness: paints a document with the
 * same module the app uses, inside the app's own DOM and stylesheet.
 */

import { renderDocx } from '../../packages/vav-desktop/src/renderer/src/components/office/docxRender'

declare global {
  interface Window {
    paintDocx: (url: string) => Promise<number>
  }
}

window.paintDocx = async (url: string): Promise<number> => {
  const buffer = await (await fetch(url)).arrayBuffer()
  const body = document.querySelector<HTMLElement>('.docx-body-host')!
  const styleHost = document.querySelector<HTMLElement>('.docx-style-host')!
  const staging = document.createElement('div')
  await renderDocx(buffer, staging, styleHost)
  body.replaceChildren(...Array.from(staging.childNodes))
  await document.fonts.ready
  await Promise.all(
    Array.from(body.querySelectorAll('img')).map((img) =>
      img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true }))
    )
  )
  return body.querySelectorAll('section.docx-native').length
}
