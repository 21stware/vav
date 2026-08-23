/** Pull the browser OAuth authorize URL out of CLI login output. */

const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g
const OSC8 = /\u001b\]8;;(https:\/\/[^\u0007\u001b]+)/g
const HREF = /https:\/\/[^\s"'<>\\]+/g

function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

function trimUrl(url: string): string {
  return url.replace(/[),.;]+$/g, '')
}

function isDeviceCodeUrl(url: string): boolean {
  return /\/oauth2\/device\b|\/device\/|\/activate\b|user_code=/i.test(url)
}

function isAuthorizeUrl(url: string): boolean {
  return /\/oauth2\/authorize\b/i.test(url)
}

/**
 * Prefer `/oauth2/authorize` (browser OAuth).
 * Never return a device-code / “enter this code” URL — that is the token flow.
 */
export function loginUrlFromCliOutput(text: string): string | null {
  const urls: string[] = []
  for (const match of text.matchAll(OSC8)) {
    if (match[1]) urls.push(trimUrl(match[1]))
  }
  for (const match of stripAnsi(text).matchAll(HREF)) {
    urls.push(trimUrl(match[0]))
  }
  const unique = [...new Set(urls)].filter((url) => url.startsWith('https://'))
  return unique.find(isAuthorizeUrl) ?? unique.find((url) => !isDeviceCodeUrl(url)) ?? null
}
