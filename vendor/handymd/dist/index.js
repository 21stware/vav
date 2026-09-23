var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/editor.ts
import { EditorState, Plugin as Plugin8, TextSelection as TextSelection5 } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, redo, undo } from "prosemirror-history";
import { keymap as keymap2 } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";

// src/schema.ts
import { Schema } from "prosemirror-model";
var schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    block: {
      content: "text*",
      parseDOM: [
        { tag: "p" },
        { tag: "div" },
        { tag: "li" },
        { tag: "h1" },
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
        { tag: "blockquote" },
        { tag: "pre" }
      ],
      toDOM: () => ["div", { class: "hm-block" }, 0]
    },
    text: {}
  }
});

// src/markdown.ts
function markdownToDoc(markdown, schema2 = schema) {
  const lines = markdown.replace(/\r\n?/g, `
`).split(`
`);
  const blocks = lines.map((line) => schema2.nodes.block.create(null, line ? schema2.text(line) : undefined));
  return schema2.nodes.doc.create(null, blocks);
}
function docToMarkdown(doc) {
  const lines = [];
  doc.forEach((block) => {
    lines.push(block.textContent);
  });
  return lines.join(`
`);
}

// src/conceal/plugin.ts
import { Plugin, PluginKey } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";

// src/parse/table.ts
function findPipes(line) {
  const pipes = [];
  for (let i = 0;i < line.length; i++) {
    if (line[i] === "|")
      pipes.push({ from: i, to: i + 1 });
  }
  return pipes;
}
function parseTableRow(line) {
  const pipes = findPipes(line);
  let innerStart = 0;
  let innerEnd = line.length;
  const trimmedStart = line.trimStart();
  const leadingWs = line.length - trimmedStart.length;
  if (trimmedStart.startsWith("|")) {
    innerStart = leadingWs + 1;
  }
  const trimmedEnd = line.trimEnd();
  const trailingWs = line.length - trimmedEnd.length;
  if (trimmedEnd.endsWith("|")) {
    innerEnd = line.length - trailingWs - 1;
  }
  const cells = [];
  if (innerStart > innerEnd) {
    return { cells, pipes };
  }
  let start = innerStart;
  for (let i = innerStart;i <= innerEnd; i++) {
    if (i === innerEnd || line[i] === "|") {
      cells.push({ from: start, to: i, text: line.slice(start, i) });
      start = i + 1;
    }
  }
  return { cells, pipes };
}
var SEP_CELL_RE = /^\s*:?-{3,}:?\s*$/;
function isTableSeparator(line) {
  if (!line.includes("|"))
    return false;
  const { cells } = parseTableRow(line);
  if (cells.length < 1)
    return false;
  return cells.every((c) => SEP_CELL_RE.test(c.text));
}
function looksLikeTableRow(line) {
  return line.includes("|") && line.trim().length > 0;
}
function emptyCellText() {
  return "  ";
}
function formatTableRow(cells) {
  return `|${cells.map((c) => c.length ? c : emptyCellText()).join("|")}|`;
}
function formatSeparator(cols, align = []) {
  const parts = [];
  for (let i = 0;i < cols; i++) {
    const a = align[i] ?? "none";
    if (a === "left")
      parts.push(" :--- ");
    else if (a === "right")
      parts.push(" ---: ");
    else if (a === "center")
      parts.push(" :---: ");
    else
      parts.push(" --- ");
  }
  return `|${parts.join("|")}|`;
}

// src/parse/blocks.ts
function lineInfoEqual(a, b) {
  if (a === b)
    return true;
  if (a.t !== b.t)
    return false;
  const ra = a;
  const rb = b;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length)
    return false;
  for (const k of keys) {
    if (ra[k] !== rb[k])
      return false;
  }
  return true;
}
var DIAGRAM_LANGS = new Set(["mermaid"]);
function diagramLangOf(info) {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return DIAGRAM_LANGS.has(lang) ? lang : null;
}
var FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
var HEADING_RE = /^(#{1,6}) /;
var QUOTE_RE = /^ {0,3}> ?/;
var TODO_RE = /^(\s*)([-*+]) \[( |x|X)\] /;
var HR_RE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
var BULLET_RE = /^(\s*)([-*+]) /;
var ORDERED_RE = /^(\s*)(\d{1,9})[.)] /;
function classifyLines(lines) {
  const out = [];
  let fence = null;
  let table = null;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const m2 = line.match(FENCE_RE);
      if (m2 && m2[2][0] === fence.char && m2[2].length >= fence.len && !m2[3].trim()) {
        out.push(fence.diagram ? { t: "diagramClose", tickStart: m2[1].length, tickLen: m2[2].length } : { t: "fenceClose", tickStart: m2[1].length, tickLen: m2[2].length });
        fence = null;
      } else {
        out.push(fence.diagram ? { t: "diagramLine" } : { t: "code" });
      }
      continue;
    }
    if (table?.phase === "sep") {
      out.push({ t: "tableSep", colCount: table.colCount });
      table = { phase: "body", colCount: table.colCount };
      continue;
    }
    if (table?.phase === "body") {
      if (looksLikeTableRow(line) && !isTableSeparator(line)) {
        out.push({ t: "tableRow", colCount: table.colCount });
        continue;
      }
      table = null;
    }
    const open = line.match(FENCE_RE);
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      const info = open[3].trim();
      const lang = diagramLangOf(info);
      fence = { char: open[2][0], len: open[2].length, diagram: lang !== null };
      out.push(lang !== null ? { t: "diagramOpen", tickStart: open[1].length, tickLen: open[2].length, info, lang } : { t: "fenceOpen", tickStart: open[1].length, tickLen: open[2].length, info });
      continue;
    }
    if (looksLikeTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const colCount = Math.max(1, parseTableRow(lines[i + 1]).cells.length);
      out.push({ t: "tableHeader", colCount });
      table = { phase: "sep", colCount };
      continue;
    }
    if (!line.trim()) {
      out.push({ t: "blank" });
      continue;
    }
    let m;
    if (m = line.match(HEADING_RE)) {
      out.push({ t: "heading", level: m[1].length, prefixLen: m[1].length + 1 });
      continue;
    }
    if (m = line.match(TODO_RE)) {
      out.push({
        t: "todo",
        indent: m[1].length,
        checked: m[3] !== " ",
        prefixLen: m[0].length,
        checkOffset: m[1].length + 3
      });
      continue;
    }
    if (m = line.match(HR_RE)) {
      out.push({ t: "hr" });
      continue;
    }
    if (m = line.match(QUOTE_RE)) {
      out.push({ t: "quote", prefixLen: m[0].length });
      continue;
    }
    if (m = line.match(BULLET_RE)) {
      out.push({ t: "bullet", indent: m[1].length, prefixLen: m[0].length });
      continue;
    }
    if (m = line.match(ORDERED_RE)) {
      out.push({
        t: "ordered",
        indent: m[1].length,
        num: Number(m[2]),
        numLen: m[2].length,
        prefixLen: m[0].length
      });
      continue;
    }
    out.push({ t: "para" });
  }
  return out;
}

// src/parse/inline.ts
var CODE_RE = /(?<!`)(`+)([^`\n]+)\1(?!`)/g;
var IMAGE_RE = /!\[([^\[\]\n]*)\]\(([^)\n]*)\)/g;
var LINK_RE = /(?<!!)\[([^\[\]\n]*)\]\(([^)\n]*)\)/g;
var STRONG_RE = /(\*\*|__)(?!\s)([^\n]+?)(?<!\s)\1/g;
var STRIKE_RE = /~~(?!\s)([^~\n]+?)(?<!\s)~~/g;
var MARK_RE = /==(?!\s)([^=\n]+?)(?<!\s)==/g;
var TAG_RE = /(?<=^|[\s(（【"'：:，,、。;；])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;
function parseInline(text) {
  if (!text)
    return [];
  const taken = new Uint8Array(text.length);
  const out = [];
  const isFree = (a, b) => {
    for (let i = a;i < b; i++)
      if (taken[i])
        return false;
    return true;
  };
  const take = (a, b) => {
    for (let i = a;i < b; i++)
      taken[i] = 1;
  };
  const span = (from, to) => ({ from, to });
  for (const m of text.matchAll(CODE_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, to))
      continue;
    const tick = m[1].length;
    out.push({
      kind: "code",
      scope: "inline",
      from,
      to,
      markers: [span(from, from + tick), span(to - tick, to)],
      content: span(from + tick, to - tick)
    });
    take(from, to);
  }
  for (const m of text.matchAll(IMAGE_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, to))
      continue;
    const altStart = from + 2;
    const altEnd = altStart + m[1].length;
    out.push({
      kind: "image",
      scope: "inline",
      from,
      to,
      markers: [span(from, altStart), span(altEnd, to)],
      content: span(altStart, altEnd),
      attrs: { href: m[2], alt: m[1] }
    });
    take(from, to);
  }
  for (const m of text.matchAll(LINK_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, to))
      continue;
    const textStart = from + 1;
    const textEnd = textStart + m[1].length;
    out.push({
      kind: "link",
      scope: "inline",
      from,
      to,
      markers: [span(from, textStart), span(textEnd, to)],
      content: span(textStart, textEnd),
      attrs: { href: m[2] }
    });
    take(from, to);
  }
  for (const m of text.matchAll(STRONG_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    const w = m[1].length;
    if (!isFree(from, from + w) || !isFree(to - w, to))
      continue;
    out.push({
      kind: "strong",
      scope: "inline",
      from,
      to,
      markers: [span(from, from + w), span(to - w, to)],
      content: span(from + w, to - w)
    });
    take(from, from + w);
    take(to - w, to);
  }
  for (const m of text.matchAll(STRIKE_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, from + 2) || !isFree(to - 2, to))
      continue;
    out.push({
      kind: "strike",
      scope: "inline",
      from,
      to,
      markers: [span(from, from + 2), span(to - 2, to)],
      content: span(from + 2, to - 2)
    });
    take(from, from + 2);
    take(to - 2, to);
  }
  for (const m of text.matchAll(MARK_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, from + 2) || !isFree(to - 2, to))
      continue;
    out.push({
      kind: "mark",
      scope: "inline",
      from,
      to,
      markers: [span(from, from + 2), span(to - 2, to)],
      content: span(from + 2, to - 2)
    });
    take(from, from + 2);
    take(to - 2, to);
  }
  parseEmphasis(text, "*", taken, out, take);
  parseEmphasis(text, "_", taken, out, take);
  for (const m of text.matchAll(TAG_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!isFree(from, to))
      continue;
    out.push({
      kind: "tag",
      scope: "inline",
      from,
      to,
      markers: [],
      content: span(from, to),
      static: true
    });
    take(from, to);
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}
function parseEmphasis(text, ch, taken, out, take) {
  const isWord = (c) => !!c && /[A-Za-z0-9]/.test(c);
  let i = 0;
  while (i < text.length) {
    if (taken[i] || text[i] !== ch) {
      i++;
      continue;
    }
    if (text[i + 1] === ch && !taken[i + 1]) {
      i += 2;
      continue;
    }
    const prev = i > 0 ? text[i - 1] : undefined;
    const next = text[i + 1];
    if (prev === ch || next === ch || next === undefined || /\s/.test(next)) {
      i++;
      continue;
    }
    if (ch === "*" && isWord(prev)) {
      i++;
      continue;
    }
    if (ch === "_" && (isWord(prev) || prev === "_")) {
      i++;
      continue;
    }
    let j = i + 1;
    let found = -1;
    while (j < text.length) {
      if (taken[j] || text[j] !== ch) {
        j++;
        continue;
      }
      if (text[j + 1] === ch && !taken[j + 1]) {
        j += 2;
        continue;
      }
      const before = text[j - 1];
      const after = text[j + 1];
      if (before === undefined || /\s/.test(before)) {
        j++;
        continue;
      }
      if (after === ch) {
        j++;
        continue;
      }
      if (ch === "*" && isWord(after)) {
        j++;
        continue;
      }
      if (ch === "_" && (isWord(after) || after === "_")) {
        j++;
        continue;
      }
      if (j > i + 1) {
        found = j;
        break;
      }
      j++;
    }
    if (found < 0) {
      i++;
      continue;
    }
    out.push({
      kind: "em",
      scope: "inline",
      from: i,
      to: found + 1,
      markers: [
        { from: i, to: i + 1 },
        { from: found, to: found + 1 }
      ],
      content: { from: i + 1, to: found }
    });
    take(i, i + 1);
    take(found, found + 1);
    i = found + 1;
  }
}
var cache = new Map;
var CACHE_MAX = 4096;
function parseInlineCached(text) {
  const hit = cache.get(text);
  if (hit)
    return hit;
  const parsed = parseInline(text);
  if (cache.size >= CACHE_MAX)
    cache.clear();
  cache.set(text, parsed);
  return parsed;
}

