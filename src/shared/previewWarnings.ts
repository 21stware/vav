/**
 * Soft window / first-chunk index notes belong in render, not in a
 * product “truncated for preview” banner. Shared by FileViewer and
 * StructuredDocView so the two canvases stay consistent.
 */
export function isSilentPreviewWindowWarning(warning: string): boolean {
  return (
    /truncated to \d+\s*[x×]\s*\d+/i.test(warning) ||
    (/truncat/i.test(warning) && /for preview/i.test(warning)) ||
    /Sheet .+ truncated/i.test(warning) ||
    /Partial structured index/i.test(warning) ||
    /Text index scanned first \d+ of \d+ pages/i.test(warning)
  )
}
