/**
 * DOCX → DOM. The parse/paint half of {@link DocxNativeView}, kept free of
 * React so the fidelity harness (scripts/office-fidelity) paints exactly what
 * the app paints.
 */

import { renderAsync } from 'docx-preview'

/** Paint `buffer` into `staging`; docx-preview's stylesheet lands in `styleHost`. */
export async function renderDocx(
  buffer: ArrayBuffer,
  staging: HTMLElement,
  styleHost?: HTMLElement
): Promise<void> {
  await renderAsync(buffer, staging, styleHost, {
    className: 'docx-native',
    inWrapper: true,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    ignoreWidth: false,
    ignoreHeight: false,
    useBase64URL: true
  })

  // Library default injects gray stage on the wrapper — strip it explicitly
  // (CSS targets .docx-native-wrapper; also clear any inline leftovers).
  const wrapper = staging.querySelector(
    '.docx-native-wrapper, .docx-wrapper'
  ) as HTMLElement | null
  if (wrapper) {
    wrapper.style.background = 'transparent'
    wrapper.style.padding = '0'
    wrapper.style.boxShadow = 'none'
  }
}