// src/parse/docparse.ts
function abs(rel, base, hitPad = 1) {
  const shift = (s) => ({ from: s.from + base, to: s.to + base });
  return {
    ...rel,
    from: rel.from + base,
    to: rel.to + base,
    hitFrom: rel.static ? rel.from + base : rel.from + base - hitPad,
    hitTo: rel.static ? rel.to + base : rel.to + base + hitPad,
    markers: rel.markers.map(shift),
    content: rel.content ? shift(rel.content) : undefined
  };
}
function mapSpan(s, mapping) {
  const fromR = mapping.mapResult(s.from, 1);
  const toR = mapping.mapResult(s.to, -1);
  if (fromR.deleted || toR.deleted)
    return null;
  if (fromR.pos > toR.pos)
    return null;
  return { from: fromR.pos, to: toR.pos };
}
function mapElement(el, mapping) {
  const fromR = mapping.mapResult(el.from, 1);
  const toR = mapping.mapResult(el.to, -1);
  if (fromR.deleted || toR.deleted)
    return null;
  if (fromR.pos > toR.pos)
    return null;
  const markers = [];
  for (const m of el.markers) {
    const mm = mapSpan(m, mapping);
    if (!mm)
      return null;
    markers.push(mm);
  }
  let content;
  if (el.content) {
    const c = mapSpan(el.content, mapping);
    if (!c)
      return null;
    content = c;
  }
  let attrs = el.attrs;
  if (attrs?.checkPos !== undefined) {
    const cp = mapping.mapResult(attrs.checkPos, 1);
    if (cp.deleted)
      return null;
    attrs = { ...attrs, checkPos: cp.pos };
  }
  let hitFrom;
  let hitTo;
  if (el.static) {
    hitFrom = fromR.pos;
    hitTo = toR.pos;
  } else if (el.scope === "inline") {
    hitFrom = fromR.pos - 1;
    hitTo = toR.pos + 1;
  } else {
    const hitFromR = mapping.mapResult(el.hitFrom, 1);
    const hitToR = mapping.mapResult(el.hitTo, -1);
    if (hitFromR.deleted || hitToR.deleted)
      return null;
    hitFrom = hitFromR.pos;
    hitTo = hitToR.pos;
  }
  return {
    ...el,
    from: fromR.pos,
    to: toR.pos,
    hitFrom,
    hitTo,
    markers,
    content,
    attrs
  };
}
function mapElements(els, mapping) {
  const out = [];
  for (const el of els) {
    const m = mapElement(el, mapping);
    if (!m)
      return null;
    out.push(m);
  }
  return out;
}
function collectLines(doc) {
  const texts = [];
  const positions = [];
  doc.forEach((node, offset) => {
    texts.push(node.textContent);
    positions.push({ pos: offset, size: node.nodeSize });
  });
  return { texts, positions };
}
function buildRegions(lines, texts, positions) {
  const fenceRegion = new Map;
  const diagramCode = new Map;
  for (let i = 0;i < lines.length; i++) {
    const t = lines[i].t;
    if (t !== "fenceOpen" && t !== "diagramOpen")
      continue;
    const bodyT = t === "fenceOpen" ? "code" : "diagramLine";
    const closeT = t === "fenceOpen" ? "fenceClose" : "diagramClose";
    let j = i + 1;
    while (j < lines.length && lines[j].t === bodyT)
      j++;
    const last = j < lines.length && lines[j].t === closeT ? j : j - 1;
    const region = {
      from: positions[i].pos,
      to: positions[last].pos + positions[last].size
    };
    for (let k = i;k <= last; k++)
      fenceRegion.set(k, region);
    if (t === "diagramOpen")
      diagramCode.set(i, texts.slice(i + 1, j).join(`
`));
  }
  const tableEdge = new Map;
  for (let i = 0;i < lines.length; i++) {
    if (lines[i].t !== "tableHeader")
      continue;
    let j = i + 1;
    while (j < lines.length && (lines[j].t === "tableSep" || lines[j].t === "tableRow"))
      j++;
    const last = j - 1;
    if (last === i)
      tableEdge.set(i, "only");
    else {
      tableEdge.set(i, "first");
      tableEdge.set(last, "last");
    }
  }
  return { fenceRegion, diagramCode, tableEdge };
}
function buildLineElements(i, text, pos, size, li, regions) {
  const start = pos + 1;
  const blockHit = { hitFrom: pos, hitTo: pos + size };
  const els = [];
  const { fenceRegion, diagramCode, tableEdge } = regions;
  const inline = (offset) => {
    const sub = text.slice(offset);
    if (!sub)
      return;
    for (const rel of parseInlineCached(sub))
      els.push(abs(rel, start + offset));
  };
  switch (li.t) {
    case "heading":
      els.push({
        kind: "heading",
        scope: "block",
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start, to: start + li.prefixLen }],
        content: { from: start + li.prefixLen, to: start + text.length },
        attrs: { level: li.level }
      });
      inline(li.prefixLen);
      break;
    case "quote":
      els.push({
        kind: "quote",
        scope: "block",
        permanent: true,
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start, to: start + li.prefixLen }],
        content: { from: start + li.prefixLen, to: start + text.length }
      });
      inline(li.prefixLen);
      break;
    case "todo":
      els.push({
        kind: "todo",
        scope: "block",
        permanent: true,
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start + li.indent, to: start + li.prefixLen }],
        content: { from: start + li.prefixLen, to: start + text.length },
        attrs: {
          checked: li.checked,
          checkPos: start + li.checkOffset,
          indent: li.indent
        }
      });
      inline(li.prefixLen);
      break;
    case "bullet":
      els.push({
        kind: "bullet",
        scope: "block",
        permanent: true,
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start + li.indent, to: start + li.prefixLen }],
        content: { from: start + li.prefixLen, to: start + text.length },
        attrs: { indent: li.indent }
      });
      inline(li.prefixLen);
      break;
    case "ordered":
      els.push({
        kind: "ordered",
        scope: "block",
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start + li.indent, to: start + li.prefixLen }],
        content: { from: start + li.prefixLen, to: start + text.length },
        attrs: { indent: li.indent, num: li.num },
        static: true
      });
      inline(li.prefixLen);
      break;
    case "hr":
      els.push({
        kind: "hr",
        scope: "block",
        permanent: true,
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [{ from: start, to: start + text.length }]
      });
      break;
    case "fenceOpen": {
      const region = fenceRegion.get(i);
      els.push({
        kind: "fenceOpen",
        scope: "block",
        from: pos,
        to: pos + size,
        hitFrom: region.from,
        hitTo: region.to,
        markers: [{ from: start, to: start + text.length }],
        attrs: { info: li.info }
      });
      break;
    }
    case "fenceClose": {
      const region = fenceRegion.get(i) ?? { from: pos, to: pos + size };
      els.push({
        kind: "fenceClose",
        scope: "block",
        from: pos,
        to: pos + size,
        hitFrom: region.from,
        hitTo: region.to,
        markers: [{ from: start, to: start + text.length }]
      });
      break;
    }
    case "code":
      els.push({
        kind: "codeLine",
        scope: "block",
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: [],
        static: true
      });
      break;
    case "diagramOpen": {
      const region = fenceRegion.get(i);
      els.push({
        kind: "diagramOpen",
        scope: "block",
        from: pos,
        to: pos + size,
        hitFrom: region.from,
        hitTo: region.to,
        markers: [{ from: start, to: start + text.length }],
        attrs: { info: li.info, lang: li.lang, code: diagramCode.get(i) ?? "" }
      });
      break;
    }
    case "diagramLine": {
      const region = fenceRegion.get(i) ?? { from: pos, to: pos + size };
      els.push({
        kind: "diagramLine",
        scope: "block",
        from: pos,
        to: pos + size,
        hitFrom: region.from,
        hitTo: region.to,
        markers: [{ from: start, to: start + text.length }]
      });
      break;
    }
    case "diagramClose": {
      const region = fenceRegion.get(i) ?? { from: pos, to: pos + size };
      els.push({
        kind: "diagramClose",
        scope: "block",
        from: pos,
        to: pos + size,
        hitFrom: region.from,
        hitTo: region.to,
        markers: [{ from: start, to: start + text.length }]
      });
      break;
    }
    case "tableHeader":
    case "tableRow":
    case "tableSep": {
      const colCount = li.colCount;
      const edge = tableEdge.get(i);
      const parsed = parseTableRow(text);
      const kind = li.t;
      els.push({
        kind,
        scope: "block",
        permanent: kind === "tableSep",
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: kind === "tableSep" ? [{ from: start, to: start + text.length }] : parsed.pipes.map((p) => ({ from: start + p.from, to: start + p.to })),
        attrs: { colCount, tableEdge: edge }
      });
      if (kind !== "tableSep") {
        for (let c = 0;c < parsed.cells.length; c++) {
          const cell = parsed.cells[c];
          const cFrom = start + cell.from;
          const cTo = start + cell.to;
          els.push({
            kind: "tableCell",
            scope: "inline",
            from: cFrom,
            to: cTo,
            hitFrom: cFrom,
            hitTo: cTo,
            markers: [],
            content: { from: cFrom, to: cTo },
            attrs: { col: c, colCount },
            static: true
          });
          if (cell.text) {
            for (const rel of parseInlineCached(cell.text)) {
              els.push(abs(rel, cFrom));
            }
          }
        }
      }
      break;
    }
    case "para":
      inline(0);
      break;
    case "blank":
      break;
  }
  return els;
}
var REGION_HIT_KINDS = new Set([
  "fenceOpen",
  "fenceClose",
  "diagramOpen",
  "diagramClose",
  "diagramLine"
]);
function clampMappedBlockBounds(els, pos, size, region) {
  const end = pos + size;
  return els.map((el) => {
    if (el.scope !== "block")
      return el;
    if (REGION_HIT_KINDS.has(el.kind) && region) {
      return { ...el, from: pos, to: end, hitFrom: region.from, hitTo: region.to };
    }
    return { ...el, from: pos, to: end, hitFrom: pos, hitTo: end };
  });
}
function lineStructureEqual(old, text, li, edge, diagramCode) {
  if (old.text !== text)
    return false;
  if (!lineInfoEqual(old.line, li))
    return false;
  const oldEdge = old.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs?.tableEdge;
  if (oldEdge !== edge)
    return false;
  const oldCode = old.elements.find((e) => e.kind === "diagramOpen")?.attrs?.code;
  if ((oldCode ?? "") !== (diagramCode ?? ""))
    return false;
  return true;
}
function parseDoc(doc) {
  const { texts, positions } = collectLines(doc);
  const lines = classifyLines(texts);
  const regions = buildRegions(lines, texts, positions);
  const blocks = [];
  for (let i = 0;i < texts.length; i++) {
    const { pos, size } = positions[i];
    const text = texts[i];
    const li = lines[i];
    blocks.push({
      pos,
      size,
      text,
      line: li,
      elements: buildLineElements(i, text, pos, size, li, regions)
    });
  }
  return blocks;
}
function parseDocIncremental(doc, prevBlocks, mapping) {
  const { texts, positions } = collectLines(doc);
  const lines = classifyLines(texts);
  const regions = buildRegions(lines, texts, positions);
  const newToOld = new Array(texts.length).fill(null);
  for (let j = 0;j < prevBlocks.length; j++) {
    const mapped = mapping.mapResult(prevBlocks[j].pos, 1);
    if (mapped.deleted)
      continue;
    let lo = 0;
    let hi = positions.length - 1;
    let i = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      const p = positions[mid].pos;
      if (p === mapped.pos) {
        i = mid;
        break;
      }
      if (p < mapped.pos)
        lo = mid + 1;
      else
        hi = mid - 1;
    }
    if (i < 0)
      continue;
    if (newToOld[i] !== null) {
      return parseDoc(doc);
    }
    newToOld[i] = j;
  }
  const blocks = [];
  for (let i = 0;i < texts.length; i++) {
    const { pos, size } = positions[i];
    const text = texts[i];
    const li = lines[i];
    const edge = regions.tableEdge.get(i);
    const dcode = regions.diagramCode.get(i);
    const j = newToOld[i];
    if (j !== null) {
      const old = prevBlocks[j];
      if (lineStructureEqual(old, text, li, edge, dcode)) {
        const mappedEls = mapElements(old.elements, mapping);
        if (mappedEls) {
          blocks.push({
            pos,
            size,
            text,
            line: li,
            elements: clampMappedBlockBounds(mappedEls, pos, size, regions.fenceRegion.get(i))
          });
          continue;
        }
      }
    }
    blocks.push({
      pos,
      size,
      text,
      line: li,
      elements: buildLineElements(i, text, pos, size, li, regions)
    });
  }
  return blocks;
}

