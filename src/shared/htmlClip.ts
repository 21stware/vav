/** Fence language tags that render as an interactive app. */
export const HTML_CLIP_LANGS = new Set(['app', 'html-clip', 'htmlclip', 'html_clip'])

export function isHtmlClipLang(language: string): boolean {
  return HTML_CLIP_LANGS.has(language.trim().toLowerCase())
}

export type HtmlClipThemeVars = Record<string, string>

/** Tokens the host paints onto :root and refreshes on light/dark switch. */
export const CLIP_THEME_VAR_KEYS = [
  '--bg-content',
  '--bg-raised',
  '--bg-sunken',
  '--text',
  '--text-secondary',
  '--text-tertiary',
  '--accent',
  '--accent-text',
  '--accent-fg',
  '--border',
  '--danger',
  '--success',
  '--warning',
  '--vav-scheme'
] as const

const LIGHT_THEME: HtmlClipThemeVars = {
  '--bg-content': '#fcfcfc',
  '--bg-raised': '#ffffff',
  '--bg-sunken': '#f2f2f4',
  '--text': '#141416',
  '--text-secondary': '#5c5c66',
  '--text-tertiary': '#8a8a94',
  '--accent': '#3a3a42',
  '--accent-text': '#3a3a42',
  '--accent-fg': '#ffffff',
  '--border': 'rgba(20, 20, 28, 0.09)',
  '--danger': '#c4544f',
  '--success': '#2f8f62',
  '--warning': '#b07a20',
  '--vav-scheme': 'light'
}

const DARK_THEME: HtmlClipThemeVars = {
  '--bg-content': '#1b1b1d',
  '--bg-raised': '#242427',
  '--bg-sunken': '#161617',
  '--text': '#efeff1',
  '--text-secondary': '#a2a2a9',
  '--text-tertiary': '#73737b',
  '--accent': '#c8c8d0',
  '--accent-text': '#e4e4ea',
  '--accent-fg': '#141416',
  '--border': 'rgba(255, 255, 255, 0.07)',
  '--danger': '#e8817c',
  '--success': '#6ec596',
  '--warning': '#d8ac62',
  '--vav-scheme': 'dark'
}

/** Keep a coherent light or dark set — never mix light ink onto a dark plate. */
export function resolveClipTheme(vars: HtmlClipThemeVars = {}): HtmlClipThemeVars {
  const scheme = vars['--vav-scheme'] === 'dark' ? 'dark' : 'light'
  const base = scheme === 'dark' ? DARK_THEME : LIGHT_THEME
  const merged: HtmlClipThemeVars = { ...base, ...vars, '--vav-scheme': scheme }
  if (scheme === 'dark' && isDarkInk(merged['--text'])) merged['--text'] = DARK_THEME['--text']
  if (scheme === 'dark' && isDarkInk(merged['--text-secondary'])) {
    merged['--text-secondary'] = DARK_THEME['--text-secondary']
  }
  if (scheme === 'light' && isLightInk(merged['--text'])) merged['--text'] = LIGHT_THEME['--text']
  return merged
}

function parseRgb(value: string | undefined): { r: number; g: number; b: number } | null {
  if (!value) return null
  const hex = value.trim()
  if (hex.charAt(0) === '#') {
    const raw = hex.length === 4
      ? hex[1]! + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
      : hex.slice(1)
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    }
  }
  const m = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return null
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
}

function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

function isDarkInk(value: string | undefined): boolean {
  const c = parseRgb(value)
  return !!c && relativeLuminance(c) < 0.45
}

function isLightInk(value: string | undefined): boolean {
  const c = parseRgb(value)
  return !!c && relativeLuminance(c) > 0.72
}

