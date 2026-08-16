/** Fence tags that render as an official Stately Inspector statechart. */
export const XSTATE_FENCE_LANGS = new Set(['xstate', 'xstate-viz', 'statechart'])

export function isXstateLang(language: string): boolean {
  return XSTATE_FENCE_LANGS.has(language.trim().toLowerCase())
}

export function unwrapXstateSource(source: string): string {
  let text = (source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  text = text.replace(/^export\s+default\s+/, '')
  text = text.replace(/^(?:const|let|var)\s+\w+\s*=\s*/, '')
  const wrapped = /^createMachine\s*\(\s*/.test(text)
  if (wrapped) {
    text = text.replace(/^createMachine\s*\(\s*/, '')
    text = text.replace(/\)\s*;?\s*$/, '')
  }
  return text.replace(/;+\s*$/, '').trim()
}

export function parseXstateConfig(source: string): Record<string, unknown> | null {
  const text = unwrapXstateSource(source)
  if (!text) return null
  try {
    const value = JSON.parse(text) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* JS object literal — only used inside the sandboxed host */
  }
  return null
}

export function collectXstateEvents(
  config: unknown,
  into: Set<string> = new Set()
): string[] {
  if (!config || typeof config !== 'object') return [...into]
  const rec = config as Record<string, unknown>
  if (rec.on && typeof rec.on === 'object' && !Array.isArray(rec.on)) {
    for (const key of Object.keys(rec.on as Record<string, unknown>)) {
      if (key && key !== '*') into.add(key)
    }
  }
  if (rec.states && typeof rec.states === 'object' && !Array.isArray(rec.states)) {
    for (const child of Object.values(rec.states as Record<string, unknown>)) {
      collectXstateEvents(child, into)
    }
  }
  return [...into]
}

function escapeScriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Full document: official Inspector + actor. Event buttons live in the parent. */
export function buildXstateHostHtml(source: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>xstate</title>
  <style>
    html, body { margin: 0; min-height: 0; background: #101119; }
    #inspector {
      display: block;
      width: 100%;
      height: 640px;
      border: 0;
      pointer-events: auto;
      background: #101119;
    }
    #fail {
      display: none;
      margin: 0;
      padding: 16px 18px;
      color: #e8817c;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    #fail.is-on { display: block; }
  </style>
</head>
<body>
  <iframe id="inspector" title="Stately Inspector"></iframe>
  <p id="fail"></p>
  <script type="module">
const RAW = ${escapeScriptJson(source)};
const fail = document.getElementById('fail');
const iframe = document.getElementById('inspector');

function unwrap(text) {
  let s = String(text || '').trim();
  s = s.replace(/^export\\s+default\\s+/, '');
  s = s.replace(/^(?:const|let|var)\\s+\\w+\\s*=\\s*/, '');
  if (/^createMachine\\s*\\(/.test(s)) {
    s = s.replace(/^createMachine\\s*\\(\\s*/, '').replace(/\\)\\s*;?\\s*$/, '');
  }
  return s.replace(/;+\\s*$/, '').trim();
}

function collect(node, into) {
  if (!node || typeof node !== 'object') return into;
  if (node.on && typeof node.on === 'object') {
    for (const key of Object.keys(node.on)) if (key && key !== '*') into.add(key);
  }
  if (node.states && typeof node.states === 'object') {
    for (const child of Object.values(node.states)) collect(child, into);
  }
  return into;
}

function parseConfig(text) {
  const body = unwrap(text);
  try { return JSON.parse(body); } catch (e) {}
  return (0, eval)('(' + body + ')');
}

function post(msg) {
  try { parent.postMessage(msg, '*'); } catch (e) {}
}

function valueOf(snap) {
  try { return JSON.parse(JSON.stringify(snap.value)); } catch (e) { return snap && snap.value; }
}

try {
  const config = parseConfig(RAW);
  if (!config || typeof config !== 'object') throw new Error('Machine config must be an object');
  const events = [...collect(config, new Set())];
  const { createMachine, createActor } = await import('xstate');
  const { createBrowserInspector } = await import('@statelyai/inspect');
  const inspector = createBrowserInspector({
    iframe,
    url: 'https://stately.ai/registry/inspect'
  });
  const machine = createMachine(config);
  const actor = createActor(machine, { inspect: inspector.inspect });

  function report() {
    const snap = actor.getSnapshot();
    const nextEvents = events.filter((type) => {
      try { return snap.can({ type }); } catch (e) { return true; }
    });
    post({ type: 'vav-xstate-state', value: valueOf(snap), events, nextEvents });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'vav-xstate-ping') { report(); return; }
    if (data.type !== 'vav-xstate-event') return;
    const type = data.event && data.event.type;
    if (!type) return;
    try { actor.send({ type }); } catch (e) {}
    report();
  });

  actor.subscribe(() => report());
  actor.start();
  post({ type: 'vav-xstate-ready', events, value: valueOf(actor.getSnapshot()) });
  report();
  post({ type: 'vav-html-clip', height: 640 });
} catch (err) {
  iframe.remove();
  fail.textContent = (err && err.message) ? err.message : String(err);
  fail.className = 'is-on';
  post({ type: 'vav-xstate-error', message: fail.textContent });
  post({ type: 'vav-html-clip', height: 80 });
}
  </script>
</body>
</html>`
}