// src/elements.ts
function spansIntersect(aFrom, aTo, bFrom, bTo) {
  return aFrom <= bTo && aTo >= bFrom;
}

// src/conceal/hittest.ts
function isRevealed(el, sel, readOnly) {
  if (el.static || el.permanent)
    return false;
  if (readOnly)
    return false;
  return spansIntersect(sel.from, sel.to, el.hitFrom, el.hitTo);
}
function revealSignature(revealed) {
  let sig = "";
  for (const r of revealed)
    sig += r ? "1" : "0";
  return sig;
}

// src/conceal/decorations.ts
import { Decoration } from "prosemirror-view";

// src/conceal/tableview.ts
function equalStyle(a, b) {
  if (a === b)
    return true;
  if (!a || !b)
    return false;
  return a.kind === b.kind && a.href === b.href;
}
function renderCellPreview(raw) {
  const frag = document.createDocumentFragment();
  let text = raw;
  if (text.startsWith(" "))
    text = text.slice(1);
  if (text.endsWith(" "))
    text = text.slice(0, -1);
  if (!text) {
    frag.appendChild(document.createTextNode(" "));
    return frag;
  }
  const els = parseInlineCached(text);
  const hide = new Array(text.length).fill(false);
  for (const e of els) {
    for (const m of e.markers) {
      for (let i2 = m.from;i2 < m.to && i2 < text.length; i2++)
        hide[i2] = true;
    }
  }
  const styleAt = new Array(text.length).fill(null);
  for (const e of els) {
    if (!e.content)
      continue;
    if (!["link", "strong", "em", "code", "strike", "mark", "tag"].includes(e.kind))
      continue;
    for (let i2 = e.content.from;i2 < e.content.to && i2 < text.length; i2++) {
      styleAt[i2] = { kind: e.kind, href: e.attrs?.href };
    }
  }
  let i = 0;
  while (i < text.length) {
    if (hide[i]) {
      i++;
      continue;
    }
    const st = styleAt[i];
    let j = i + 1;
    while (j < text.length && !hide[j] && equalStyle(styleAt[j], st))
      j++;
    const slice = text.slice(i, j);
    if (st) {
      const span = document.createElement("span");
      span.className = st.kind === "link" ? "hm-link" : st.kind === "tag" ? "hm-tag" : `hm-${st.kind}`;
      if (st.href)
        span.setAttribute("data-href", st.href);
      span.textContent = slice;
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(slice));
    }
    i = j;
  }
  if (!frag.childNodes.length)
    frag.appendChild(document.createTextNode(" "));
  return frag;
}
function buildTableRowVisual(block, kind) {
  const row = document.createElement("div");
  row.className = "hm-table-visual" + (kind === "tableHeader" ? " hm-table-visual-header" : "");
  row.contentEditable = "false";
  row.setAttribute("aria-hidden", "true");
  const parsed = parseTableRow(block.text);
  const colCount = block.line.t === "tableHeader" || block.line.t === "tableRow" ? block.line.colCount : Math.max(1, parsed.cells.length);
  for (let c = 0;c < colCount; c++) {
    const td = document.createElement("div");
    td.className = "hm-table-cell";
    td.setAttribute("data-col", String(c));
    td.appendChild(renderCellPreview(parsed.cells[c]?.text ?? ""));
    row.appendChild(td);
  }
  return row;
}

