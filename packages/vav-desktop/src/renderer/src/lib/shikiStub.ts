/** Optional peer of @21stware/handymd. VAV passes its own highlighter. */
export async function createHighlighter(): Promise<never> {
  throw new Error('shiki is not bundled')
}