/** Host-injected look so a clip matches VAV without the model restyling chrome. */
export const HTML_CLIP_CHROME_CSS = `
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg-content);
}
html, body {
  margin: 0;
  min-height: 0 !important;
  background: var(--bg-content) !important;
  color: var(--text) !important;
}
html[data-theme='dark'] { color-scheme: dark; }
html[data-theme='light'] { color-scheme: light; }
body { padding: 0; }
*, *::before, *::after {
  box-sizing: border-box;
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
button, input, select, textarea {
  font: inherit;
  color: inherit;
}
button {
  appearance: none;
  height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  background: var(--bg-raised);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text);
  cursor: pointer;
}
button:hover { background: var(--bg-sunken); }
button:active { transform: scale(0.97); }
button[data-primary], button.primary {
  background: var(--accent);
  color: var(--accent-fg);
  box-shadow: none;
}
input, select, textarea {
  width: 100%;
  max-width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: var(--bg-sunken);
  box-shadow: inset 0 0 0 1px var(--border);
}
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
a { color: var(--accent-text); }
h1, h2, h3 { letter-spacing: -0.02em; font-weight: 590; color: var(--text); }
h1 { font-size: 20px; margin: 0 0 10px; }
h2 { font-size: 16px; margin: 18px 0 8px; }
h3 { font-size: 14px; margin: 14px 0 6px; }
p { margin: 0 0 10px; }
.card, [data-card] {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-raised);
  box-shadow: inset 0 0 0 1px var(--border);
}
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.muted, .hint { color: var(--text-tertiary); font-size: 12px; }
img, svg, video { max-width: 100%; height: auto; }
canvas { max-width: 100%; height: auto; }
`

/**
 * Official full-page diagrams (e.g. diagram-design) use 100vh + min-width:900px
 * and flex-center, which clips titles and overflows the chat iframe.
 */
export const HTML_CLIP_FIT_CSS = `
html, body {
  min-width: 0 !important;
  width: 100% !important;
}
body { overflow: visible; }
svg[viewBox], svg[viewbox] {
  min-width: 0 !important;
  max-width: 100% !important;
  height: auto !important;
}
.frame { max-width: 100% !important; }
`

/** ESM / UMD hosts clips may import. Everything else is stripped. */
export const HTML_CLIP_TRUSTED_HOSTS = [
  'esm.sh',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'stately.ai',
  'cdn.tldraw.com'
] as const

const STATELY = 'https://stately.ai https://*.stately.ai'
const STATELY_WS = 'wss://stately.ai wss://*.stately.ai'
const TLDRAW = 'https://cdn.tldraw.com'

const CSP =
  "default-src 'none'; " +
  `script-src 'unsafe-inline' 'unsafe-eval' https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com ${STATELY}; ` +
  `style-src 'unsafe-inline' https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com ${STATELY}; ` +
  `font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net ${STATELY} ${TLDRAW}; ` +
  "img-src data: blob: https:; " +
  "media-src data: blob:; " +
  `connect-src https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com ${STATELY} ${STATELY_WS} ${TLDRAW}; ` +
  `frame-src ${STATELY}; ` +
  "worker-src blob:; " +
  `child-src blob: ${STATELY}; ` +
  "form-action 'none'; " +
  "base-uri 'none'"

const IMPORT_MAP = JSON.stringify({
  imports: {
    xstate: 'https://esm.sh/xstate@5',
    '@statelyai/inspect': 'https://esm.sh/@statelyai/inspect@0.7.2',
    p5: 'https://esm.sh/p5@1',
    three: 'https://esm.sh/three@0.170.0',
    d3: 'https://esm.sh/d3@7',
    react: 'https://esm.sh/react@18.3.1',
    'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
    'react-dom': 'https://esm.sh/react-dom@18.3.1',
    'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
    tldraw: 'https://esm.sh/tldraw@3.11.0?external=react,react-dom'
  }
})