// src/conceal/decorations.ts
function spec(el, role, concealed, extra) {
  return { hm: true, kind: el.kind, role, concealed, ...extra };
}
function markerDecos(el, revealed, out) {
  const cls = revealed ? "hm-marker" : "hm-marker hm-concealed";
  for (const m of el.markers) {
    if (m.from >= m.to)
      continue;
    out.push(Decoration.inline(m.from, m.to, { class: cls }, spec(el, "marker", !revealed)));
  }
}
function concealMarkersWithCaretPad(el, out) {
  for (const m of el.markers) {
    if (m.from >= m.to)
      continue;
    if (m.to - m.from >= 2) {
      out.push(Decoration.inline(m.from, m.to - 1, { class: "hm-marker hm-concealed" }, spec(el, "marker", true)));
      out.push(Decoration.inline(m.to - 1, m.to, { class: "hm-marker hm-caret-pad" }, spec(el, "marker", true, { caretPad: true })));
    } else {
      out.push(Decoration.inline(m.from, m.to, { class: "hm-marker hm-concealed" }, spec(el, "marker", true)));
    }
  }
}
function contentDeco(el, revealed, cls, out, attrs) {
  const c = el.content;
  if (!c || c.from >= c.to)
    return;
  out.push(Decoration.inline(c.from, c.to, { class: cls, ...attrs }, spec(el, "content", !revealed)));
}
function nodeDeco(block, el, revealed, cls, out, attrs) {
  out.push(Decoration.node(block.pos, block.pos + block.size, { class: cls, ...attrs }, spec(el, "node", !revealed)));
}
function decorateListIndent(block, el, out) {
  const spaces = el.attrs?.indent ?? 0;
  if (spaces <= 0)
    return;
  const from = block.pos + 1;
  const to = from + spaces;
  if (to <= from)
    return;
  const level = spaces / 2;
  out.push(Decoration.inline(from, to, { class: "hm-list-indent", style: `width: ${level * 1.35}rem` }, spec(el, "marker", true, { indentPad: true })));
}
function listWidgetKey(kind, block, el, extra = "") {
  const indent = el.attrs?.indent ?? 0;
  const rest = block.text.slice(indent);
  return extra ? `${kind}:${extra}:${rest}` : `${kind}:${rest}`;
}
function widget(el, pos, key, toDOM, out, side = 0) {
  out.push(Decoration.widget(pos, toDOM, {
    key,
    side,
    ignoreSelection: true,
    ...spec(el, "widget", true)
  }));
}
function concealSpan(el, s, out) {
  if (s.from >= s.to)
    return;
  out.push(Decoration.inline(s.from, s.to, { class: "hm-marker hm-concealed" }, spec(el, "marker", true)));
}
function fenceOpenDecos(block, el, rev, out) {
  nodeDeco(block, el, rev, "hm-fence-line hm-fence-open", out);
  markerDecos(el, rev, out);
  const info = el.attrs?.info;
  if (!rev && info) {
    widget(el, el.markers[0].from, `lang:${info}`, () => {
      const badge = document.createElement("span");
      badge.className = "hm-code-lang";
      badge.textContent = info;
      return badge;
    }, out, -1);
  }
}
function fenceCloseDecos(block, el, rev, out) {
  nodeDeco(block, el, rev, "hm-fence-line hm-fence-close", out);
  markerDecos(el, rev, out);
}
function buildBlockDecos(block, revealed, ctx) {
  const out = [];
  block.elements.forEach((el, i) => {
    const rev = revealed[i];
    switch (el.kind) {
      case "strong":
        contentDeco(el, rev, "hm-strong", out);
        markerDecos(el, rev, out);
        break;
      case "em":
        contentDeco(el, rev, "hm-em", out);
        markerDecos(el, rev, out);
        break;
      case "strike":
        contentDeco(el, rev, "hm-strike", out);
        markerDecos(el, rev, out);
        break;
      case "mark":
        contentDeco(el, rev, "hm-mark", out);
        markerDecos(el, rev, out);
        break;
      case "code":
        contentDeco(el, rev, "hm-code", out);
        markerDecos(el, rev, out);
        break;
      case "link":
        contentDeco(el, rev, "hm-link", out, el.attrs?.href ? { "data-href": el.attrs.href } : undefined);
        markerDecos(el, rev, out);
        break;
      case "image":
        if (rev) {
          contentDeco(el, rev, "hm-image-alt", out);
          markerDecos(el, rev, out);
        } else {
          concealSpan(el, { from: el.from, to: el.to }, out);
          const href = el.attrs?.href ?? "";
          const alt = el.attrs?.alt ?? "";
          widget(el, el.from, `img:${href}\x00${alt}`, () => {
            const img = document.createElement("img");
            img.className = "hm-image";
            img.src = href;
            img.alt = alt;
            return img;
          }, out, -1);
        }
        break;
      case "tag":
        contentDeco(el, false, "hm-tag", out);
        break;
      case "heading": {
        const level = el.attrs?.level ?? 1;
        const empty = !el.content || el.content.from >= el.content.to;
        nodeDeco(block, el, rev, `hm-heading hm-h${level}${empty ? " hm-heading-empty" : ""}`, out);
        if (empty)
          concealMarkersWithCaretPad(el, out);
        else
          markerDecos(el, false, out);
        if (rev) {
          const at = el.markers[0].to;
          widget(el, at, `hb:${level}`, () => {
            const badge = document.createElement("span");
            badge.className = "hm-heading-badge";
            badge.setAttribute("aria-hidden", "true");
            badge.innerHTML = `<svg viewBox="0 0 18 18" width="18" height="18">` + `<rect x="1" y="3" width="16" height="2.4" rx="1.2" fill="currentColor"/>` + `<rect x="1" y="8" width="7" height="2.4" rx="1.2" fill="currentColor"/>` + `<rect x="1" y="13" width="7" height="2.4" rx="1.2" fill="currentColor"/>` + `<text x="11" y="16" font-size="9.5" font-weight="700" fill="currentColor">${level}</text>` + `</svg>`;
            return badge;
          }, out, -1);
        }
        break;
      }
      case "quote":
        nodeDeco(block, el, rev, "hm-quote", out);
        concealMarkersWithCaretPad(el, out);
        break;
      case "todo": {
        const checked = el.attrs?.checked ?? false;
        nodeDeco(block, el, rev, checked ? "hm-todo hm-todo-checked" : "hm-todo", out);
        decorateListIndent(block, el, out);
        concealMarkersWithCaretPad(el, out);
        if (!rev) {
          const at = el.markers[0].from;
          widget(el, at, listWidgetKey("chk", block, el, checked ? "1" : "0"), () => {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.className = "hm-checkbox";
            input.checked = checked;
            input.tabIndex = -1;
            return input;
          }, out, -1);
        }
        break;
      }
      case "bullet":
        nodeDeco(block, el, rev, "hm-bullet", out);
        decorateListIndent(block, el, out);
        concealMarkersWithCaretPad(el, out);
        if (!rev) {
          const at = el.markers[0].from;
          widget(el, at, listWidgetKey("dot", block, el), () => {
            const dot = document.createElement("span");
            dot.className = "hm-bullet-dot";
            dot.textContent = "•";
            return dot;
          }, out, -1);
        }
        break;
      case "ordered": {
        nodeDeco(block, el, false, "hm-ordered", out);
        decorateListIndent(block, el, out);
        const m = el.markers[0];
        if (m && m.from < m.to) {
          out.push(Decoration.inline(m.from, m.to, { class: "hm-list-num" }, spec(el, "marker", false)));
        }
        break;
      }
      case "hr":
        nodeDeco(block, el, rev, "hm-hr-line", out);
        if (rev) {
          markerDecos(el, rev, out);
        } else {
          markerDecos(el, rev, out);
          widget(el, el.markers[0].from, `hr:${block.text}`, () => {
            const hr = document.createElement("hr");
            hr.className = "hm-hr";
            return hr;
          }, out, -1);
        }
        break;
      case "fenceOpen":
        fenceOpenDecos(block, el, rev, out);
        break;
      case "fenceClose":
        fenceCloseDecos(block, el, rev, out);
        break;
      case "codeLine":
        nodeDeco(block, el, false, "hm-code-line", out);
        break;
      case "diagramOpen": {
        if (!ctx?.renderDiagram) {
          fenceOpenDecos(block, el, rev, out);
          break;
        }
        if (rev) {
          fenceOpenDecos(block, el, true, out);
          break;
        }
        nodeDeco(block, el, false, "hm-diagram-host", out);
        concealSpan(el, el.markers[0], out);
        const code = el.attrs?.code ?? "";
        const lang = el.attrs?.lang ?? "";
        const renderDiagram = ctx.renderDiagram;
        widget(el, el.markers[0].from, `dg:${lang}\x00${code}`, () => {
          const container = document.createElement("div");
          container.className = "hm-diagram";
          container.setAttribute("data-lang", lang);
          if (!code.trim()) {
            container.classList.add("hm-diagram-empty");
            container.textContent = lang;
          } else {
            renderDiagram(container, code, lang);
          }
          return container;
        }, out, -1);
        break;
      }
      case "diagramLine":
        if (!ctx?.renderDiagram) {
          nodeDeco(block, el, false, "hm-code-line", out);
        } else if (rev) {
          nodeDeco(block, el, true, "hm-code-line", out);
        } else {
          nodeDeco(block, el, false, "hm-diagram-hidden", out);
          concealSpan(el, el.markers[0], out);
        }
        break;
      case "diagramClose":
        if (!ctx?.renderDiagram || rev) {
          fenceCloseDecos(block, el, rev, out);
        } else {
          nodeDeco(block, el, false, "hm-diagram-hidden", out);
          concealSpan(el, el.markers[0], out);
        }
        break;
      case "tableHeader":
      case "tableRow": {
        const edge = el.attrs?.tableEdge;
        const edgeCls = edge === "first" ? " hm-table-first" : edge === "last" ? " hm-table-last" : edge === "only" ? " hm-table-only" : "";
        const roleCls = el.kind === "tableHeader" ? "hm-table-header" : "hm-table-row";
        if (rev) {
          nodeDeco(block, el, true, `hm-table hm-table-source ${roleCls}${edgeCls}`, out);
          markerDecos(el, true, out);
        } else {
          nodeDeco(block, el, false, `hm-table hm-table-rendered ${roleCls}${edgeCls}`, out);
          const lineFrom = block.pos + 1;
          const lineTo = block.pos + 1 + block.text.length;
          concealSpan(el, { from: lineFrom, to: lineTo }, out);
          widget(el, lineFrom, `tr:${el.kind}\x00${block.text}`, () => buildTableRowVisual(block, el.kind), out, -1);
        }
        break;
      }
      case "tableSep":
        nodeDeco(block, el, rev, "hm-table hm-table-sep", out);
        markerDecos(el, false, out);
        break;
      case "tableCell":
        break;
    }
  });
  return out;
}

// src/conceal/plugin.ts
var concealKey = new PluginKey("handymd-conceal");
function computeAll(doc, sel, readOnly, composing, ctx) {
  const blocks = parseDoc(doc);
  const sigs = [];
  const all = [];
  for (const block of blocks) {
    const revealed = block.elements.map((el) => isRevealed(el, sel, readOnly));
    sigs.push(revealSignature(revealed));
    for (const d of buildBlockDecos(block, revealed, ctx))
      all.push(d);
  }
  return {
    set: DecorationSet.create(doc, all),
    blocks,
    sigs,
    composing,
    stale: false,
    readOnly
  };
}
function contentReusable(a, b) {
  if (a.text !== b.text)
    return false;
  if (!lineInfoEqual(a.line, b.line))
    return false;
  const edgeA = a.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs?.tableEdge;
  const edgeB = b.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs?.tableEdge;
  if (edgeA !== edgeB)
    return false;
  const codeA = a.elements.find((e) => e.kind === "diagramOpen")?.attrs?.code;
  const codeB = b.elements.find((e) => e.kind === "diagramOpen")?.attrs?.code;
  if (codeA !== codeB)
    return false;
  return true;
}
function findBlockAt(blocks, pos) {
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const b = blocks[mid];
    if (b.pos === pos)
      return mid;
    if (b.pos < pos)
      lo = mid + 1;
    else
      hi = mid - 1;
  }
  return -1;
}
function patchBlocks(set, doc, dirty, ctx) {
  if (dirty.length === 0)
    return set;
  const remove = [];
  const add = [];
  for (const { block, revealed } of dirty) {
    const end = block.pos + block.size;
    for (const d of set.find(block.pos, end)) {
      if (d.to > block.pos && d.from < end)
        remove.push(d);
    }
    for (const d of buildBlockDecos(block, revealed, ctx))
      add.push(d);
  }
  return set.remove(remove).add(doc, add);
}
function computeAfterDocChange(tr, prev, nextDoc, sel, readOnly, composing, ctx) {
  const newBlocks = parseDocIncremental(nextDoc, prev.blocks, tr.mapping);
  const newToOld = new Array(newBlocks.length).fill(null);
  for (let j = 0;j < prev.blocks.length; j++) {
    const mapped = tr.mapping.mapResult(prev.blocks[j].pos, 1);
    if (mapped.deleted)
      continue;
    const i = findBlockAt(newBlocks, mapped.pos);
    if (i < 0)
      continue;
    if (newToOld[i] !== null) {
      return computeAll(nextDoc, sel, readOnly, composing, ctx);
    }
    newToOld[i] = j;
  }
  const sigs = new Array(newBlocks.length);
  const dirty = [];
  const mappedSet = prev.set.map(tr.mapping, nextDoc);
  for (let i = 0;i < newBlocks.length; i++) {
    const block = newBlocks[i];
    const revealed = block.elements.map((el) => isRevealed(el, sel, readOnly));
    const sig = revealSignature(revealed);
    sigs[i] = sig;
    const j = newToOld[i];
    if (j !== null && prev.sigs[j] === sig && contentReusable(prev.blocks[j], block)) {
      if (blockNeedsNodeDeco(block) && !hasExactNodeDeco(mappedSet, block)) {
        dirty.push({ block, revealed });
      }
      continue;
    }
    dirty.push({ block, revealed });
  }
  return {
    blocks: newBlocks,
    sigs,
    set: patchBlocks(mappedSet, nextDoc, dirty, ctx),
    composing,
    stale: false,
    readOnly
  };
}
function blockNeedsNodeDeco(block) {
  return block.elements.some((el) => el.scope === "block");
}
function hasExactNodeDeco(set, block) {
  const end = block.pos + block.size;
  for (const d of set.find(block.pos, end)) {
    if (d.spec?.role === "node" && d.from === block.pos && d.to === end) {
      return true;
    }
  }
  return false;
}
function selTouchesBlock(block, sel) {
  if (spansIntersect(sel.from, sel.to, block.pos, block.pos + block.size))
    return true;
  for (const el of block.elements) {
    if (spansIntersect(sel.from, sel.to, el.hitFrom, el.hitTo))
      return true;
  }
  return false;
}
function sigHasReveal(sig) {
  return sig.includes("1");
}
function computeAfterSelectionWithDoc(prev, doc, oldSel, newSel, readOnly, ctx) {
  const dirty = [];
  let sigs = null;
  for (let i = 0;i < prev.blocks.length; i++) {
    const block = prev.blocks[i];
    if (!selTouchesBlock(block, oldSel) && !selTouchesBlock(block, newSel) && !sigHasReveal(prev.sigs[i])) {
      continue;
    }
    const revealed = block.elements.map((el) => isRevealed(el, newSel, readOnly));
    const sig = revealSignature(revealed);
    if (sig === prev.sigs[i])
      continue;
    if (!sigs)
      sigs = prev.sigs.slice();
    sigs[i] = sig;
    dirty.push({ block, revealed });
  }
  if (!sigs)
    return prev;
  return {
    ...prev,
    sigs,
    set: patchBlocks(prev.set, doc, dirty, ctx)
  };
}
function concealPlugin(options = {}) {
  const ctx = { renderDiagram: options.renderDiagram };
  return new Plugin({
    key: concealKey,
    state: {
      init: (_config, state) => computeAll(state.doc, state.selection, options.readOnly ?? false, false, ctx),
      apply: (tr, prev, old, next) => {
        let { composing, readOnly } = prev;
        let refresh = false;
        const meta = tr.getMeta(concealKey);
        if (meta) {
          if (meta.composing !== undefined && meta.composing !== composing) {
            composing = meta.composing;
            if (!composing)
              refresh = true;
          }
          if (meta.readOnly !== undefined && meta.readOnly !== readOnly) {
            readOnly = meta.readOnly;
            refresh = true;
          }
          if (meta.refresh)
            refresh = true;
        }
        if (composing) {
          return {
            ...prev,
            composing,
            readOnly,
            stale: prev.stale || tr.docChanged,
            set: tr.docChanged ? prev.set.map(tr.mapping, tr.doc) : prev.set
          };
        }
        if (refresh || prev.stale) {
          return computeAll(next.doc, next.selection, readOnly, composing, ctx);
        }
        if (tr.docChanged) {
          return computeAfterDocChange(tr, prev, next.doc, next.selection, readOnly, composing, ctx);
        }
        if (!next.selection.eq(old.selection)) {
          return computeAfterSelectionWithDoc(prev, next.doc, old.selection, next.selection, readOnly, ctx);
        }
        return prev;
      }
    },
    props: {
      decorations(state) {
        return concealKey.getState(state)?.set;
      }
    }
  });
}
function setConcealMeta(tr, meta) {
  return tr.setMeta(concealKey, meta);
}

