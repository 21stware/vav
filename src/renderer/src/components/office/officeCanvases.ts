/**
 * Warm handles for the format canvases.
 *
 * Lives apart from `OfficeNativeView` so the prefetcher can reach the loaders
 * without statically importing the canvases and collapsing the code split.
 */

import { createWarmComponent } from '../../lib/warmComponent'
import type { DocxNativeView } from './DocxNativeView'
import type { PdfNativeView } from './PdfNativeView'
import type { PptxNativeView } from './PptxNativeView'
import type { XlsxNativeView } from './XlsxNativeView'

export const docxCanvas = createWarmComponent<React.ComponentProps<typeof DocxNativeView>>(
  () => import('./DocxNativeView').then((m) => m.DocxNativeView)
)

export const pdfCanvas = createWarmComponent<React.ComponentProps<typeof PdfNativeView>>(
  () => import('./PdfNativeView').then((m) => m.PdfNativeView)
)

export const xlsxCanvas = createWarmComponent<React.ComponentProps<typeof XlsxNativeView>>(
  () => import('./XlsxNativeView').then((m) => m.XlsxNativeView)
)

export const pptxCanvas = createWarmComponent<React.ComponentProps<typeof PptxNativeView>>(
  () => import('./PptxNativeView').then((m) => m.PptxNativeView)
)