const RESIZE_SCRIPT = `(function(){
  function isViewportFill(el){
    var cs = getComputedStyle(el);
    var vh = window.innerHeight || 0;
    function fills(v){
      if (!v) return false;
      if (v === '100vh' || v === '100dvh' || v === '100%') return true;
      var px = parseFloat(v);
      return vh > 0 && Number.isFinite(px) && Math.abs(px - vh) < 2;
    }
    return fills(cs.minHeight) || fills(cs.height);
  }
  function walk(el, acc){
    if (!el || el.nodeType !== 1) return acc;
    if (el.getAttribute && el.getAttribute('data-vav-clip-resize')) return acc;
    if (el === document.body || el === document.documentElement || isViewportFill(el)) {
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) acc = walk(kids[i], acc);
      var cs = getComputedStyle(el);
      var extra = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      return acc + extra;
    }
    var r = el.getBoundingClientRect();
    var mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
    var bottom = r.bottom + mb;
    return bottom > acc ? bottom : acc;
  }
  function contentHeight(){
    var body = document.body;
    if (!body) return 140;
    // Never use scrollHeight / 100vh — those equal the iframe and grow forever.
    var h = Math.max(140, Math.ceil(walk(body, 0)));
    return Math.min(h, 2400);
  }
  function send(){
    try { parent.postMessage({ type: 'vav-html-clip', height: contentHeight() }, '*'); } catch (e) {}
  }
  if (typeof ResizeObserver === 'function') {
    var ro = new ResizeObserver(send);
    if (document.documentElement) ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  window.addEventListener('load', send);
  document.addEventListener('DOMContentLoaded', send);
  send();
  function rgbOf(str){
    var m = String(str || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  function lum(c){
    function f(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function grayInk(c){
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 48;
  }
  function fixInk(){
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var nodes = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute && el.getAttribute('data-vav-clip-resize')) continue;
      var cs = getComputedStyle(el);
      var tag = el.tagName;
      if (tag === 'TEXT' || tag === 'TSPAN') {
        var fill = rgbOf(cs.fill);
        if (fill && grayInk(fill) && ((dark && lum(fill) < 0.45) || (!dark && lum(fill) > 0.72))) {
          el.style.setProperty('fill', 'var(--text)', 'important');
        }
        continue;
      }
      var col = rgbOf(cs.color);
      if (!col || !grayInk(col)) continue;
      if ((dark && lum(col) < 0.45) || (!dark && lum(col) > 0.72)) {
        el.style.setProperty('color', 'var(--text)', 'important');
      }
    }
  }
  function fixSurfaces(){
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var els = [];
    if (document.body) els.push(document.body);
    if (document.body && document.body.firstElementChild) els.push(document.body.firstElementChild);
    ['#root', '#app', '#__next', '.app', '.page', '.wrap'].forEach(function(sel){
      var n = document.querySelector(sel);
      if (n) els.push(n);
    });
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var bg = rgbOf(getComputedStyle(el).backgroundColor);
      if (!bg) continue;
      var L = lum(bg);
      if (!dark && L < 0.18) el.style.setProperty('background-color', 'var(--bg-content)', 'important');
      if (dark && L > 0.88) el.style.setProperty('background-color', 'var(--bg-content)', 'important');
    }
  }
  function applyTheme(vars){
    var root = document.documentElement;
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k) && String(k).indexOf('--') === 0) {
        root.style.setProperty(k, vars[k], 'important');
      }
    }
    var scheme = vars['--vav-scheme'] === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', scheme);
    root.style.colorScheme = scheme;
    fixSurfaces();
    fixInk();
    try { root.dispatchEvent(new CustomEvent('vav-theme', { detail: { scheme: scheme } })); } catch (e) {}
    send();
  }
  window.addEventListener('message', function(ev){
    var d = ev.data;
    if (!d || d.type !== 'vav-clip-theme' || !d.vars) return;
    applyTheme(d.vars);
  });
  window.addEventListener('load', function(){ fixSurfaces(); fixInk(); });
})();`

export function isFullHtmlDocument(source: string): boolean {
  return /<html[\s>]/i.test(source) || /<!doctype\s+html/i.test(source)
}

export function isTrustedClipUrl(raw: string): boolean {
  try {
    const url = new URL(raw, 'https://clip.invalid')
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return HTML_CLIP_TRUSTED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

function attrUrl(attrs: string): string {
  const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
  return (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim()
}

/**
 * Official Stately Inspector mounts into an empty iframe, then sets
 * src to https://stately.ai/inspect. Keep those. Drop srcdoc and
 * untrusted hosts.
 */
function iframeAllowed(attrs: string): boolean {
  if (/\bsrcdoc\s*=/i.test(attrs)) return false
  const href = attrUrl(attrs)
  if (!href || href === 'about:blank') return true
  return isTrustedClipUrl(href)
}

/**
 * Drop untrusted remote loaders and attacker frames.
 * Inline scripts stay. Trusted CDN script src stays.
 * Empty / about:blank / stately.ai iframes stay for the official inspector.
 */
export function stripExternalClipLoaders(source: string): string {
  return source
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs: string) => {
      const href = attrUrl(attrs)
      if (!href) return full
      return isTrustedClipUrl(href) ? full : ''
    })
    .replace(/<script\b[^>]*\bsrc\s*=\s*[^>]*\/>/gi, (full) => {
      const href = attrUrl(full)
      return href && isTrustedClipUrl(href) ? full : ''
    })
    .replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe>/gi, (full, attrs: string) =>
      iframeAllowed(attrs) ? full : ''
    )
    .replace(/<iframe\b([^>]*)\/>/gi, (full, attrs: string) =>
      iframeAllowed(attrs) ? full : ''
    )
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
}