// src/ime.ts
import { Plugin as Plugin2 } from "prosemirror-state";
var THAW_RETRY_MS = 25;
var THAW_RETRIES = 8;
function scheduleForceEndComposition(view) {
  setTimeout(() => {
    if (view.isDestroyed || !view.composing)
      return;
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const input = view.input;
    if (input && typeof input.compositionEndedAt === "number") {
      input.compositionEndedAt = -200000000;
    }
  }, 0);
}
function frozen(view) {
  return concealKey.getState(view.state)?.composing === true;
}
function thaw(view) {
  const meta = { composing: false, refresh: true };
  view.dispatch(view.state.tr.setMeta(concealKey, meta));
}
function scheduleThaw(view, attempt = 0) {
  setTimeout(() => {
    if (view.isDestroyed)
      return;
    if (view.composing) {
      if (attempt < THAW_RETRIES)
        scheduleThaw(view, attempt + 1);
      return;
    }
    if (frozen(view))
      thaw(view);
  }, attempt === 0 ? 0 : THAW_RETRY_MS);
}
function imePlugin() {
  return new Plugin2({
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          const meta = { composing: true };
          view.dispatch(view.state.tr.setMeta(concealKey, meta));
          return false;
        },
        compositionend(view) {
          scheduleThaw(view);
          return false;
        },
        keydown(view) {
          if (!view.composing && frozen(view))
            thaw(view);
          return false;
        },
        beforeinput(view, event) {
          const it = event.inputType;
          if (view.composing && (it === "insertText" || it === "insertReplacementText")) {
            scheduleForceEndComposition(view);
          }
          return false;
        },
        input(view, event) {
          const it = event.inputType;
          if (view.composing && (it === "insertText" || it === "insertReplacementText")) {
            scheduleForceEndComposition(view);
          }
          return false;
        }
      }
    }
  });
}

// src/interactions.ts
import { Plugin as Plugin3, TextSelection } from "prosemirror-state";
function findLinkAt(st, pos) {
  for (const block of st.blocks) {
    if (pos < block.pos || pos > block.pos + block.size)
      continue;
    for (const el of block.elements) {
      if (el.kind === "link" && pos >= el.from && pos <= el.to)
        return el;
    }
  }
  return null;
}
function enterDiagramAt(view, dom) {
  const st = concealKey.getState(view.state);
  if (!st || st.readOnly)
    return false;
  let pos;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return false;
  }
  for (const block of st.blocks) {
    if (pos < block.pos || pos > block.pos + block.size)
      continue;
    if (block.line.t !== "diagramOpen")
      return false;
    const end = block.pos + 1 + block.text.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    view.focus();
    return true;
  }
  return false;
}
function enterTableRowAt(view, dom) {
  const st = concealKey.getState(view.state);
  if (!st || st.readOnly)
    return false;
  let pos;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return false;
  }
  for (const block of st.blocks) {
    if (pos < block.pos || pos > block.pos + block.size)
      continue;
    if (block.line.t !== "tableHeader" && block.line.t !== "tableRow")
      return false;
    const cell = block.elements.find((e) => e.kind === "tableCell");
    let caret = cell ? cell.from : block.pos + 1;
    if (cell && block.text[cell.from - (block.pos + 1)] === " ")
      caret = Math.min(cell.to, cell.from + 1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)));
    view.focus();
    return true;
  }
  return false;
}
function toggleTodoAt(view, dom) {
  const st = concealKey.getState(view.state);
  if (!st)
    return false;
  let pos;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return false;
  }
  for (const block of st.blocks) {
    if (pos < block.pos || pos > block.pos + block.size)
      continue;
    for (const el of block.elements) {
      if (el.kind !== "todo" || el.attrs?.checkPos === undefined)
        continue;
      const checkPos = el.attrs.checkPos;
      const current = view.state.doc.textBetween(checkPos, checkPos + 1);
      if (current !== " " && current.toLowerCase() !== "x")
        return false;
      const next = current === " " ? "x" : " ";
      view.dispatch(view.state.tr.insertText(next, checkPos, checkPos + 1));
      return true;
    }
  }
  return false;
}
function interactionsPlugin(options = {}) {
  const openLink = options.onOpenLink ?? ((href) => {
    if (typeof window !== "undefined")
      window.open(href, "_blank", "noopener,noreferrer");
  });
  return new Plugin3({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target;
          if (target?.classList?.contains("hm-checkbox")) {
            event.preventDefault();
            return toggleTodoAt(view, target);
          }
          if (event.button !== 0)
            return false;
          const diagram = target?.closest?.(".hm-diagram");
          if (diagram) {
            event.preventDefault();
            enterDiagramAt(view, diagram);
            return true;
          }
          const tableVisual = target?.closest?.(".hm-table-visual");
          if (tableVisual) {
            const linkEl = target?.closest?.(".hm-link");
            const href2 = linkEl?.getAttribute("data-href");
            if (href2 && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              if (event.detail >= 2)
                return true;
              openLink(href2);
              return true;
            }
            event.preventDefault();
            enterTableRowAt(view, tableVisual);
            return true;
          }
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!coords)
            return false;
          const st = concealKey.getState(view.state);
          if (!st)
            return false;
          const el = findLinkAt(st, coords.pos);
          const href = el?.attrs?.href;
          if (!el || !href)
            return false;
          const sel = view.state.selection;
          const concealed = st.readOnly || !spansIntersect(sel.from, sel.to, el.hitFrom, el.hitTo);
          if (!concealed)
            return false;
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, coords.pos)));
            view.focus();
            return true;
          }
          event.preventDefault();
          if (event.detail <= 1)
            openLink(href);
          return true;
        }
      }
    }
  });
}

// src/keymap.ts
import { Plugin as Plugin5, TextSelection as TextSelection4 } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";

// src/caret.ts
import { Plugin as Plugin4, TextSelection as TextSelection2 } from "prosemirror-state";
function isProtectedPrefix(el) {
  if (el.scope !== "block" || !el.markers.length)
    return false;
  return el.permanent === true || el.kind === "heading";
}
function permanentPrefixAt(state, blockPos) {
  const st = concealKey.getState(state);
  if (!st)
    return null;
  for (const block of st.blocks) {
    if (block.pos !== blockPos)
      continue;
    for (const el of block.elements) {
      if (isProtectedPrefix(el))
        return { block, el };
    }
    return null;
  }
  return null;
}
function escapeProtectedMarker(state, blockPos, pos) {
  const st = concealKey.getState(state);
  if (!st)
    return null;
  for (const block of st.blocks) {
    if (block.pos !== blockPos)
      continue;
    for (const el of block.elements) {
      if (!isProtectedPrefix(el))
        continue;
      for (const m of el.markers) {
        if (pos >= m.from && pos < m.to)
          return m.to;
      }
    }
    return null;
  }
  return null;
}
function caretGuardPlugin() {
  return new Plugin4({
    appendTransaction(_trs, _old, newState) {
      const sel = newState.selection;
      if (!(sel instanceof TextSelection2) || !sel.empty)
        return null;
      const st = concealKey.getState(newState);
      if (!st || st.composing)
        return null;
      const $head = sel.$head;
      if ($head.depth !== 1)
        return null;
      const next = escapeProtectedMarker(newState, $head.before(), sel.from);
      if (next === null || next === sel.from)
        return null;
      return newState.tr.setSelection(TextSelection2.create(newState.doc, next));
    }
  });
}

// src/table.ts
import { TextSelection as TextSelection3 } from "prosemirror-state";
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}
function buildTableMarkdown(options = {}) {
  const withHeaderRow = options.withHeaderRow !== false;
  const cols = clamp(options.cols ?? options.headers?.length ?? 3, 1, 32);
  const totalRows = clamp(options.rows ?? 3, withHeaderRow ? 1 : 1, 64);
  const headerCells = Array.from({ length: cols }, (_, i) => {
    const h = options.headers?.[i];
    return h && h.length ? ` ${h} ` : emptyCellText();
  });
  const lines = [];
  if (withHeaderRow) {
    lines.push(formatTableRow(headerCells));
    lines.push(formatSeparator(cols));
    const bodyCount = Math.max(0, totalRows - 1);
    for (let r = 0;r < bodyCount; r++) {
      lines.push(formatTableRow(Array.from({ length: cols }, () => emptyCellText())));
    }
  } else {
    lines.push(formatTableRow(Array.from({ length: cols }, () => emptyCellText())));
    lines.push(formatSeparator(cols));
    for (let r = 0;r < totalRows; r++) {
      lines.push(formatTableRow(Array.from({ length: cols }, () => emptyCellText())));
    }
  }
  return lines.join(`
`);
}
function blocksFromLines(lines) {
  return lines.map((line) => schema.nodes.block.create(null, line ? schema.text(line) : undefined));
}
function insertTable(options = {}) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth !== 1)
      return false;
    const md = buildTableMarkdown(options);
    const lines = md.split(`
`);
    const nodes = blocksFromLines(lines);
    if (!nodes.length)
      return false;
    const blockPos = $from.before();
    const block = $from.parent;
    const empty = block.content.size === 0;
    const firstLine = lines[0];
    const firstCell = parseTableRow(firstLine).cells[0];
    let caretOffset = firstCell?.from ?? 1;
    if (firstCell && firstLine[firstCell.from] === " ")
      caretOffset = firstCell.from + 1;
    if (!dispatch)
      return true;
    let tr = state.tr;
    let firstBlockPos;
    if (empty) {
      tr = tr.replaceWith(blockPos, blockPos + block.nodeSize, nodes[0]);
      firstBlockPos = blockPos;
      let insertAt = blockPos + nodes[0].nodeSize;
      for (let i = 1;i < nodes.length; i++) {
        tr = tr.insert(insertAt, nodes[i]);
        insertAt += nodes[i].nodeSize;
      }
    } else {
      firstBlockPos = blockPos + block.nodeSize;
      let insertAt = firstBlockPos;
      for (const n of nodes) {
        tr = tr.insert(insertAt, n);
        insertAt += n.nodeSize;
      }
    }
    const caret = firstBlockPos + 1 + caretOffset;
    tr = tr.setSelection(TextSelection3.create(tr.doc, caret));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
function tableCellsInDoc(state) {
  const st = concealKey.getState(state);
  if (!st)
    return [];
  const cells = [];
  for (const block of st.blocks) {
    for (const el of block.elements) {
      if (el.kind === "tableCell")
        cells.push({ from: el.from, to: el.to });
    }
  }
  return cells;
}
function caretInTableBlock(state) {
  const st = concealKey.getState(state);
  const { $from } = state.selection;
  if (!st || $from.depth !== 1)
    return false;
  const block = st.blocks.find((b) => b.pos === $from.before());
  return !!block && (block.line.t === "tableHeader" || block.line.t === "tableRow" || block.line.t === "tableSep");
}
function cellCaretPos(state, target) {
  let caret = target.from;
  const $pos = state.doc.resolve(target.from);
  const text = $pos.parent.textContent;
  const local = target.from - $pos.start();
  if (text[local] === " ")
    caret = Math.min(target.to, target.from + 1);
  return caret;
}
function moveTableCell(dir) {
  return (state, dispatch) => {
    if (!caretInTableBlock(state))
      return false;
    const cells = tableCellsInDoc(state);
    if (!cells.length)
      return false;
    const pos = state.selection.from;
    let idx = cells.findIndex((c) => pos >= c.from && pos <= c.to);
    if (idx < 0) {
      if (dir > 0) {
        idx = cells.findIndex((c) => c.from >= pos);
        if (idx < 0)
          return false;
        if (dispatch) {
          dispatch(state.tr.setSelection(TextSelection3.create(state.doc, cellCaretPos(state, cells[idx]))).scrollIntoView());
        }
        return true;
      }
      for (let i = cells.length - 1;i >= 0; i--) {
        if (cells[i].to <= pos) {
          idx = i;
          break;
        }
      }
      if (idx < 0)
        return false;
      if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection3.create(state.doc, cellCaretPos(state, cells[idx]))).scrollIntoView());
      }
      return true;
    }
    const next = idx + dir;
    if (next < 0 || next >= cells.length)
      return false;
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection3.create(state.doc, cellCaretPos(state, cells[next]))).scrollIntoView());
    }
    return true;
  };
}
var goToNextTableCell = moveTableCell(1);
var goToPrevTableCell = moveTableCell(-1);
var continueTableRow = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  const st = concealKey.getState(state);
  if (!st)
    return false;
  const blockPos = $from.before();
  const block = st.blocks.find((b) => b.pos === blockPos);
  if (!block)
    return false;
  const line = block.line;
  if (line.t !== "tableHeader" && line.t !== "tableRow")
    return false;
  const cols = line.colCount;
  const newLine = formatTableRow(Array.from({ length: cols }, () => emptyCellText()));
  const insertPos = blockPos + block.size;
  let at = insertPos;
  if (line.t === "tableHeader") {
    const sep = st.blocks.find((b) => b.pos === insertPos && b.line.t === "tableSep");
    if (sep)
      at = sep.pos + sep.size;
  }
  if (dispatch) {
    const node = schema.nodes.block.create(null, schema.text(newLine));
    let tr = state.tr.insert(at, node);
    const caretOffset = parseTableRow(newLine).cells[0]?.from ?? 1;
    tr = tr.setSelection(TextSelection3.create(tr.doc, at + 1 + caretOffset));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// src/keymap.ts
function lineInfoAt(state, blockPos) {
  const st = concealKey.getState(state);
  if (!st)
    return null;
  for (const block of st.blocks) {
    if (block.pos === blockPos)
      return block.line;
  }
  return null;
}
function continuationPrefix(line, text) {
  switch (line.t) {
    case "todo": {
      const bullet = text[line.indent] ?? "-";
      return `${" ".repeat(line.indent)}${bullet} [ ] `;
    }
    case "bullet":
      return text.slice(0, line.prefixLen);
    case "ordered": {
      const delim = text[line.indent + line.numLen] ?? ".";
      return `${" ".repeat(line.indent)}${line.num + 1}${delim} `;
    }
    case "quote":
      return text.slice(0, line.prefixLen);
    default:
      return null;
  }
}
var continueListItem = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!$from.parent.isTextblock || $from.depth !== 1)
    return false;
  const blockPos = $from.before();
  const line = lineInfoAt(state, blockPos);
  if (!line)
    return false;
  const text = $from.parent.textContent;
  const prefixLen = line.prefixLen ?? 0;
  const contentEmpty = text.slice(prefixLen).trim() === "";
  const atContentStart = empty && $from.parentOffset === prefixLen;
  if (line.t === "heading") {
    if (empty && contentEmpty) {
      if (dispatch) {
        const start = blockPos + 1;
        dispatch(state.tr.delete(start, start + text.length).scrollIntoView());
      }
      return true;
    }
    if (atContentStart) {
      if (dispatch) {
        const tr = state.tr.insert(blockPos, schema.nodes.block.create());
        tr.setSelection(TextSelection4.create(tr.doc, blockPos + 1));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (dispatch) {
      let tr = state.tr.deleteSelection();
      tr = tr.split(tr.selection.from);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  const prefix = continuationPrefix(line, text);
  if (prefix === null)
    return false;
  if (empty && contentEmpty) {
    if (dispatch) {
      const start = blockPos + 1;
      dispatch(state.tr.delete(start, start + text.length).scrollIntoView());
    }
    return true;
  }
  if (dispatch) {
    let tr = state.tr.deleteSelection();
    tr = tr.split(tr.selection.from);
    tr = tr.insertText(prefix, tr.selection.from);
    dispatch(tr.scrollIntoView());
  }
  return true;
};
function toggleInline(marker) {
  return (state, dispatch) => {
    const { $from, $to, from, to, empty } = state.selection;
    if (!$from.sameParent($to) || $from.depth !== 1)
      return false;
    const len = marker.length;
    if (empty) {
      if (dispatch) {
        let tr2 = state.tr.insertText(marker + marker, from);
        tr2 = tr2.setSelection(TextSelection4.create(tr2.doc, from + len));
        dispatch(tr2);
      }
      return true;
    }
    const doc = state.doc;
    const selText = doc.textBetween(from, to);
    const blockStart = $from.start();
    const blockEnd = $to.end();
    let tr;
    if (selText.startsWith(marker) && selText.endsWith(marker) && selText.length >= 2 * len) {
      const inner = selText.slice(len, selText.length - len);
      tr = state.tr.insertText(inner, from, to);
      tr = tr.setSelection(TextSelection4.create(tr.doc, from, from + inner.length));
    } else if (from - blockStart >= len && blockEnd - to >= len && doc.textBetween(from - len, from) === marker && doc.textBetween(to, to + len) === marker) {
      tr = state.tr.delete(to, to + len).delete(from - len, from);
      tr = tr.setSelection(TextSelection4.create(tr.doc, from - len, to - len));
    } else {
      tr = state.tr.insertText(marker + selText + marker, from, to);
      tr = tr.setSelection(TextSelection4.create(tr.doc, from + len, from + len + selText.length));
    }
    if (dispatch)
      dispatch(tr);
    return true;
  };
}
function contentStartPos(state, blockPos) {
  const line = lineInfoAt(state, blockPos);
  if (!line)
    return null;
  const prefixLen = line.prefixLen;
  if (typeof prefixLen !== "number" || prefixLen <= 0)
    return null;
  return blockPos + 1 + prefixLen;
}
var deleteToContentStart = (state, dispatch) => {
  const { $from, empty, from, to } = state.selection;
  if ($from.depth !== 1 || !$from.sameParent(state.selection.$to))
    return false;
  const contentStart = contentStartPos(state, $from.before()) ?? $from.start();
  if (!empty) {
    const a = Math.max(Math.min(from, to), contentStart);
    const b = Math.max(from, to);
    if (b <= contentStart)
      return true;
    if (dispatch)
      dispatch(state.tr.delete(a, b).scrollIntoView());
    return true;
  }
  if (from <= contentStart)
    return true;
  if (dispatch)
    dispatch(state.tr.delete(contentStart, from).scrollIntoView());
  return true;
};
var deleteToContentEnd = (state, dispatch) => {
  const { $from, empty, from, to } = state.selection;
  if ($from.depth !== 1 || !$from.sameParent(state.selection.$to))
    return false;
  const end = $from.end();
  if (!empty) {
    if (dispatch)
      dispatch(state.tr.delete(Math.min(from, to), Math.max(from, to)).scrollIntoView());
    return true;
  }
  if (from >= end)
    return true;
  if (dispatch)
    dispatch(state.tr.delete(from, end).scrollIntoView());
  return true;
};
var backspaceBlockFormat = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  const hit = permanentPrefixAt(state, $from.before());
  if (!hit)
    return false;
  const m = hit.el.markers[0];
  if (hit.el.kind === "hr" || hit.el.kind === "tableSep") {
    if (dispatch) {
      dispatch(state.tr.delete(hit.block.pos + 1, hit.block.pos + 1 + hit.block.text.length));
    }
    return true;
  }
  if (hit.el.kind === "tableHeader" || hit.el.kind === "tableRow")
    return false;
  if ($from.pos !== m.to)
    return false;
  if (hit.el.kind === "heading") {
    const prefixLen = m.to - (hit.block.pos + 1);
    if (hit.block.text.length > prefixLen) {
      if (hit.block.pos === 0)
        return true;
      if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection4.create(state.doc, hit.block.pos - 1)));
      }
      return true;
    }
  }
  if (dispatch)
    dispatch(state.tr.delete(m.from, m.to));
  return true;
};
var arrowLeftSkipPrefix = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  const hit = permanentPrefixAt(state, $from.before());
  if (!hit)
    return false;
  const m = hit.el.markers[0];
  if ($from.pos !== m.to)
    return false;
  if (hit.block.pos === 0)
    return true;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection4.create(state.doc, hit.block.pos - 1)));
  }
  return true;
};
var arrowUpToPrevContentEnd = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  if ($from.parentOffset !== 0)
    return false;
  const blockPos = $from.before();
  if (blockPos === 0)
    return false;
  const prev = state.doc.resolve(blockPos).nodeBefore;
  if (!prev?.isTextblock)
    return false;
  const prevPos = blockPos - prev.nodeSize;
  const line = lineInfoAt(state, prevPos);
  if (!line || !("prefixLen" in line) || !line.prefixLen)
    return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection4.create(state.doc, blockPos - 1)));
  }
  return true;
};
var INDENT = "  ";
var indentListItem = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth !== 1)
    return false;
  const line = lineInfoAt(state, $from.before());
  if (!line || !["bullet", "ordered", "todo"].includes(line.t))
    return false;
  if (!dispatch)
    return true;
  const start = $from.start();
  let tr = state.tr.insertText(INDENT, start);
  if (line.t === "ordered" && line.num !== 1) {
    const numFrom = start + INDENT.length + line.indent;
    tr = tr.insertText("1", numFrom, numFrom + line.numLen);
  }
  dispatch(tr);
  return true;
};
var dedentListItem = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth !== 1)
    return false;
  const line = lineInfoAt(state, $from.before());
  if (!line || !["bullet", "ordered", "todo"].includes(line.t))
    return false;
  const text = $from.parent.textContent;
  const remove = Math.min(text.length - text.trimStart().length, INDENT.length);
  if (remove === 0)
    return false;
  if (dispatch)
    dispatch(state.tr.delete($from.start(), $from.start() + remove));
  return true;
};
function headingInputPlugin() {
  return new Plugin5({
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "#" || from !== to)
          return false;
        const $from = view.state.doc.resolve(from);
        if ($from.depth !== 1)
          return false;
        const line = $from.parent.textContent;
        const m = line.match(/^(#{1,6}) $/);
        if (!m || m[1].length >= 6)
          return false;
        if (from !== $from.start() + m[0].length)
          return false;
        const hashInsert = $from.start() + m[1].length;
        let tr = view.state.tr.insertText("#", hashInsert);
        tr = tr.setSelection(TextSelection4.create(tr.doc, hashInsert + 2));
        view.dispatch(tr);
        return true;
      }
    }
  });
}
function markdownKeymap() {
  return keymap({
    Enter: (state, dispatch, view) => {
      if (view?.composing)
        return true;
      return continueTableRow(state, dispatch, view) || continueListItem(state, dispatch, view);
    },
    Backspace: backspaceBlockFormat,
    ArrowLeft: arrowLeftSkipPrefix,
    ArrowUp: arrowUpToPrevContentEnd,
    "Mod-Backspace": deleteToContentStart,
    "Mod-Delete": deleteToContentEnd,
    "Mod-b": toggleInline("**"),
    "Mod-i": toggleInline("*"),
    "Mod-e": toggleInline("`"),
    "Mod-Shift-x": toggleInline("~~"),
    "Mod-Shift-h": toggleInline("=="),
    Tab: (state, dispatch, view) => goToNextTableCell(state, dispatch, view) || indentListItem(state, dispatch, view),
    "Shift-Tab": (state, dispatch, view) => goToPrevTableCell(state, dispatch, view) || dedentListItem(state, dispatch, view)
  });
}