function themeStyle(vars: HtmlClipThemeVars): string {
  const merged = resolveClipTheme(vars)
  const body = Object.entries(merged)
    .filter(([key]) => key.startsWith('--'))
    .map(([key, value]) => `${key}: ${value} !important;`)
    .join(' ')
  return `:root, html { ${body} }`
}

function schemeOf(vars: HtmlClipThemeVars): 'light' | 'dark' {
  return vars['--vav-scheme'] === 'dark' ? 'dark' : 'light'
}

function stampHtmlTheme(html: string, vars: HtmlClipThemeVars): string {
  const scheme = schemeOf(vars)
  if (/<html\b/i.test(html)) {
    return html.replace(/<html\b([^>]*)>/i, (_full, rest: string) => {
      let attrs = rest
      if (/\bdata-theme\s*=/.test(attrs)) {
        attrs = attrs.replace(/\bdata-theme\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `data-theme="${scheme}"`)
      } else {
        attrs += ` data-theme="${scheme}"`
      }
      if (/\bstyle\s*=/.test(attrs)) {
        attrs = attrs.replace(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i, (_s, a: string, b: string) => {
          const prev = a ?? b ?? ''
          const next = /color-scheme\s*:/.test(prev)
            ? prev.replace(/color-scheme\s*:[^;]+/, `color-scheme: ${scheme}`)
            : `${prev}; color-scheme: ${scheme}`
          return `style="${next}"`
        })
      } else {
        attrs += ` style="color-scheme: ${scheme}"`
      }
      return `<html${attrs}>`
    })
  }
  return html
}

function headExtras(vars: HtmlClipThemeVars, chrome: boolean, fit: boolean): string {
  return (
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}" />` +
    `<script type="importmap">${IMPORT_MAP}</script>` +
    `<style data-vav-clip-theme="1">${themeStyle(vars)}</style>` +
    (chrome ? `<style data-vav-clip-chrome="1">${HTML_CLIP_CHROME_CSS}</style>` : '') +
    (fit ? `<style data-vav-clip-fit="1">${HTML_CLIP_FIT_CSS}</style>` : '')
  )
}

function injectBeforeHeadClose(html: string, extras: string, script: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${extras}</head>`)
  }
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body([\s>])/i, `<head>${extras}</head><body$1`)
  }
  return `<!DOCTYPE html><html><head>${extras}</head><body>${html}${script}</body></html>`
}

function injectBeforeBodyClose(html: string, script: string): string {
  const tag = `<script data-vav-clip-resize="1">${script}</script>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`)
  return `${html}${tag}`
}

/**
 * Build a srcdoc document: theme tokens, clip chrome, CSP, trusted CDN only.
 * Fragments are wrapped; full documents keep their markup and receive extras.
 */
export function prepareHtmlClipSrcDoc(
  source: string,
  vars: HtmlClipThemeVars = {}
): string {
  const cleaned = stripExternalClipLoaders(source || '')
  const full = isFullHtmlDocument(cleaned)
  const extras = headExtras(vars, !full, true)
  if (full) {
    return stampHtmlTheme(
      injectBeforeBodyClose(injectBeforeHeadClose(cleaned, extras, ''), RESIZE_SCRIPT),
      vars
    )
  }
  return stampHtmlTheme(
    `<!DOCTYPE html><html><head>${extras}</head>` +
      `<body>${cleaned}<script data-vav-clip-resize="1">${RESIZE_SCRIPT}</script></body></html>`,
    vars
  )
}