// src/normalize.ts
import { Plugin as Plugin6 } from "prosemirror-state";
function normalizePlugin() {
  return new Plugin6({
    appendTransaction(trs, _old, newState) {
      if (!trs.some((tr2) => tr2.docChanged))
        return null;
      const st = concealKey.getState(newState);
      if (!st || st.composing)
        return null;
      const fixes = [];
      const stack = [];
      for (const block of st.blocks) {
        const line = block.line;
        if (line.t === "ordered") {
          while (stack.length && stack[stack.length - 1].indent > line.indent) {
            stack.pop();
          }
          const top = stack[stack.length - 1];
          if (top && top.indent === line.indent) {
            if (line.num !== top.expected) {
              const numFrom = block.pos + 1 + line.indent;
              fixes.push({ from: numFrom, to: numFrom + line.numLen, text: String(top.expected) });
            }
            top.expected += 1;
          } else {
            const start = line.indent > 0 ? 1 : line.num;
            if (line.num !== start) {
              const numFrom = block.pos + 1 + line.indent;
              fixes.push({ from: numFrom, to: numFrom + line.numLen, text: String(start) });
            }
            stack.push({ indent: line.indent, expected: start + 1 });
          }
        } else if (line.t === "bullet" || line.t === "todo") {
          const indent = line.indent;
          while (stack.length && stack[stack.length - 1].indent >= indent) {
            stack.pop();
          }
        } else {
          stack.length = 0;
        }
      }
      if (!fixes.length)
        return null;
      const tr = newState.tr;
      for (let i = fixes.length - 1;i >= 0; i--) {
        tr.insertText(fixes[i].text, fixes[i].from, fixes[i].to);
      }
      tr.setMeta("addToHistory", false);
      return tr;
    }
  });
}

// src/highlight.ts
import { Plugin as Plugin7, PluginKey as PluginKey2 } from "prosemirror-state";
import { Decoration as Decoration3, DecorationSet as DecorationSet2 } from "prosemirror-view";
var highlightKey = new PluginKey2("handymd-highlight");
var codeOf = (r) => r.lines.join(`
`);
function collectRegions(state) {
  const st = concealKey.getState(state);
  if (!st)
    return [];
  const regions = [];
  for (let i = 0;i < st.blocks.length; i++) {
    const line = st.blocks[i].line;
    if (line.t !== "fenceOpen" || !line.info)
      continue;
    const lang = line.info.split(/\s+/)[0];
    const lines = [];
    const lineStarts = [];
    for (let j = i + 1;j < st.blocks.length && st.blocks[j].line.t === "code"; j++) {
      lines.push(st.blocks[j].text);
      lineStarts.push(st.blocks[j].pos + 1);
    }
    if (lines.length)
      regions.push({ lang, lineStarts, lines });
  }
  return regions;
}
function regionsEqual(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.lang !== y.lang || x.lines.length !== y.lines.length)
      return false;
    for (let j = 0;j < x.lines.length; j++) {
      if (x.lines[j] !== y.lines[j])
        return false;
    }
  }
  return true;
}
function decosFor(region, spans) {
  const out = [];
  const n = Math.min(region.lineStarts.length, spans.length);
  for (let i = 0;i < n; i++) {
    const lineEnd = region.lineStarts[i] + region.lines[i].length;
    let col = 0;
    for (const span of spans[i]) {
      const from = region.lineStarts[i] + col;
      const to = Math.min(from + span.text.length, lineEnd);
      col += span.text.length;
      if (span.color && to > from) {
        out.push(Decoration3.inline(from, to, { style: `color:${span.color}` }, { hmHl: true }));
      }
    }
  }
  return out;
}
var CACHE_MAX2 = 128;
function highlightPlugin(highlighter) {
  let resolved = highlighter instanceof Promise ? null : highlighter;
  const cache2 = new Map;
  const pending = new Set;
  let requestRefresh = null;
  function compute(state) {
    const decos = [];
    for (const region of collectRegions(state)) {
      const code = codeOf(region);
      const k = `${region.lang}\x00${code}`;
      const hit = cache2.get(k);
      if (hit) {
        decos.push(...decosFor(region, hit));
        continue;
      }
      if (!resolved || pending.has(k))
        continue;
      const result = resolved(code, region.lang);
      if (result instanceof Promise) {
        pending.add(k);
        result.then((spans) => {
          if (cache2.size >= CACHE_MAX2)
            cache2.clear();
          cache2.set(k, spans);
        }).catch(() => {}).finally(() => {
          pending.delete(k);
          requestRefresh?.();
        });
      } else {
        if (cache2.size >= CACHE_MAX2)
          cache2.clear();
        cache2.set(k, result);
        decos.push(...decosFor(region, result));
      }
    }
    return DecorationSet2.create(state.doc, decos);
  }
  return new Plugin7({
    key: highlightKey,
    state: {
      init: (_config, state) => compute(state),
      apply: (tr, prev, old, next) => {
        if (tr.getMeta(highlightKey) === "refresh")
          return compute(next);
        const cm = tr.getMeta(concealKey);
        if (cm?.refresh || cm?.composing === false)
          return compute(next);
        if (!tr.docChanged)
          return prev;
        if (regionsEqual(collectRegions(old), collectRegions(next))) {
          return prev.map(tr.mapping, tr.doc);
        }
        return compute(next);
      }
    },
    props: {
      decorations(state) {
        return highlightKey.getState(state);
      }
    },
    view(view) {
      requestRefresh = () => {
        if (!view.isDestroyed) {
          view.dispatch(view.state.tr.setMeta(highlightKey, "refresh"));
        }
      };
      if (resolved === null && highlighter instanceof Promise) {
        highlighter.then((fn) => {
          resolved = fn;
          requestRefresh?.();
        }).catch(() => {
          resolved = (code) => code.split(`
`).map((text) => [{ text }]);
          requestRefresh?.();
        });
      }
      return {
        destroy() {
          requestRefresh = null;
        }
      };
    }
  });
}
async function createShikiHighlighter(options = {}) {
  const shiki = await import("shiki");
  const theme = options.theme ?? "github-light";
  const langs = options.langs ?? [
    "javascript",
    "typescript",
    "jsx",
    "tsx",
    "json",
    "html",
    "css",
    "python",
    "bash",
    "markdown"
  ];
  const hl = await shiki.createHighlighter({ themes: [theme], langs });
  const loaded = new Set(hl.getLoadedLanguages());
  const aliases = { js: "javascript", ts: "typescript", sh: "bash", shell: "bash", py: "python" };
  return (code, lang) => {
    const l = aliases[lang] ?? lang;
    if (!loaded.has(l))
      return code.split(`
`).map((text) => [{ text }]);
    const lines = hl.codeToTokensBase(code, { lang: l, theme });
    return lines.map((line) => line.map((t) => ({ text: t.content, color: t.color })));
  };
}

// src/diagram.ts
var CACHE_MAX3 = 64;
function createDiagramRenderCallback(renderer) {
  let resolved = renderer instanceof Promise ? null : renderer;
  const cache2 = new Map;
  const failed = new Map;
  const waiting = [];
  const keyOf = (code, lang) => `${lang}\x00${code}`;
  const applySvg = (el, svg) => {
    el.classList.remove("hm-diagram-loading", "hm-diagram-error");
    el.innerHTML = svg;
  };
  const applyError = (el, message) => {
    el.classList.remove("hm-diagram-loading");
    el.classList.add("hm-diagram-error");
    el.textContent = message;
  };
  const remember = (map, k, v) => {
    if (map.size >= CACHE_MAX3)
      map.clear();
    map.set(k, v);
  };
  const fill = (el, code, lang) => {
    const k = keyOf(code, lang);
    el.dataset.hmDiagramKey = k;
    const hit = cache2.get(k);
    if (hit !== undefined) {
      applySvg(el, hit);
      return;
    }
    const err = failed.get(k);
    if (err !== undefined) {
      applyError(el, err);
      return;
    }
    if (!resolved) {
      el.classList.add("hm-diagram-loading");
      el.textContent = lang;
      waiting.push([el, code, lang]);
      return;
    }
    let out;
    try {
      out = resolved(code, lang);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      remember(failed, k, message);
      applyError(el, message);
      return;
    }
    if (typeof out === "string") {
      remember(cache2, k, out);
      applySvg(el, out);
      return;
    }
    el.classList.add("hm-diagram-loading");
    el.textContent = lang;
    out.then((svg) => {
      remember(cache2, k, svg);
      if (el.dataset.hmDiagramKey === k)
        applySvg(el, svg);
    }).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      remember(failed, k, message);
      if (el.dataset.hmDiagramKey === k)
        applyError(el, message);
    });
  };
  if (renderer instanceof Promise) {
    renderer.then((fn) => {
      resolved = fn;
      const queue = waiting.splice(0, waiting.length);
      for (const [el, code, lang] of queue)
        fill(el, code, lang);
    });
  }
  return fill;
}
async function createMermaidRenderer(options = {}) {
  const mod = await import("mermaid");
  const mermaid = mod.default ?? mod;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: options.theme ?? "neutral",
    ...options.config
  });
  let seq = 0;
  return async (code) => {
    const id = `hm-mermaid-${Date.now().toString(36)}-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      if (typeof document !== "undefined")
        document.getElementById(`d${id}`)?.remove();
    }
  };
}

// src/autosave.ts
class Autosave {
  statusValue = "clean";
  timer = null;
  retryTimer = null;
  attempts = 0;
  dirtyDuringSave = false;
  inFlight = false;
  destroyed = false;
  waiters = [];
  lastError = null;
  onlineHandler = null;
  getSource;
  opts;
  constructor(getSource, options) {
    this.getSource = getSource;
    this.opts = {
      save: options.save,
      debounceMs: options.debounceMs ?? 800,
      maxRetries: options.maxRetries ?? 5,
      backoffBaseMs: options.backoffBaseMs ?? 500,
      backoffMaxMs: options.backoffMaxMs ?? 30000,
      onStatusChange: options.onStatusChange
    };
    if ((options.listenOnline ?? true) && typeof window !== "undefined" && window.addEventListener) {
      this.onlineHandler = () => this.retryNow();
      window.addEventListener("online", this.onlineHandler);
    }
  }
  get status() {
    return this.statusValue;
  }
  get error() {
    return this.lastError;
  }
  setStatus(status, error) {
    if (this.statusValue === status)
      return;
    this.statusValue = status;
    this.opts.onStatusChange?.(status, error);
  }
  markDirty() {
    if (this.destroyed)
      return;
    if (this.inFlight) {
      this.dirtyDuringSave = true;
      return;
    }
    if (this.statusValue === "offline" || this.statusValue === "retrying") {
      this.dirtyDuringSave = true;
      return;
    }
    this.setStatus("dirty");
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, this.opts.debounceMs);
  }
  markClean() {
    if (this.destroyed)
      return;
    this.clearTimers();
    this.dirtyDuringSave = false;
    this.attempts = 0;
    this.setStatus("clean");
    this.settleWaiters(null);
  }
  flush() {
    if (this.destroyed || this.statusValue === "clean")
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (!this.inFlight)
        this.run();
    });
  }
  retryNow() {
    if (this.destroyed || this.inFlight)
      return;
    if (this.statusValue !== "offline" && this.statusValue !== "retrying")
      return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.attempts = 0;
    this.run();
  }
  destroy() {
    this.destroyed = true;
    this.clearTimers();
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    this.settleWaiters(new Error("autosave destroyed"));
  }
  clearTimers() {
    if (this.timer)
      clearTimeout(this.timer);
    if (this.retryTimer)
      clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }
  settleWaiters(err) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters)
      err == null ? w.resolve() : w.reject(err);
  }
  async run() {
    if (this.destroyed || this.inFlight)
      return;
    this.inFlight = true;
    this.dirtyDuringSave = false;
    this.setStatus("saving");
    const text = this.getSource();
    try {
      await this.opts.save(text);
      this.inFlight = false;
      this.attempts = 0;
      this.lastError = null;
      if (this.destroyed)
        return;
      if (this.dirtyDuringSave) {
        this.run();
      } else {
        this.setStatus("clean");
        this.settleWaiters(null);
      }
    } catch (err) {
      this.inFlight = false;
      this.lastError = err;
      if (this.destroyed)
        return;
      this.attempts += 1;
      if (this.attempts > this.opts.maxRetries) {
        this.setStatus("offline", err);
        this.settleWaiters(err);
        return;
      }
      this.setStatus("retrying", err);
      const delay = Math.min(this.opts.backoffBaseMs * 2 ** (this.attempts - 1), this.opts.backoffMaxMs);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.run();
      }, delay);
    }
  }
}

// src/editor.ts
class HandyEditor {
  view = null;
  autosave = null;
  phaseValue = "loading";
  readOnlyValue;
  readOnlyBeforeConflict = false;
  remoteMarkdown = null;
  lastLoadError = null;
  opts;
  listeners = new Map;
  constructor(options) {
    this.opts = options;
    this.readOnlyValue = options.readOnly ?? false;
    this.init();
  }
  get phase() {
    return this.phaseValue;
  }
  get loadError() {
    return this.lastLoadError;
  }
  get saveStatus() {
    return this.autosave?.status ?? "clean";
  }
  get readOnly() {
    return this.readOnlyValue;
  }
  setPhase(phase) {
    if (this.phaseValue === phase)
      return;
    this.phaseValue = phase;
    this.view?.setProps({});
    this.opts.onPhaseChange?.(phase);
    this.emit("phase", phase);
  }
  async init() {
    let content = this.opts.content ?? "";
    if (this.opts.load) {
      this.setPhase("loading");
      try {
        content = await this.opts.load();
      } catch (err) {
        this.lastLoadError = err;
        this.setPhase("error");
        return;
      }
    }
    if (this.phaseValue === "destroyed")
      return;
    this.createView(content);
    this.setPhase("ready");
  }
  retry() {
    if (this.phaseValue !== "error")
      return;
    this.lastLoadError = null;
    this.init();
  }
  createView(content) {
    const doc = markdownToDoc(content);
    const plugins = [
      concealPlugin({
        readOnly: this.readOnlyValue,
        renderDiagram: this.opts.diagram ? createDiagramRenderCallback(this.opts.diagram) : undefined
      }),
      imePlugin(),
      headingInputPlugin(),
      interactionsPlugin({ onOpenLink: this.opts.onOpenLink }),
      caretGuardPlugin(),
      markdownKeymap()
    ];
    plugins.push(highlightPlugin(this.opts.highlight ?? createShikiHighlighter()));
    if (this.opts.history !== false) {
      plugins.push(history());
      plugins.push(keymap2({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }));
    }
    plugins.push(keymap2({
      "Mod-s": () => {
        this.flush();
        return true;
      }
    }));
    plugins.push(keymap2(baseKeymap));
    if (this.opts.normalizeOrderedLists !== false)
      plugins.push(normalizePlugin());
    plugins.push(new Plugin8({
      filterTransaction: (tr) => !tr.docChanged || !this.readOnlyValue || tr.getMeta("handymd-programmatic") === true
    }));
    if (this.opts.plugins)
      plugins.push(...this.opts.plugins);
    const state = EditorState.create({ doc, plugins });
    this.opts.mount.classList.add("handymd");
    this.view = new EditorView(this.opts.mount, {
      state,
      editable: () => !this.readOnlyValue && this.phaseValue === "ready",
      dispatchTransaction: (tr) => {
        const view = this.view;
        if (!view)
          return;
        const newState = view.state.apply(tr);
        view.updateState(newState);
        if (tr.docChanged) {
          this.autosave?.markDirty();
          if (this.opts.onChange || this.listeners.get("change")?.size) {
            const md = docToMarkdown(newState.doc);
            this.opts.onChange?.(md);
            this.emit("change", md);
          }
        }
      },
      handleDOMEvents: {
        blur: () => {
          this.autosave?.flush().catch(() => {});
          return false;
        }
      }
    });
    if (this.opts.save) {
      this.autosave = new Autosave(() => this.getMarkdown(), {
        save: this.opts.save,
        ...this.opts.autosave,
        onStatusChange: (status, error) => {
          this.opts.onSaveStatusChange?.(status, error);
          this.emit("saveStatus", status);
        }
      });
    }
  }
  getMarkdown() {
    return this.view ? docToMarkdown(this.view.state.doc) : this.opts.content ?? "";
  }
  setMarkdown(markdown, options = {}) {
    const view = this.view;
    if (!view)
      return;
    const doc = markdownToDoc(markdown);
    let tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    tr = tr.setSelection(TextSelection5.atStart(tr.doc));
    if (options.addToHistory === false)
      tr.setMeta("addToHistory", false);
    tr.setMeta("handymd-programmatic", true);
    view.dispatch(tr);
  }
  insertTable(options = {}) {
    const view = this.view;
    if (!view || this.phaseValue !== "ready" || this.readOnlyValue)
      return false;
    return insertTable(options)(view.state, view.dispatch.bind(view));
  }
  focus() {
    this.view?.focus();
  }
  setReadOnly(readOnly) {
    if (this.readOnlyValue === readOnly || !this.view) {
      this.readOnlyValue = readOnly;
      return;
    }
    this.readOnlyValue = readOnly;
    const meta = { readOnly };
    this.view.dispatch(this.view.state.tr.setMeta(concealKey, meta));
  }
  notifyRemote(remoteMarkdown) {
    if (this.phaseValue !== "ready" || !this.view)
      return;
    if (remoteMarkdown === this.getMarkdown())
      return;
    if (this.saveStatus === "clean") {
      this.setMarkdown(remoteMarkdown, { addToHistory: false });
      return;
    }
    this.remoteMarkdown = remoteMarkdown;
    this.readOnlyBeforeConflict = this.readOnlyValue;
    this.setReadOnly(true);
    this.setPhase("conflicted");
  }
  get remoteConflict() {
    return this.remoteMarkdown;
  }
  resolveConflict(choice) {
    if (this.phaseValue !== "conflicted")
      return;
    const remote = this.remoteMarkdown;
    this.remoteMarkdown = null;
    this.setPhase("ready");
    this.setReadOnly(this.readOnlyBeforeConflict);
    if (choice === "remote" && remote !== null) {
      this.setMarkdown(remote, { addToHistory: false });
      this.autosave?.markClean();
    } else {
      this.autosave?.markDirty();
      this.autosave?.flush().catch(() => {});
    }
  }
  flush() {
    return this.autosave?.flush() ?? Promise.resolve();
  }
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set;
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }
  emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }
  async destroy() {
    if (this.phaseValue === "destroyed")
      return;
    try {
      await this.flush();
    } catch {}
    this.autosave?.destroy();
    this.autosave = null;
    this.view?.destroy();
    this.view = null;
    this.setPhase("destroyed");
  }
}
function createEditor(options) {
  return new HandyEditor(options);
}
export {
  toggleInline,
  setConcealMeta,
  schema,
  revealSignature,
  parseTableRow,
  parseInlineCached,
  parseInline,
  parseDoc,
  normalizePlugin,
  markdownToDoc,
  markdownKeymap,
  looksLikeTableRow,
  isTableSeparator,
  isRevealed,
  interactionsPlugin,
  insertTable,
  indentListItem,
  imePlugin,
  highlightPlugin,
  highlightKey,
  headingInputPlugin,
  goToPrevTableCell,
  goToNextTableCell,
  formatTableRow,
  formatSeparator,
  docToMarkdown,
  diagramLangOf,
  deleteToContentStart,
  deleteToContentEnd,
  dedentListItem,
  createShikiHighlighter,
  createMermaidRenderer,
  createEditor,
  createDiagramRenderCallback,
  continueTableRow,
  continueListItem,
  concealPlugin,
  concealKey,
  classifyLines,
  caretGuardPlugin,
  buildTableMarkdown,
  buildBlockDecos,
  backspaceBlockFormat,
  arrowUpToPrevContentEnd,
  arrowLeftSkipPrefix,
  HandyEditor,
  Autosave
};

//# debugId=6A5B4A60C15BA06C64756E2164756E21
