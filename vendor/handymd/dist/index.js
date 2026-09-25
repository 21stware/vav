var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/editor.ts
import { EditorState, Plugin as Plugin10, TextSelection as TextSelection7 } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, redo as redo2, undo as undo2 } from "prosemirror-history";
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

// src/parse/table.ts
function findPipes(line) {
  const pipes = [];
  for (let i = 0;i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|")
      pipes.push({ from: i, to: i + 1 });
  }
  return pipes;
}
function parseTableRow(line) {
  const pipes = findPipes(line);
  let innerStart = 0;
  let innerEnd = line.length;
  const leadingWs = line.length - line.trimStart().length;
  const trailingWs = line.length - line.trimEnd().length;
  if (pipes.length && pipes[0].from === leadingWs)
    innerStart = leadingWs + 1;
  if (pipes.length && pipes[pipes.length - 1].from === line.length - trailingWs - 1) {
    innerEnd = line.length - trailingWs - 1;
  }
  const cells = [];
  if (innerStart > innerEnd) {
    return { cells, pipes };
  }
  let start = innerStart;
  for (const p of pipes) {
    if (p.from < innerStart || p.from >= innerEnd)
      continue;
    cells.push({ from: start, to: p.from, text: line.slice(start, p.from) });
    start = p.to;
  }
  cells.push({ from: start, to: innerEnd, text: line.slice(start, innerEnd) });
  return { cells, pipes };
}
function parseTableAlign(sepLine) {
  return parseTableRow(sepLine).cells.map((c) => {
    const t = c.text.trim();
    const l = t.startsWith(":");
    const r = t.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "none";
  });
}
function cellDisplaySource(raw) {
  let text = raw;
  if (text.startsWith(" "))
    text = text.slice(1);
  if (text.endsWith(" "))
    text = text.slice(0, -1);
  return text;
}
function cellSourceFromInput(input) {
  const flat = input.replace(/[\r\n]+/g, " ").replace(/\u00a0/g, " ");
  const escaped = flat.replace(/(\\*)\|/g, (m, bs) => bs.length % 2 ? m : `${bs}\\|`);
  return escaped ? ` ${escaped} ` : emptyCellText();
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
var LIST_OR_QUOTE = new Set(["bullet", "ordered", "todo", "quote"]);
var SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;
function toCommonMark(markdown, options = {}) {
  const lineBreak = options.lineBreak ?? "hard";
  const lines = markdown.replace(/\r\n?/g, `
`).split(`
`);
  const types = classifyLines(lines);
  const out = [];
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const cur = types[i].t;
    const prev = i > 0 ? types[i - 1].t : null;
    if (prev === "para") {
      if (cur === "para" && SETEXT_UNDERLINE.test(line))
        out.push("");
      else if (cur === "para") {
        if (lineBreak === "paragraph")
          out.push("");
        else if (!/( {2}|\\)$/.test(out[out.length - 1]))
          out[out.length - 1] += "  ";
      } else if (cur === "hr" || cur === "tableHeader" || LIST_OR_QUOTE.has(cur)) {
        out.push("");
      }
    } else if (prev && LIST_OR_QUOTE.has(prev) && cur === "para") {
      out.push("");
    }
    out.push(line);
  }
  return out.join(`
`);
}

// src/conceal/plugin.ts
import { Plugin, PluginKey } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";

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
  const tableSrc = new Map;
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
    tableSrc.set(i, texts.slice(i, j).join(`
`));
  }
  return { fenceRegion, diagramCode, tableEdge, tableSrc };
}
function buildLineElements(i, text, pos, size, li, regions) {
  const start = pos + 1;
  const blockHit = { hitFrom: pos, hitTo: pos + size };
  const els = [];
  const { fenceRegion, diagramCode, tableEdge, tableSrc } = regions;
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
        permanent: true,
        from: pos,
        to: pos + size,
        ...blockHit,
        markers: kind === "tableSep" ? [{ from: start, to: start + text.length }] : parsed.pipes.map((p) => ({ from: start + p.from, to: start + p.to })),
        attrs: kind === "tableHeader" ? { colCount, tableEdge: edge, tableSrc: tableSrc.get(i) ?? text } : { colCount, tableEdge: edge }
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
function lineStructureEqual(old, text, li, edge, diagramCode, tableSrc) {
  if (old.text !== text)
    return false;
  if (!lineInfoEqual(old.line, li))
    return false;
  const oldTable = old.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs;
  if (oldTable?.tableEdge !== edge)
    return false;
  if (oldTable?.tableSrc !== tableSrc)
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
    const tsrc = li.t === "tableHeader" ? regions.tableSrc.get(i) : undefined;
    const j = newToOld[i];
    if (j !== null) {
      const old = prevBlocks[j];
      if (lineStructureEqual(old, text, li, edge, dcode, tsrc)) {
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
  if (el.kind === "image")
    return sel.from < sel.to && sel.from <= el.from && sel.to >= el.to;
  if (sel.from === sel.to)
    return spansIntersect(sel.from, sel.to, el.hitFrom, el.hitTo);
  return spansIntersect(sel.from, sel.from, el.hitFrom, el.hitTo) || spansIntersect(sel.to, sel.to, el.hitFrom, el.hitTo);
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
import { TextSelection } from "prosemirror-state";
import { closeHistory, redo, undo } from "prosemirror-history";

// src/tableops.ts
function splitTableSource(src) {
  const lines = src.split(`
`);
  return { rows: [lines[0] ?? "", ...lines.slice(2)], sep: lines[1] ?? "" };
}
function joinTableSource(t) {
  return [t.rows[0] ?? "", t.sep, ...t.rows.slice(1)];
}
function tableColCount(t) {
  const align = parseTableAlign(t.sep);
  return Math.max(1, align.length || parseTableRow(t.rows[0] ?? "").cells.length);
}
function cellsOf(line, colCount) {
  const cells = parseTableRow(line).cells.map((c) => c.text);
  while (cells.length < colCount)
    cells.push(emptyCellText());
  return cells;
}
function emptyRow(colCount) {
  return formatTableRow(Array.from({ length: colCount }, () => emptyCellText()));
}
function withHeaderPadded(t) {
  const cols = tableColCount(t);
  const header = t.rows[0] ?? "";
  if (parseTableRow(header).cells.length >= cols)
    return t;
  return { ...t, rows: [formatTableRow(cellsOf(header, cols)), ...t.rows.slice(1)] };
}
var clampIndex = (i, n) => Math.max(0, Math.min(n, i));
function insertTableRow(t, at) {
  const rows = t.rows.slice();
  rows.splice(clampIndex(at, rows.length), 0, emptyRow(tableColCount(t)));
  return withHeaderPadded({ ...t, rows });
}
function deleteTableRow(t, index) {
  if (index < 0 || index >= t.rows.length)
    return t;
  const rows = t.rows.slice();
  rows.splice(index, 1);
  if (!rows.length)
    return null;
  return withHeaderPadded({ ...t, rows });
}
function moveTableRow(t, from, to) {
  const n = t.rows.length;
  if (from < 0 || from >= n)
    return t;
  to = Math.max(0, Math.min(n - 1, to));
  if (from === to)
    return t;
  const rows = t.rows.slice();
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  return withHeaderPadded({ ...t, rows });
}
function alignsOf(t, cols) {
  const align = parseTableAlign(t.sep);
  while (align.length < cols)
    align.push("none");
  align.length = cols;
  return align;
}
function rewriteColumns(t, edit) {
  const cols = tableColCount(t);
  const align = alignsOf(t, cols);
  edit(align, "none");
  const rows = t.rows.map((line) => {
    const cells = cellsOf(line, cols).slice(0, cols);
    edit(cells, emptyCellText());
    return formatTableRow(cells);
  });
  return { rows, sep: formatSeparator(align.length, align) };
}
function insertTableColumn(t, at) {
  const i = clampIndex(at, tableColCount(t));
  return rewriteColumns(t, (arr, filler) => void arr.splice(i, 0, filler));
}
function deleteTableColumn(t, index) {
  const cols = tableColCount(t);
  if (index < 0 || index >= cols)
    return t;
  if (cols === 1)
    return null;
  return rewriteColumns(t, (arr) => void arr.splice(index, 1));
}
function moveTableColumn(t, from, to) {
  const cols = tableColCount(t);
  if (from < 0 || from >= cols)
    return t;
  to = Math.max(0, Math.min(cols - 1, to));
  if (from === to)
    return t;
  return rewriteColumns(t, (arr) => {
    const [c] = arr.splice(from, 1);
    arr.splice(to, 0, c);
  });
}
function setTableColumnAlign(t, index, value) {
  const cols = tableColCount(t);
  if (index < 0 || index >= cols)
    return t;
  const align = alignsOf(t, cols);
  if (align[index] === value)
    return t;
  align[index] = value;
  return withHeaderPadded({ ...t, sep: formatSeparator(cols, align) });
}

// src/conceal/tableview.ts
function equalStyle(a, b) {
  if (a === b)
    return true;
  if (!a || !b)
    return false;
  return a.kind === b.kind && a.href === b.href;
}
function analyzeCell(raw) {
  const text = cellDisplaySource(raw);
  const els = parseInlineCached(text);
  const hide = new Array(text.length).fill(false);
  for (const e of els) {
    for (const m of e.markers) {
      for (let i = m.from;i < m.to && i < text.length; i++)
        hide[i] = true;
    }
  }
  const styleAt = new Array(text.length).fill(null);
  for (const e of els) {
    if (!e.content)
      continue;
    if (!["link", "strong", "em", "code", "strike", "mark", "tag"].includes(e.kind))
      continue;
    for (let i = e.content.from;i < e.content.to && i < text.length; i++) {
      styleAt[i] = { kind: e.kind, href: e.attrs?.href };
    }
  }
  return { text, hide, styleAt };
}
function renderCellPreview(raw) {
  const frag = document.createDocumentFragment();
  const { text, hide, styleAt } = analyzeCell(raw);
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
  return frag;
}
function previewOffsetToSource(raw, visible) {
  const { text, hide } = analyzeCell(raw);
  let seen = 0;
  let lastEnd = 0;
  for (let i = 0;i < text.length; i++) {
    if (hide[i])
      continue;
    if (seen === visible)
      return i;
    seen++;
    lastEnd = i + 1;
  }
  return visible === 0 ? 0 : lastEnd;
}
function parseTableModel(src) {
  const lines = src.split(`
`);
  const header = parseTableRow(lines[0] ?? "").cells.map((c) => c.text);
  const align = lines[1] !== undefined ? parseTableAlign(lines[1]) : [];
  const colCount = Math.max(1, align.length || header.length);
  const rows = [header, ...lines.slice(2).map((l) => parseTableRow(l).cells.map((c) => c.text))];
  return { rows, align, colCount };
}
function lineIndexOfRow(row) {
  return row === 0 ? 0 : row + 1;
}
function tableLinePositions(doc, headerPos) {
  const out = [];
  let pos = headerPos;
  let idx = 0;
  while (pos < doc.content.size) {
    const node = doc.nodeAt(pos);
    if (!node)
      break;
    const text = node.textContent;
    if (idx === 0) {
      if (!looksLikeTableRow(text))
        break;
    } else if (idx === 1) {
      if (!isTableSeparator(text))
        break;
    } else if (!looksLikeTableRow(text) || isTableSeparator(text)) {
      break;
    }
    out.push(pos);
    pos += node.nodeSize;
    idx++;
  }
  return out;
}
var rebuilding = false;
var CONTROLLER = Symbol("hm-table");
function supportsPlaintextOnly(el) {
  el.contentEditable = "plaintext-only";
  return el.contentEditable === "plaintext-only";
}
function caretOffsetIn(el) {
  const sel = el.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.focusNode))
    return (el.textContent ?? "").length;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.setEnd(sel.focusNode, sel.focusOffset);
  return range.toString().length;
}
function selectionOffsetsIn(el) {
  const sel = el.ownerDocument.getSelection();
  const len = (el.textContent ?? "").length;
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) {
    return { from: len, to: len };
  }
  const r = sel.getRangeAt(0);
  const pre = el.ownerDocument.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const from = pre.toString().length;
  return { from, to: from + r.toString().length };
}
function setCaretIn(el, from, to = from) {
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (!sel)
    return;
  const text = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
  const range = doc.createRange();
  if (text) {
    const len = text.textContent?.length ?? 0;
    range.setStart(text, Math.max(0, Math.min(from, len)));
    range.setEnd(text, Math.max(0, Math.min(to, len)));
  } else {
    range.setStart(el, 0);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
function escapedLength(input) {
  return cellDisplaySource(cellSourceFromInput(input)).length;
}
function caretFromPoint(cell, x, y) {
  const doc = cell.ownerDocument;
  let node = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || !cell.contains(node))
    return -1;
  const range = doc.createRange();
  range.selectNodeContents(cell);
  range.setEnd(node, offset);
  return range.toString().length;
}
var GRIP_SVG = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">' + [3, 8, 13].map((y) => `<circle cx="3" cy="${y}" r="1.3"/><circle cx="7" cy="${y}" r="1.3"/>`).join("") + "</svg>";

class TableController {
  view;
  getPos;
  model;
  opts;
  wrap;
  scroller;
  inner;
  table;
  rowHandle;
  colHandle;
  dropLine;
  menu = null;
  editing = null;
  composing = false;
  hover = null;
  picked = null;
  dragging = false;
  constructor(view, getPos, model, opts) {
    this.view = view;
    this.getPos = getPos;
    this.model = model;
    this.opts = opts;
    this.wrap = document.createElement("div");
    this.wrap.className = "hm-table-wrap";
    this.wrap.contentEditable = "false";
    this.wrap.tabIndex = -1;
    this.wrap[CONTROLLER] = this;
    this.scroller = document.createElement("div");
    this.scroller.className = "hm-table-scroll";
    this.inner = document.createElement("div");
    this.inner.className = "hm-table-inner";
    this.table = this.renderTable();
    this.inner.appendChild(this.table);
    this.scroller.appendChild(this.inner);
    this.wrap.appendChild(this.scroller);
    this.colHandle = this.chrome("hm-table-handle hm-table-handle-col", "选择列（拖动排序）", this.inner);
    this.rowHandle = this.chrome("hm-table-handle hm-table-handle-row", "选择行（拖动排序）", this.wrap);
    this.colHandle.innerHTML = GRIP_SVG;
    this.rowHandle.innerHTML = GRIP_SVG;
    this.dropLine = this.chrome("hm-table-drop", "", this.inner);
    const addRow = this.chrome("hm-table-add hm-table-add-row", "添加行", this.inner);
    const addCol = this.chrome("hm-table-add hm-table-add-col", "添加列", this.inner);
    addRow.textContent = "+";
    addCol.textContent = "+";
    addRow.addEventListener("click", () => this.appendRow());
    addCol.addEventListener("click", () => this.appendColumn());
    this.rowHandle.addEventListener("pointerdown", (e) => this.onHandleDown(e, "row"));
    this.colHandle.addEventListener("pointerdown", (e) => this.onHandleDown(e, "col"));
    this.wrap.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.wrap.addEventListener("mousemove", (e) => this.onHover(e));
    this.wrap.addEventListener("mouseleave", () => {
      this.hover = null;
      this.positionChrome();
    });
    this.scroller.addEventListener("scroll", () => this.positionChrome());
    this.wrap.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.wrap.addEventListener("input", (e) => this.onInput(e));
    this.wrap.addEventListener("compositionstart", () => this.composing = true);
    this.wrap.addEventListener("compositionend", () => {
      this.composing = false;
      this.commit();
    });
    this.wrap.addEventListener("paste", (e) => this.onPaste(e));
    this.wrap.addEventListener("focusout", (e) => this.onFocusOut(e));
  }
  chrome(cls, title, parent) {
    const el = document.createElement("div");
    el.className = `hm-table-ui ${cls}`;
    if (title) {
      el.title = title;
      el.setAttribute("aria-label", title);
    }
    parent.appendChild(el);
    return el;
  }
  renderTable() {
    const { rows, align, colCount } = this.model;
    const table = document.createElement("table");
    table.className = "hm-table-grid";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    rows.forEach((cells, r) => {
      const tr = document.createElement("tr");
      for (let c = 0;c < colCount; c++) {
        const td = document.createElement(r === 0 ? "th" : "td");
        td.className = "hm-table-cell";
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        const a = align[c];
        if (a && a !== "none")
          td.style.textAlign = a;
        td.appendChild(renderCellPreview(cells[c] ?? ""));
        tr.appendChild(td);
      }
      (r === 0 ? thead : tbody).appendChild(tr);
    });
    table.appendChild(thead);
    if (rows.length > 1)
      table.appendChild(tbody);
    return table;
  }
  cellEl(t) {
    return this.wrap.querySelector(`[data-row="${t.row}"][data-col="${t.col}"]`);
  }
  rawAt(t) {
    return this.model.rows[t.row]?.[t.col] ?? "";
  }
  headerPos() {
    const p = this.getPos();
    return p === undefined ? null : p - 1;
  }
  get rowCount() {
    return this.model.rows.length;
  }
  get colCount() {
    return this.model.colCount;
  }
  beginEdit(t, caret = "end", selectTo) {
    const cell = this.cellEl(t);
    if (!cell || !this.view.editable)
      return false;
    if (this.picked)
      this.pick(null);
    if (this.editing && this.editing.cell !== cell)
      this.endEdit();
    const source = cellDisplaySource(this.rawAt(t));
    if (this.editing?.cell !== cell) {
      this.freezeColumns();
      cell.textContent = source;
      if (!supportsPlaintextOnly(cell))
        cell.contentEditable = "true";
      cell.spellcheck = false;
      cell.classList.add("hm-table-cell-editing");
      this.editing = { cell, target: t };
    }
    cell.focus({ preventScroll: true });
    const len = (cell.textContent ?? "").length;
    const at = caret === "start" ? 0 : caret === "end" ? len : caret;
    setCaretIn(cell, at, selectTo ?? at);
    cell.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  }
  endEdit() {
    const ed = this.editing;
    if (!ed)
      return;
    this.editing = null;
    const raw = cellSourceFromInput(ed.cell.textContent ?? "");
    ed.cell.removeAttribute("contenteditable");
    ed.cell.classList.remove("hm-table-cell-editing");
    ed.cell.replaceChildren(renderCellPreview(raw));
  }
  onFocusOut(e) {
    if (rebuilding || this.composing)
      return;
    if (e.relatedTarget instanceof Node && this.wrap.contains(e.relatedTarget))
      return;
    this.endEdit();
    this.unfreezeColumns();
    if (this.picked && !this.dragging)
      this.pick(null);
  }
  freezeColumns() {
    const table = this.wrap.querySelector("table");
    if (!table || table.querySelector("colgroup"))
      return;
    const head = table.querySelectorAll("thead .hm-table-cell");
    const total = table.getBoundingClientRect().width;
    if (!total || !head.length)
      return;
    const colgroup = document.createElement("colgroup");
    head.forEach((th) => {
      const col = document.createElement("col");
      col.style.width = `${th.getBoundingClientRect().width / total * 100}%`;
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = "fixed";
  }
  unfreezeColumns() {
    const table = this.wrap.querySelector("table");
    table?.querySelector("colgroup")?.remove();
    table?.style.removeProperty("table-layout");
  }
  onInput(e) {
    if (this.composing || e.isComposing)
      return;
    this.commit();
  }
  commit(caretOverride) {
    const ed = this.editing;
    if (!ed)
      return;
    const input = ed.cell.textContent ?? "";
    const caret = caretOverride ?? caretOffsetIn(ed.cell);
    const newRaw = cellSourceFromInput(input);
    if (newRaw === cellSourceFromInput(cellDisplaySource(this.rawAt(ed.target))))
      return;
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const tr = setCellTransaction(this.view, headerPos, ed.target, newRaw, this.model.colCount);
    if (!tr)
      return;
    const nextCaret = escapedLength(input.slice(0, caret));
    this.dispatchAndRestore(tr, headerPos, ed.target, nextCaret);
  }
  dispatchAndRestore(tr, headerPos, target, caret) {
    const view = this.view;
    rebuilding = true;
    try {
      view.dispatch(tr);
    } finally {
      rebuilding = false;
    }
    focusTableCell(view, headerPos, target, caret);
  }
  onPaste(e) {
    const ed = this.editing;
    if (!ed)
      return;
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/[\r\n]+/g, " ");
    const { from, to } = selectionOffsetsIn(ed.cell);
    const cur = ed.cell.textContent ?? "";
    ed.cell.textContent = cur.slice(0, from) + text + cur.slice(to);
    setCaretIn(ed.cell, from + text.length);
    this.commit(from + text.length);
  }
  onMouseDown(e) {
    const target = e.target;
    if (target.closest?.(".hm-table-ui")) {
      e.preventDefault();
      return;
    }
    const cell = target.closest?.(".hm-table-cell");
    if (cell && this.editing?.cell === cell)
      return;
    const link = target.closest?.(".hm-link");
    const href = link?.getAttribute("data-href");
    if (href && !e.metaKey && !e.ctrlKey && e.button === 0) {
      e.preventDefault();
      if (e.detail <= 1) {
        const open = this.opts.onOpenLink ?? ((h) => window.open(h, "_blank", "noopener,noreferrer"));
        open(href);
      }
      return;
    }
    e.preventDefault();
    if (!cell || e.button !== 0)
      return;
    const t = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    const visible = caretFromPoint(cell, e.clientX, e.clientY);
    const caret = visible < 0 ? "end" : previewOffsetToSource(this.rawAt(t), visible);
    this.beginEdit(t, caret);
  }
  onKeyDown(e) {
    if (this.picked && e.target === this.wrap) {
      this.onPickKey(e);
      return;
    }
    const ed = this.editing;
    if (!ed || e.target !== ed.cell)
      return;
    if (e.isComposing || this.composing || e.keyCode === 229)
      return;
    const { row, col } = ed.target;
    const mod = e.metaKey || e.ctrlKey;
    const text = ed.cell.textContent ?? "";
    const sel = selectionOffsetsIn(ed.cell);
    const collapsed = sel.from === sel.to;
    const lastRow = this.rowCount - 1;
    const lastCol = this.colCount - 1;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      handled();
      const cmd = e.key === "y" || e.shiftKey ? redo : undo;
      const headerPos = this.headerPos();
      rebuilding = true;
      try {
        cmd(this.view.state, this.view.dispatch);
      } finally {
        rebuilding = false;
      }
      if (headerPos !== null)
        focusTableCell(this.view, headerPos, ed.target, "end");
      return;
    }
    if (e.altKey && !mod && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      handled();
      const to = row + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to > lastRow)
        return;
      const caret = sel.to;
      const headerPos = this.headerPos();
      this.structural((s) => moveTableRow(s, row, to));
      if (headerPos !== null)
        focusTableCell(this.view, headerPos, { row: to, col }, caret);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && ["b", "i", "e"].includes(e.key)) {
      handled();
      this.toggleWrap(e.key === "b" ? "**" : e.key === "i" ? "*" : "`");
      return;
    }
    switch (e.key) {
      case "Tab": {
        handled();
        if (e.shiftKey) {
          if (col > 0)
            this.beginEdit({ row, col: col - 1 }, "end");
          else if (row > 0)
            this.beginEdit({ row: row - 1, col: lastCol }, "end");
          return;
        }
        if (col < lastCol)
          this.beginEdit({ row, col: col + 1 }, "end");
        else if (row < lastRow)
          this.beginEdit({ row: row + 1, col: 0 }, "end");
        else
          this.insertRowAfter(row, 0);
        return;
      }
      case "Enter": {
        handled();
        if (e.shiftKey || mod) {
          this.insertRowAfter(row, col);
          return;
        }
        if (row < lastRow)
          this.beginEdit({ row: row + 1, col }, "end");
        else
          this.insertRowAfter(row, col);
        return;
      }
      case "Escape":
        handled();
        this.exit("after");
        return;
      case "ArrowUp":
        if (e.shiftKey)
          return;
        handled();
        if (row > 0)
          this.beginEdit({ row: row - 1, col }, "end");
        else
          this.exit("before");
        return;
      case "ArrowDown":
        if (e.shiftKey)
          return;
        handled();
        if (row < lastRow)
          this.beginEdit({ row: row + 1, col }, "end");
        else
          this.exit("after");
        return;
      case "ArrowLeft":
        if (e.shiftKey || !collapsed || sel.from > 0 || mod || e.altKey)
          return;
        handled();
        if (col > 0)
          this.beginEdit({ row, col: col - 1 }, "end");
        else if (row > 0)
          this.beginEdit({ row: row - 1, col: lastCol }, "end");
        else
          this.exit("before");
        return;
      case "ArrowRight":
        if (e.shiftKey || !collapsed || sel.to < text.length || mod || e.altKey)
          return;
        handled();
        if (col < lastCol)
          this.beginEdit({ row, col: col + 1 }, "start");
        else if (row < lastRow)
          this.beginEdit({ row: row + 1, col: 0 }, "start");
        else
          this.exit("after");
        return;
      case "Backspace": {
        if (!collapsed || sel.from > 0 || text.length > 0 || col !== 0)
          return;
        const rowEmpty = (r) => (this.model.rows[r] ?? []).every((c) => !cellDisplaySource(c).trim());
        if (row > 0 && rowEmpty(row)) {
          handled();
          this.deleteRow(row);
          return;
        }
        if (row === 0 && this.model.rows.every((_, r) => rowEmpty(r))) {
          handled();
          this.deleteTable();
        }
        return;
      }
    }
  }
  toggleWrap(marker) {
    const ed = this.editing;
    if (!ed)
      return;
    const text = ed.cell.textContent ?? "";
    const { from, to } = selectionOffsetsIn(ed.cell);
    const n = marker.length;
    const wrapped = from >= n && text.slice(from - n, from) === marker && text.slice(to, to + n) === marker;
    let next;
    let a;
    let b;
    if (wrapped) {
      next = text.slice(0, from - n) + text.slice(from, to) + text.slice(to + n);
      a = from - n;
      b = to - n;
    } else {
      next = text.slice(0, from) + marker + text.slice(from, to) + marker + text.slice(to);
      a = from + n;
      b = to + n;
    }
    ed.cell.textContent = next;
    setCaretIn(ed.cell, a, b);
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const tr = setCellTransaction(this.view, headerPos, ed.target, cellSourceFromInput(next), this.colCount);
    if (!tr)
      return;
    rebuilding = true;
    try {
      this.view.dispatch(tr);
    } finally {
      rebuilding = false;
    }
    const ctl = tableControllerAt(this.view, headerPos);
    ctl?.beginEdit(ed.target, a, b);
  }
  insertRowAfter(row, focusCol) {
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const lines = tableLinePositions(this.view.state.doc, headerPos);
    const lineIdx = Math.max(1, lineIndexOfRow(row));
    const linePos = lines[lineIdx];
    if (linePos === undefined)
      return;
    const node = this.view.state.doc.nodeAt(linePos);
    const at = linePos + node.nodeSize;
    const text = formatTableRow(Array.from({ length: this.colCount }, () => emptyCellText()));
    const { schema: schema2 } = this.view.state;
    const tr = this.view.state.tr.insert(at, schema2.nodes.block.create(null, schema2.text(text)));
    this.dispatchAndRestore(tr, headerPos, { row: row + 1, col: focusCol }, "start");
  }
  deleteRow(row) {
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const lines = tableLinePositions(this.view.state.doc, headerPos);
    const linePos = lines[lineIndexOfRow(row)];
    if (linePos === undefined)
      return;
    const node = this.view.state.doc.nodeAt(linePos);
    const tr = this.view.state.tr.delete(linePos, linePos + node.nodeSize);
    this.dispatchAndRestore(tr, headerPos, { row: row - 1, col: this.colCount - 1 }, "end");
  }
  deleteTable() {
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const doc = this.view.state.doc;
    const lines = tableLinePositions(doc, headerPos);
    const lastPos = lines[lines.length - 1];
    const end = lastPos + doc.nodeAt(lastPos).nodeSize;
    const { schema: schema2 } = this.view.state;
    let tr = this.view.state.tr.replaceWith(headerPos, end, schema2.nodes.block.create());
    tr = tr.setSelection(TextSelection.create(tr.doc, headerPos + 1));
    this.editing = null;
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }
  onHover(e) {
    if (this.dragging || !this.view.editable)
      return;
    const cell = e.target.closest?.(".hm-table-cell");
    if (!cell || !this.table.contains(cell))
      return;
    const t = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    if (this.hover?.row === t.row && this.hover.col === t.col)
      return;
    this.hover = t;
    this.positionChrome();
  }
  positionChrome() {
    const show = this.view.editable;
    const row = this.picked?.kind === "row" ? this.picked.index : this.hover?.row;
    const col = this.picked?.kind === "col" ? this.picked.index : this.hover?.col;
    const wrapRect = this.wrap.getBoundingClientRect();
    const innerRect = this.inner.getBoundingClientRect();
    const tr = row === undefined ? null : this.table.rows[row];
    if (show && tr) {
      const r = tr.getBoundingClientRect();
      this.rowHandle.style.top = `${r.top - wrapRect.top + r.height / 2}px`;
      this.rowHandle.dataset.index = String(row);
      this.rowHandle.classList.add("hm-table-handle-on");
    } else {
      this.rowHandle.classList.remove("hm-table-handle-on");
    }
    const th = col === undefined ? null : this.cellEl({ row: 0, col });
    if (show && th) {
      const r = th.getBoundingClientRect();
      this.colHandle.style.left = `${r.left - innerRect.left + r.width / 2}px`;
      this.colHandle.dataset.index = String(col);
      this.colHandle.classList.add("hm-table-handle-on");
    } else {
      this.colHandle.classList.remove("hm-table-handle-on");
    }
    this.rowHandle.classList.toggle("hm-table-handle-picked", this.picked?.kind === "row");
    this.colHandle.classList.toggle("hm-table-handle-picked", this.picked?.kind === "col");
    this.positionMenu();
  }
  get pickedRange() {
    return this.picked;
  }
  pick(p, focus = true) {
    if (p) {
      const max = p.kind === "row" ? this.rowCount : this.colCount;
      if (p.index < 0 || p.index >= max)
        p = null;
    }
    this.picked = p;
    for (const cell of this.table.querySelectorAll(".hm-table-cell")) {
      const on = !!p && Number(p.kind === "row" ? cell.dataset.row : cell.dataset.col) === p.index;
      cell.classList.toggle("hm-table-cell-picked", on);
    }
    this.wrap.classList.toggle("hm-table-picking", !!p);
    if (p) {
      if (this.editing) {
        this.endEdit();
        this.unfreezeColumns();
      }
      this.showMenu(p);
      if (focus)
        this.wrap.focus({ preventScroll: true });
    } else {
      this.menu?.remove();
      this.menu = null;
    }
    this.positionChrome();
  }
  showMenu(p) {
    this.menu?.remove();
    const menu = document.createElement("div");
    menu.className = "hm-table-ui hm-table-menu";
    menu.setAttribute("role", "toolbar");
    const { index } = p;
    const last = (p.kind === "row" ? this.rowCount : this.colCount) - 1;
    const items = p.kind === "row" ? [
      ["上方插入", () => this.structural((s) => insertTableRow(s, index), { edit: { row: index, col: 0 } })],
      ["下方插入", () => this.structural((s) => insertTableRow(s, index + 1), { edit: { row: index + 1, col: 0 } })],
      "sep",
      ["上移", () => this.moveRow(index, index - 1), index === 0],
      ["下移", () => this.moveRow(index, index + 1), index === last],
      "sep",
      ["删除行", () => this.deletePicked()]
    ] : [
      ["左侧插入", () => this.structural((s) => insertTableColumn(s, index), { edit: { row: 0, col: index } })],
      ["右侧插入", () => this.structural((s) => insertTableColumn(s, index + 1), { edit: { row: 0, col: index + 1 } })],
      "sep",
      ["左移", () => this.moveCol(index, index - 1), index === 0],
      ["右移", () => this.moveCol(index, index + 1), index === last],
      "sep",
      ...["left", "center", "right"].map((a) => {
        const cur = this.model.align[index] ?? "none";
        const label = a === "left" ? "居左" : a === "center" ? "居中" : "居右";
        return [
          label,
          () => this.structural((s) => setTableColumnAlign(s, index, cur === a ? "none" : a), {
            pick: { kind: "col", index }
          }),
          false,
          cur === a
        ];
      }),
      "sep",
      ["删除列", () => this.deletePicked()]
    ];
    for (const item of items) {
      if (item === "sep") {
        const s = document.createElement("span");
        s.className = "hm-table-menu-sep";
        menu.appendChild(s);
        continue;
      }
      const [label, run, disabled, active] = item;
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.textContent = label;
      b.disabled = !!disabled;
      if (active)
        b.classList.add("hm-table-menu-active");
      if (label.startsWith("删除"))
        b.classList.add("hm-table-menu-danger");
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        run();
      });
      menu.appendChild(b);
    }
    this.wrap.appendChild(menu);
    this.menu = menu;
  }
  positionMenu() {
    const menu = this.menu;
    const p = this.picked;
    if (!menu || !p)
      return;
    const wrapRect = this.wrap.getBoundingClientRect();
    if (p.kind === "row") {
      const r = this.table.rows[p.index]?.getBoundingClientRect();
      if (!r)
        return;
      menu.style.left = "0px";
      menu.style.top = `${r.bottom - wrapRect.top + 6}px`;
    } else {
      const r = this.cellEl({ row: 0, col: p.index })?.getBoundingClientRect();
      if (!r)
        return;
      const max = Math.max(0, wrapRect.width - menu.offsetWidth);
      menu.style.left = `${Math.min(max, Math.max(0, r.left - wrapRect.left))}px`;
      menu.style.top = `${-menu.offsetHeight - 14}px`;
    }
  }
  onPickKey(e) {
    const p = this.picked;
    const mod = e.metaKey || e.ctrlKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const back = p.kind === "row" ? "ArrowUp" : "ArrowLeft";
    const fwd = p.kind === "row" ? "ArrowDown" : "ArrowRight";
    const first = p.kind === "row" ? { row: p.index, col: 0 } : { row: 0, col: p.index };
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      handled();
      const cmd = e.key === "y" || e.shiftKey ? redo : undo;
      this.pick(null, false);
      cmd(this.view.state, this.view.dispatch);
      this.view.focus();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      handled();
      this.deletePicked();
      return;
    }
    if (e.key === back || e.key === fwd) {
      handled();
      const to = p.index + (e.key === back ? -1 : 1);
      if (e.altKey) {
        if (p.kind === "row")
          this.moveRow(p.index, to);
        else
          this.moveCol(p.index, to);
      } else {
        this.pick({ kind: p.kind, index: to });
      }
      return;
    }
    if (e.key === "Enter" || e.key === "Escape") {
      handled();
      this.beginEdit(first, "end");
      return;
    }
    if (e.key === "Tab")
      handled();
  }
  onHandleDown(e, kind) {
    if (e.button !== 0 || !this.view.editable)
      return;
    const handle = e.currentTarget;
    const index = Number(handle.dataset.index);
    if (!Number.isFinite(index))
      return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4)
        return;
      if (!moved) {
        moved = true;
        this.dragging = true;
        this.wrap.classList.add("hm-table-dragging");
        this.pick({ kind, index });
      }
      if (kind === "col")
        this.autoScroll(ev.clientX);
      this.showDrop(kind, this.dropBoundary(kind, ev));
    };
    const onUp = (ev) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (!moved) {
        const same = this.picked?.kind === kind && this.picked.index === index;
        this.pick(same ? null : { kind, index });
        if (same)
          this.view.focus();
        return;
      }
      const boundary = this.dropBoundary(kind, ev);
      this.dragging = false;
      this.wrap.classList.remove("hm-table-dragging");
      this.dropLine.classList.remove("hm-table-drop-on");
      if (ev.type === "pointercancel")
        return;
      const to = boundary > index ? boundary - 1 : boundary;
      if (kind === "row")
        this.moveRow(index, to);
      else
        this.moveCol(index, to);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }
  dropBoundary(kind, ev) {
    const rects = kind === "row" ? Array.from(this.table.rows, (tr) => tr.getBoundingClientRect()) : Array.from({ length: this.colCount }, (_, c) => this.cellEl({ row: 0, col: c }).getBoundingClientRect());
    let b = 0;
    for (const r of rects) {
      const mid = kind === "row" ? r.top + r.height / 2 : r.left + r.width / 2;
      if ((kind === "row" ? ev.clientY : ev.clientX) > mid)
        b++;
    }
    return b;
  }
  showDrop(kind, boundary) {
    const innerRect = this.inner.getBoundingClientRect();
    const line = this.dropLine;
    line.classList.add("hm-table-drop-on");
    line.classList.toggle("hm-table-drop-col", kind === "col");
    if (kind === "row") {
      const rows = this.table.rows;
      const r = (rows[boundary] ?? rows[rows.length - 1]).getBoundingClientRect();
      const y = boundary < rows.length ? r.top : r.bottom;
      line.style.top = `${y - innerRect.top}px`;
      line.style.left = "0px";
    } else {
      const cell = this.cellEl({ row: 0, col: Math.min(boundary, this.colCount - 1) });
      const r = cell.getBoundingClientRect();
      const x = boundary < this.colCount ? r.left : r.right;
      line.style.left = `${x - innerRect.left}px`;
      line.style.top = "0px";
    }
  }
  autoScroll(clientX) {
    const r = this.scroller.getBoundingClientRect();
    const edge = 32;
    if (clientX > r.right - edge)
      this.scroller.scrollLeft += 12;
    else if (clientX < r.left + edge)
      this.scroller.scrollLeft -= 12;
  }
  currentSource() {
    const headerPos = this.headerPos();
    if (headerPos === null)
      return null;
    const doc = this.view.state.doc;
    const lines = tableLinePositions(doc, headerPos).map((p) => doc.nodeAt(p).textContent);
    if (lines.length < 2)
      return null;
    return splitTableSource(lines.join(`
`));
  }
  structural(op, after = {}) {
    const src = this.currentSource();
    const headerPos = this.headerPos();
    if (!src || headerPos === null || !this.view.editable)
      return;
    const next = op(src);
    if (!next) {
      this.deleteTable();
      return;
    }
    const doc = this.view.state.doc;
    const positions = tableLinePositions(doc, headerPos);
    const lastPos = positions[positions.length - 1];
    const end = lastPos + doc.nodeAt(lastPos).nodeSize;
    const { schema: schema2 } = this.view.state;
    const nodes = joinTableSource(next).map((l) => schema2.nodes.block.create(null, l ? schema2.text(l) : undefined));
    const tr = closeHistory(this.view.state.tr.replaceWith(headerPos, end, nodes));
    rebuilding = true;
    try {
      this.view.dispatch(tr);
    } finally {
      rebuilding = false;
    }
    const ctl = tableControllerAt(this.view, headerPos);
    if (!ctl)
      return;
    if (after.pick)
      ctl.pick(after.pick);
    else if (after.edit)
      focusTableCell(this.view, headerPos, after.edit, "end");
  }
  moveRow(from, to) {
    if (to < 0 || to >= this.rowCount || to === from)
      return;
    this.structural((s) => moveTableRow(s, from, to), { pick: { kind: "row", index: to } });
  }
  moveCol(from, to) {
    if (to < 0 || to >= this.colCount || to === from)
      return;
    this.structural((s) => moveTableColumn(s, from, to), { pick: { kind: "col", index: to } });
  }
  deletePicked() {
    const p = this.picked;
    if (!p)
      return;
    const remaining = (p.kind === "row" ? this.rowCount : this.colCount) - 1;
    const next = remaining > 0 ? { kind: p.kind, index: Math.min(p.index, remaining - 1) } : undefined;
    this.structural((s) => p.kind === "row" ? deleteTableRow(s, p.index) : deleteTableColumn(s, p.index), { pick: next });
  }
  appendRow() {
    const row = this.rowCount;
    this.structural((s) => insertTableRow(s, row), { edit: { row, col: 0 } });
  }
  appendColumn() {
    const col = this.colCount;
    this.structural((s) => insertTableColumn(s, col), { edit: { row: 0, col } });
  }
  exit(dir) {
    const headerPos = this.headerPos();
    if (headerPos === null)
      return;
    const view = this.view;
    const doc = view.state.doc;
    let tr = view.state.tr;
    let caret;
    if (dir === "before") {
      if (headerPos === 0) {
        tr = tr.insert(0, view.state.schema.nodes.block.create());
        caret = 1;
      } else {
        caret = headerPos - 1;
      }
    } else {
      const lines = tableLinePositions(doc, headerPos);
      const lastPos = lines[lines.length - 1] ?? headerPos;
      const end = lastPos + doc.nodeAt(lastPos).nodeSize;
      if (end >= doc.content.size) {
        tr = tr.insert(end, view.state.schema.nodes.block.create());
      }
      caret = end + 1;
    }
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
    this.endEdit();
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }
}
function setCellTransaction(view, headerPos, t, newRaw, colCount) {
  const { state } = view;
  const lines = tableLinePositions(state.doc, headerPos);
  const linePos = lines[lineIndexOfRow(t.row)];
  if (linePos === undefined)
    return null;
  const node = state.doc.nodeAt(linePos);
  const text = node.textContent;
  const parsed = parseTableRow(text);
  const start = linePos + 1;
  const cell = parsed.cells[t.col];
  if (cell)
    return state.tr.insertText(newRaw, start + cell.from, start + cell.to);
  const cells = parsed.cells.map((c) => c.text);
  while (cells.length < Math.max(colCount, t.col + 1))
    cells.push(emptyCellText());
  cells[t.col] = newRaw;
  return state.tr.insertText(formatTableRow(cells), start, start + text.length);
}
function tableControllerAt(view, headerPos) {
  let dom = null;
  try {
    dom = view.nodeDOM(headerPos);
  } catch {
    return null;
  }
  const wrap = dom?.querySelector?.(".hm-table-wrap");
  return wrap?.[CONTROLLER] ?? null;
}
function focusTableCell(view, headerPos, target, caret = "end") {
  const ctl = tableControllerAt(view, headerPos);
  if (!ctl)
    return false;
  const row = Math.max(0, Math.min(target.row, ctl.rowCount - 1));
  const col = Math.max(0, Math.min(target.col, ctl.colCount - 1));
  return ctl.beginEdit({ row, col }, caret);
}
function buildTableWidget(view, getPos, src, opts) {
  return new TableController(view, getPos, parseTableModel(src), opts).wrap;
}
function redirectSelectionIntoTable(view) {
  const sel = view.state.selection;
  if (!sel.empty)
    return false;
  const $pos = sel.$from;
  if ($pos.depth !== 1 || !$pos.parent.textContent.includes("|"))
    return false;
  const doc = view.state.doc;
  const blockPos = $pos.before();
  let headerPos = null;
  let lineIdx = -1;
  let pos = blockPos;
  for (let steps = 0;steps < 1e4; steps++) {
    const lines = tableLinePositions(doc, pos);
    if (lines.length >= 2) {
      const idx = lines.indexOf(blockPos);
      if (idx >= 0) {
        headerPos = pos;
        lineIdx = idx;
      }
      break;
    }
    if (pos === 0)
      break;
    const prev = doc.resolve(pos).nodeBefore;
    if (!prev || !prev.textContent.includes("|"))
      break;
    pos -= prev.nodeSize;
  }
  if (headerPos === null)
    return false;
  const row = lineIdx <= 1 ? 0 : lineIdx - 1;
  const text = $pos.parent.textContent;
  const offset = $pos.parentOffset;
  const cells = parseTableRow(text).cells;
  let col = cells.findIndex((c) => offset >= c.from && offset <= c.to);
  if (col < 0)
    col = offset <= (cells[0]?.from ?? 0) ? 0 : Math.max(0, cells.length - 1);
  const cell = cells[col];
  let caret = "end";
  if (cell && lineIdx !== 1) {
    const lead = cell.text.startsWith(" ") ? 1 : 0;
    const len = cellDisplaySource(cell.text).length;
    caret = Math.max(0, Math.min(len, offset - cell.from - lead));
  }
  return focusTableCell(view, headerPos, { row, col }, caret);
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
function setImageSrc(img, src, resolve) {
  if (!resolve) {
    img.src = src;
    return;
  }
  let out;
  try {
    out = resolve(src);
  } catch {
    img.src = src;
    return;
  }
  if (typeof out === "string") {
    img.src = out;
    return;
  }
  img.classList.add("hm-image-loading");
  out.then((url) => {
    img.classList.remove("hm-image-loading");
    img.src = url;
  }, () => {
    img.classList.remove("hm-image-loading");
    img.src = src;
  });
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
      case "image": {
        concealSpan(el, { from: el.from, to: el.to }, out);
        const href = el.attrs?.href ?? "";
        const alt = el.attrs?.alt ?? "";
        const resolveImage = ctx?.resolveImage;
        widget(el, el.from, `img:${rev ? 1 : 0}:${href}\x00${alt}`, () => {
          const img = document.createElement("img");
          img.className = rev ? "hm-image hm-image-selected" : "hm-image";
          img.alt = alt;
          img.draggable = false;
          img.dataset.src = href;
          setImageSrc(img, href, resolveImage);
          return img;
        }, out, -1);
        break;
      }
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
      case "tableHeader": {
        nodeDeco(block, el, false, "hm-table hm-table-host", out);
        const lineFrom = block.pos + 1;
        concealSpan(el, { from: lineFrom, to: lineFrom + block.text.length }, out);
        const src = el.attrs?.tableSrc ?? block.text;
        const onOpenLink = ctx?.onOpenLink;
        out.push(Decoration.widget(lineFrom, (view, getPos) => buildTableWidget(view, getPos, src, { onOpenLink }), {
          key: `tbl:${src}`,
          side: -1,
          ignoreSelection: true,
          stopEvent: () => true,
          ...spec(el, "widget", true)
        }));
        break;
      }
      case "tableRow":
      case "tableSep":
        nodeDeco(block, el, false, "hm-table hm-table-hidden", out);
        concealSpan(el, { from: block.pos + 1, to: block.pos + 1 + block.text.length }, out);
        break;
      case "tableCell":
        break;
    }
  });
  return out;
}

// src/conceal/plugin.ts
var concealKey = new PluginKey("handymd-conceal");
function computeAll(doc, sel, readOnly, composing, ctx, source) {
  const blocks = parseDoc(doc);
  const sigs = [];
  const all = [];
  if (source) {
    return { set: DecorationSet.empty, blocks, sigs: blocks.map(() => ""), composing, stale: false, readOnly, source };
  }
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
    readOnly,
    source
  };
}
function contentReusable(a, b) {
  if (a.text !== b.text)
    return false;
  if (!lineInfoEqual(a.line, b.line))
    return false;
  const tableA = a.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs;
  const tableB = b.elements.find((e) => e.kind === "tableHeader" || e.kind === "tableRow" || e.kind === "tableSep")?.attrs;
  if (tableA?.tableEdge !== tableB?.tableEdge)
    return false;
  if (tableA?.tableSrc !== tableB?.tableSrc)
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
  if (prev.source) {
    return { ...prev, blocks: newBlocks, sigs: newBlocks.map(() => ""), composing, readOnly, stale: false };
  }
  const newToOld = new Array(newBlocks.length).fill(null);
  for (let j = 0;j < prev.blocks.length; j++) {
    const mapped = tr.mapping.mapResult(prev.blocks[j].pos, 1);
    if (mapped.deleted)
      continue;
    const i = findBlockAt(newBlocks, mapped.pos);
    if (i < 0)
      continue;
    if (newToOld[i] !== null) {
      return computeAll(nextDoc, sel, readOnly, composing, ctx, false);
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
    readOnly,
    source: false
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
  if (prev.source)
    return prev;
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
  const ctx = {
    renderDiagram: options.renderDiagram,
    onOpenLink: options.onOpenLink,
    resolveImage: options.resolveImage
  };
  return new Plugin({
    key: concealKey,
    state: {
      init: (_config, state) => computeAll(state.doc, state.selection, options.readOnly ?? false, false, ctx, options.source ?? false),
      apply: (tr, prev, old, next) => {
        let { composing, readOnly, source } = prev;
        let refresh = false;
        let modeChanged = false;
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
            modeChanged = true;
          }
          if (meta.source !== undefined && meta.source !== source) {
            source = meta.source;
            refresh = true;
            modeChanged = true;
          }
          if (meta.refresh)
            refresh = true;
        }
        if (composing && !modeChanged) {
          return {
            ...prev,
            composing,
            readOnly,
            source,
            stale: prev.stale || tr.docChanged,
            set: tr.docChanged ? prev.set.map(tr.mapping, tr.doc) : prev.set
          };
        }
        if (refresh || prev.stale) {
          return computeAll(next.doc, next.selection, readOnly, composing, ctx, source);
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
    },
    view: () => ({
      update(view, prev) {
        const st = concealKey.getState(view.state);
        if (!st || st.source || st.readOnly || st.composing)
          return;
        if (prev.selection.eq(view.state.selection) && prev.doc.eq(view.state.doc))
          return;
        if (!view.hasFocus())
          return;
        redirectSelectionIntoTable(view);
      }
    })
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
import { Plugin as Plugin3, TextSelection as TextSelection2 } from "prosemirror-state";
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
  if (!st || st.readOnly || st.source || !view.editable)
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
    view.dispatch(view.state.tr.setSelection(TextSelection2.create(view.state.doc, end)));
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
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!coords)
            return false;
          const st = concealKey.getState(view.state);
          if (!st || st.source)
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
            view.dispatch(view.state.tr.setSelection(TextSelection2.create(view.state.doc, coords.pos)));
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
import { Plugin as Plugin5, TextSelection as TextSelection5 } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";

// src/caret.ts
import { Plugin as Plugin4, TextSelection as TextSelection3 } from "prosemirror-state";
function isProtectedPrefix(el) {
  if (el.scope !== "block" || !el.markers.length)
    return false;
  return el.permanent === true || el.kind === "heading";
}
function permanentPrefixAt(state, blockPos) {
  const st = concealKey.getState(state);
  if (!st || st.source)
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
function escapeAt(state, pos) {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 1)
    return pos;
  return escapeProtectedMarker(state, $pos.before(), pos) ?? pos;
}
function caretGuardPlugin() {
  return new Plugin4({
    appendTransaction(_trs, _old, newState) {
      const sel = newState.selection;
      if (!(sel instanceof TextSelection3))
        return null;
      const st = concealKey.getState(newState);
      if (!st || st.composing || st.source)
        return null;
      const anchor = escapeAt(newState, sel.anchor);
      const head = escapeAt(newState, sel.head);
      if (anchor === sel.anchor && head === sel.head)
        return null;
      return newState.tr.setSelection(TextSelection3.create(newState.doc, anchor, head));
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (from === to)
          return false;
        const st = concealKey.getState(view.state);
        if (!st || st.composing || st.source)
          return false;
        const start = escapeAt(view.state, from);
        if (start === from || start > to)
          return false;
        view.dispatch(view.state.tr.insertText(text, start, to));
        return true;
      }
    }
  });
}

// src/table.ts
import { TextSelection as TextSelection4 } from "prosemirror-state";
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
    tr = tr.setSelection(TextSelection4.create(tr.doc, caret));
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
          dispatch(state.tr.setSelection(TextSelection4.create(state.doc, cellCaretPos(state, cells[idx]))).scrollIntoView());
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
        dispatch(state.tr.setSelection(TextSelection4.create(state.doc, cellCaretPos(state, cells[idx]))).scrollIntoView());
      }
      return true;
    }
    const next = idx + dir;
    if (next < 0 || next >= cells.length)
      return false;
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection4.create(state.doc, cellCaretPos(state, cells[next]))).scrollIntoView());
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
    tr = tr.setSelection(TextSelection4.create(tr.doc, at + 1 + caretOffset));
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
function freshPrefix(line, text) {
  switch (line.t) {
    case "todo": {
      const bullet = text[line.indent] ?? "-";
      return `${" ".repeat(line.indent)}${bullet} [ ] `;
    }
    case "ordered":
      return text.slice(0, line.prefixLen);
    case "bullet":
    case "quote":
      return text.slice(0, line.prefixLen);
    default:
      return null;
  }
}
var SPLITTABLE_INLINE = new Set(["strong", "em", "strike", "mark", "code"]);
function inlineSplitAt(state, blockPos, pos) {
  const st = concealKey.getState(state);
  const block = st?.blocks.find((b) => b.pos === blockPos);
  const els = (block?.elements ?? []).filter((el) => SPLITTABLE_INLINE.has(el.kind) && el.content && el.markers.length === 2).sort((a, b) => a.from - b.from || b.to - a.to);
  let at = pos;
  for (const el of els) {
    const c = el.content;
    if (at > el.from && at <= c.from)
      at = el.from;
    else if (at >= c.to && at < el.to)
      at = el.to;
  }
  const enclosing = els.filter((el) => el.content.from < at && at < el.content.to);
  const doc = state.doc;
  const open = enclosing.map((el) => doc.textBetween(el.markers[0].from, el.markers[0].to)).join("");
  const close = enclosing.slice().reverse().map((el) => doc.textBetween(el.markers[1].from, el.markers[1].to)).join("");
  return { at, close, open };
}
function splitLine(state, prefix) {
  const { empty, from } = state.selection;
  let tr = state.tr;
  let at;
  let close = "";
  let open = "";
  let caretShift = 0;
  if (empty) {
    const r = inlineSplitAt(state, state.selection.$from.before(), from);
    at = r.at;
    close = r.close;
    open = r.open;
    caretShift = Math.max(0, from - at);
  } else {
    tr = tr.deleteSelection();
    at = tr.selection.from;
  }
  if (close)
    tr = tr.insertText(close, at);
  at += close.length;
  tr = tr.split(at);
  const lineStart = at + 2;
  if (prefix || open)
    tr = tr.insertText(prefix + open, lineStart);
  tr = tr.setSelection(TextSelection5.create(tr.doc, lineStart + prefix.length + open.length + caretShift));
  return tr.scrollIntoView();
}
function needsInlineSplit(state) {
  const { empty, from, $from } = state.selection;
  if (!empty)
    return false;
  const r = inlineSplitAt(state, $from.before(), from);
  return r.at !== from || r.close !== "";
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
        tr.setSelection(TextSelection5.create(tr.doc, blockPos + 1));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (dispatch)
      dispatch(splitLine(state, ""));
    return true;
  }
  if (line.t === "para") {
    if (!needsInlineSplit(state))
      return false;
    if (dispatch)
      dispatch(splitLine(state, ""));
    return true;
  }
  const prefix = continuationPrefix(line, text);
  if (prefix === null)
    return false;
  if (empty && contentEmpty) {
    const indent = line.indent ?? 0;
    if (indent > 0)
      return dedentListItem(state, dispatch);
    if (dispatch) {
      const start = blockPos + 1;
      dispatch(state.tr.delete(start, start + text.length).scrollIntoView());
    }
    return true;
  }
  if (atContentStart) {
    const above = freshPrefix(line, text);
    if (above !== null) {
      if (dispatch) {
        const node = schema.nodes.block.create(null, schema.text(above));
        const tr = state.tr.insert(blockPos, node);
        tr.setSelection(TextSelection5.create(tr.doc, blockPos + node.nodeSize + 1 + prefixLen));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
  }
  if (dispatch)
    dispatch(splitLine(state, prefix));
  return true;
};
var splitWithoutPrefix = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.depth !== 1)
    return false;
  const line = lineInfoAt(state, $from.before());
  if (!line)
    return false;
  if (!["para", "heading", "quote", "bullet", "ordered", "todo", "blank"].includes(line.t)) {
    return false;
  }
  if (dispatch)
    dispatch(splitLine(state, ""));
  return true;
};
var FENCE_OPENER_WITH_INFO = /^ {0,3}(`{3,}|~{3,})\S/;
var closeFenceOnEnter = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  const st = concealKey.getState(state);
  if (!st)
    return false;
  const idx = st.blocks.findIndex((b) => b.pos === $from.before());
  if (idx < 0)
    return false;
  const block = st.blocks[idx];
  const line = block.line;
  if (line.t !== "fenceOpen" && line.t !== "diagramOpen")
    return false;
  if ($from.parentOffset !== block.text.length)
    return false;
  const bodyT = line.t === "fenceOpen" ? "code" : "diagramLine";
  const closeT = line.t === "fenceOpen" ? "fenceClose" : "diagramClose";
  let j = idx + 1;
  let stealsOtherFence = false;
  while (j < st.blocks.length && st.blocks[j].line.t === bodyT) {
    if (FENCE_OPENER_WITH_INFO.test(st.blocks[j].text))
      stealsOtherFence = true;
    j++;
  }
  const closed = j < st.blocks.length && st.blocks[j].line.t === closeT;
  if (closed && !stealsOtherFence)
    return false;
  if (dispatch) {
    const fence = block.text.slice(0, line.tickStart + line.tickLen);
    const after = block.pos + block.size;
    const tr = state.tr.insert(after, [
      schema.nodes.block.create(),
      schema.nodes.block.create(null, schema.text(fence))
    ]);
    tr.setSelection(TextSelection5.create(tr.doc, after + 1));
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
        tr2 = tr2.setSelection(TextSelection5.create(tr2.doc, from + len));
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
      tr = tr.setSelection(TextSelection5.create(tr.doc, from, from + inner.length));
    } else if (from - blockStart >= len && blockEnd - to >= len && doc.textBetween(from - len, from) === marker && doc.textBetween(to, to + len) === marker) {
      tr = state.tr.delete(to, to + len).delete(from - len, from);
      tr = tr.setSelection(TextSelection5.create(tr.doc, from - len, to - len));
    } else {
      tr = state.tr.insertText(marker + selText + marker, from, to);
      tr = tr.setSelection(TextSelection5.create(tr.doc, from + len, from + len + selText.length));
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
  const blockPos = $from.before();
  const st = concealKey.getState(state);
  const line = lineInfoAt(state, blockPos);
  if (st && !st.source && line?.t === "ordered") {
    if ($from.parentOffset !== line.prefixLen)
      return false;
    if (line.indent > 0)
      return dedentListItem(state, dispatch);
    if (dispatch)
      dispatch(state.tr.delete(blockPos + 1, blockPos + 1 + line.prefixLen));
    return true;
  }
  const hit = permanentPrefixAt(state, blockPos);
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
  if ((hit.el.attrs?.indent ?? 0) > 0)
    return dedentListItem(state, dispatch);
  if (hit.el.kind === "heading" && hit.block.pos > 0) {
    const prev = state.doc.resolve(hit.block.pos).nodeBefore;
    if (prev && prev.content.size === 0) {
      if (dispatch)
        dispatch(state.tr.delete(hit.block.pos - prev.nodeSize, hit.block.pos));
      return true;
    }
  }
  if (dispatch)
    dispatch(state.tr.delete(m.from, m.to));
  return true;
};
var deleteForwardStripPrefix = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1)
    return false;
  if ($from.parentOffset !== $from.parent.content.size)
    return false;
  const st = concealKey.getState(state);
  if (!st || st.source)
    return false;
  const nextPos = $from.after();
  if (nextPos >= state.doc.content.size)
    return false;
  const next = st.blocks.find((b) => b.pos === nextPos);
  if (!next)
    return false;
  if (next.line.t === "hr") {
    if (dispatch)
      dispatch(state.tr.delete(nextPos, nextPos + next.size));
    return true;
  }
  if (!["heading", "quote", "bullet", "ordered", "todo"].includes(next.line.t))
    return false;
  const prefixLen = next.line.prefixLen;
  if (dispatch)
    dispatch(state.tr.delete($from.pos, nextPos + 1 + prefixLen));
  return true;
};
var TABLE_LINE_TYPES = new Set(["tableHeader", "tableSep", "tableRow"]);
function joinTowardTable(dir) {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth !== 1)
      return false;
    const atEdge = dir < 0 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
    if (!atEdge)
      return false;
    const st = concealKey.getState(state);
    if (!st || st.source)
      return false;
    const blockPos = $from.before();
    const i = st.blocks.findIndex((b) => b.pos === blockPos);
    const neighbor = st.blocks[i + dir];
    if (i < 0 || !neighbor || !TABLE_LINE_TYPES.has(neighbor.line.t))
      return false;
    if (!dispatch)
      return true;
    let tr = state.tr;
    const size = $from.parent.nodeSize;
    if ($from.parent.content.size === 0)
      tr = tr.delete(blockPos, blockPos + size);
    const target = dir < 0 ? neighbor.pos + 1 + neighbor.text.length : tr.mapping.map(neighbor.pos) + 1;
    dispatch(tr.setSelection(TextSelection5.create(tr.doc, target)).scrollIntoView());
    return true;
  };
}
var backspaceIntoTable = joinTowardTable(-1);
var deleteIntoTable = joinTowardTable(1);
var HEADING_PREFIX_RE = /^#{1,6} /;
var BLOCK_PREFIX_TYPES = new Set(["quote", "bullet", "ordered", "todo"]);
function setHeading(level) {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if ($from.depth !== 1 || !$from.sameParent($to))
      return false;
    const blockPos = $from.before();
    const line = lineInfoAt(state, blockPos);
    if (!line)
      return false;
    if (!["para", "blank", "heading", ...BLOCK_PREFIX_TYPES].includes(line.t))
      return false;
    const text = $from.parent.textContent;
    let strip = 0;
    if (line.t === "heading")
      strip = text.match(HEADING_PREFIX_RE)?.[0].length ?? 0;
    else if (BLOCK_PREFIX_TYPES.has(line.t))
      strip = line.prefixLen;
    const same = line.t === "heading" && line.level === level;
    const insert = same ? "" : `${"#".repeat(level)} `;
    if (dispatch) {
      const start = blockPos + 1;
      dispatch(state.tr.insertText(insert, start, start + strip).scrollIntoView());
    }
    return true;
  };
}
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
    dispatch(state.tr.setSelection(TextSelection5.create(state.doc, hit.block.pos - 1)));
  }
  return true;
};
var shiftArrowLeftSkipPrefix = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection5))
    return false;
  const $head = sel.$head;
  if ($head.depth !== 1)
    return false;
  const hit = permanentPrefixAt(state, $head.before());
  if (!hit)
    return false;
  if ($head.pos !== hit.el.markers[0].to)
    return false;
  if (hit.block.pos === 0)
    return true;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection5.create(state.doc, sel.anchor, hit.block.pos - 1)));
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
  if (concealKey.getState(state)?.source)
    return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection5.create(state.doc, blockPos - 1)));
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
var CODE_LINE_TYPES = new Set(["code", "diagramLine", "fenceOpen", "fenceClose", "diagramOpen", "diagramClose"]);
function blocksInSelection(state) {
  const { from, to } = state.selection;
  const out = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    out.push({ pos, text: node.textContent });
    return false;
  });
  return out;
}
var insertTab = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if ($from.depth !== 1)
    return false;
  const line = lineInfoAt(state, $from.before());
  if (!line)
    return false;
  if (line.t === "tableHeader" || line.t === "tableRow" || line.t === "tableSep")
    return true;
  if (CODE_LINE_TYPES.has(line.t)) {
    if (!dispatch)
      return true;
    if (empty) {
      dispatch(state.tr.insertText(INDENT).scrollIntoView());
      return true;
    }
    let tr = state.tr;
    for (const b of blocksInSelection(state).reverse())
      tr = tr.insertText(INDENT, b.pos + 1);
    dispatch(tr.scrollIntoView());
    return true;
  }
  if (dispatch)
    dispatch(state.tr.insertText("\t").scrollIntoView());
  return true;
};
var removeTab = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth !== 1)
    return false;
  const line = lineInfoAt(state, $from.before());
  if (!line)
    return false;
  if (!CODE_LINE_TYPES.has(line.t))
    return true;
  if (!dispatch)
    return true;
  let tr = state.tr;
  for (const b of blocksInSelection(state).reverse()) {
    const n = Math.min(b.text.length - b.text.trimStart().length, INDENT.length);
    if (n > 0)
      tr = tr.delete(b.pos + 1, b.pos + 1 + n);
  }
  if (tr.docChanged)
    dispatch(tr.scrollIntoView());
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
        tr = tr.setSelection(TextSelection5.create(tr.doc, hashInsert + 2));
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
      return continueTableRow(state, dispatch, view) || closeFenceOnEnter(state, dispatch, view) || continueListItem(state, dispatch, view);
    },
    "Shift-Enter": (state, dispatch, view) => {
      if (view?.composing)
        return true;
      return splitWithoutPrefix(state, dispatch, view);
    },
    Backspace: (state, dispatch, view) => backspaceBlockFormat(state, dispatch, view) || backspaceIntoTable(state, dispatch, view),
    Delete: (state, dispatch, view) => deleteIntoTable(state, dispatch, view) || deleteForwardStripPrefix(state, dispatch, view),
    ArrowLeft: arrowLeftSkipPrefix,
    "Shift-ArrowLeft": shiftArrowLeftSkipPrefix,
    ArrowUp: arrowUpToPrevContentEnd,
    "Mod-Backspace": deleteToContentStart,
    "Mod-Delete": deleteToContentEnd,
    "Mod-b": toggleInline("**"),
    "Mod-i": toggleInline("*"),
    "Mod-e": toggleInline("`"),
    "Mod-Shift-x": toggleInline("~~"),
    "Mod-Shift-h": toggleInline("=="),
    ...headingKeys,
    Tab: (state, dispatch, view) => goToNextTableCell(state, dispatch, view) || indentListItem(state, dispatch, view) || insertTab(state, dispatch, view),
    "Shift-Tab": (state, dispatch, view) => goToPrevTableCell(state, dispatch, view) || dedentListItem(state, dispatch, view) || removeTab(state, dispatch, view)
  });
}
var headingKeys = {};
for (let level = 1;level <= 6; level++) {
  headingKeys[`Mod-${level}`] = setHeading(level);
  headingKeys[`Mod-Alt-${level}`] = setHeading(level);
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

// src/clipboard.ts
import { Fragment, Slice } from "prosemirror-model";
import { Plugin as Plugin7 } from "prosemirror-state";
function markdownToSlice(markdown) {
  const lines = markdown.replace(/\r\n?/g, `
`).split(`
`);
  const blocks = lines.map((line) => schema.nodes.block.create(null, line ? schema.text(line) : undefined));
  return new Slice(Fragment.from(blocks), 1, 1);
}
var URL_RE = /^(https?:\/\/|mailto:)\S+$/i;
var BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "UL"
]);
var SKIP_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "TEMPLATE", "NOSCRIPT"]);
function isBlock(node) {
  return node.nodeType === 1 && BLOCK_TAGS.has(node.tagName);
}
function wrap(inner, marker, closer = marker) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2])
    return inner;
  return `${m[1]}${marker}${m[2]}${closer}${m[3]}`;
}
function styleOf(el) {
  return (el.getAttribute("style") ?? "").toLowerCase();
}
function inlineText(node) {
  if (node.nodeType === 3)
    return (node.textContent ?? "").replace(/[\s\u00a0]+/g, " ");
  if (node.nodeType !== 1)
    return "";
  const el = node;
  const tag = el.tagName;
  if (SKIP_TAGS.has(tag))
    return "";
  if (tag === "BR")
    return `
`;
  if (tag === "IMG") {
    const src = el.getAttribute("src") ?? "";
    return src ? `![${el.getAttribute("alt") ?? ""}](${src})` : "";
  }
  if (tag === "INPUT")
    return "";
  const inner = Array.from(el.childNodes).map(inlineText).join("");
  const style = styleOf(el);
  switch (tag) {
    case "STRONG":
      return wrap(inner, "**");
    case "B":
      return /font-weight:\s*(normal|[1-5]00)/.test(style) ? inner : wrap(inner, "**");
    case "EM":
    case "I":
      return wrap(inner, "*");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrap(inner, "~~");
    case "MARK":
      return wrap(inner, "==");
    case "CODE":
    case "KBD":
    case "SAMP":
      return inner.trim() ? wrap(inner, "`") : inner;
    case "A": {
      const href = el.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        return inner;
      const text = inner.trim();
      return text ? wrap(inner, "[", `](${href})`) : href;
    }
  }
  let out = inner;
  if (/font-weight:\s*(bold|[6-9]00)/.test(style))
    out = wrap(out, "**");
  if (/font-style:\s*italic/.test(style))
    out = wrap(out, "*");
  if (/text-decoration[^;]*line-through/.test(style))
    out = wrap(out, "~~");
  return out;
}
function codeLang(pre) {
  const code = pre.querySelector("code");
  const cls = `${code?.getAttribute("class") ?? ""} ${pre.getAttribute("class") ?? ""}`;
  return cls.match(/(?:language|lang)-([\w+#-]+)/)?.[1] ?? "";
}
function tableLines(table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length)
    return [];
  const cells = rows.map((tr) => Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => inlineText(c).replace(/\n/g, " ").trim().replace(/\|/g, "\\|")));
  const cols = Math.max(1, ...cells.map((r) => r.length));
  const fmt = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || " ").join(" | ")} |`;
  return [fmt(cells[0]), `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`, ...cells.slice(1).map(fmt)];
}
function blockGroups(parent, listIndent) {
  const groups = [];
  let inline = "";
  const flush = () => {
    const lines = inline.split(`
`).map((l) => l.trim()).filter((l, i, arr) => l || i > 0 && i < arr.length - 1);
    if (lines.some((l) => l))
      groups.push(lines);
    inline = "";
  };
  for (const child of Array.from(parent.childNodes)) {
    if (!isBlock(child)) {
      inline += inlineText(child);
      continue;
    }
    flush();
    const el = child;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = inlineText(el).replace(/\n/g, " ").trim();
      if (text)
        groups.push([`${"#".repeat(Number(tag[1]))} ${text}`]);
    } else if (tag === "HR") {
      groups.push(["---"]);
    } else if (tag === "PRE") {
      const code = (el.textContent ?? "").replace(/\n$/, "");
      groups.push(["```" + codeLang(el), ...code.split(`
`), "```"]);
    } else if (tag === "TABLE") {
      const lines = tableLines(el);
      if (lines.length)
        groups.push(lines);
    } else if (tag === "UL" || tag === "OL") {
      groups.push(listLines(el, listIndent));
    } else if (tag === "BLOCKQUOTE") {
      const inner = blockGroups(el, "");
      const lines = [];
      inner.forEach((g, i) => {
        if (i)
          lines.push(">");
        for (const l of g)
          lines.push(l ? `> ${l}` : ">");
      });
      if (lines.length)
        groups.push(lines);
    } else {
      groups.push(...blockGroups(el, listIndent));
    }
  }
  flush();
  return groups;
}
function listLines(list, indent) {
  const ordered = list.tagName === "OL";
  let n = Number(list.getAttribute("start") ?? "1") || 1;
  const out = [];
  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI")
      continue;
    const box = li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    const marker = box ? `- [${box.checked || box.hasAttribute("checked") ? "x" : " "}] ` : ordered ? `${n++}. ` : "- ";
    const groups = blockGroups(li, indent + "  ");
    const lines = groups.flat().filter((l) => l !== "");
    const nestedStart = (l) => l.startsWith(indent + "  ");
    if (!lines.length || nestedStart(lines[0]))
      out.push(indent + marker.trimEnd() + " ");
    lines.forEach((l, i) => {
      if (i === 0 && !nestedStart(l))
        out.push(indent + marker + l);
      else
        out.push(l);
    });
  }
  return out;
}
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const groups = blockGroups(doc.body, "");
  return groups.map((g) => g.join(`
`)).join(`

`);
}
function looksLikeCodeClipboard(data, html) {
  if (Array.from(data.types).includes("vscode-editor-data"))
    return true;
  return /white-space:\s*pre/i.test(html.slice(0, 2000));
}
function inCodeLine(state) {
  const st = concealKey.getState(state);
  const $from = state.selection.$from;
  if (!st || $from.depth !== 1)
    return false;
  const t = st.blocks.find((b) => b.pos === $from.before())?.line.t;
  return t === "code" || t === "diagramLine" || t === "fenceOpen" || t === "diagramOpen";
}
function clipboardPlugin() {
  return new Plugin7({
    props: {
      clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, `
`),
      clipboardTextParser: (text) => markdownToSlice(text),
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data)
          return false;
        const text = data.getData("text/plain");
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty && sel.$from.sameParent(sel.$to) && URL_RE.test(text.trim())) {
          const label = state.doc.textBetween(sel.from, sel.to);
          if (!label.includes(`
`) && !inCodeLine(state)) {
            view.dispatch(state.tr.insertText(`[${label}](${text.trim()})`).scrollIntoView());
            return true;
          }
        }
        const html = data.getData("text/html");
        if (!html || html.includes("data-pm-slice"))
          return false;
        if (looksLikeCodeClipboard(data, html) || inCodeLine(state)) {
          if (!text)
            return false;
          view.dispatch(state.tr.replaceSelection(markdownToSlice(text)).scrollIntoView());
          return true;
        }
        const md = htmlToMarkdown(html);
        if (!md.trim())
          return false;
        view.dispatch(state.tr.replaceSelection(markdownToSlice(md)).scrollIntoView());
        return true;
      }
    }
  });
}

// src/highlight.ts
import { Plugin as Plugin8, PluginKey as PluginKey2 } from "prosemirror-state";
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
  return new Plugin8({
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

// src/export.ts
var PRINT_CSS = `
@page { margin: 16mm 14mm; }
html, body { margin: 0; padding: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hm-print .ProseMirror {
  padding: 0 !important; margin: 0 !important; min-height: 0 !important;
  height: auto !important; max-height: none !important; overflow: visible !important;
  outline: none !important;
}
.hm-print .hm-table-ui { display: none !important; }
.hm-print .hm-table-scroll { overflow: visible !important; margin: 0 !important; padding: 0 !important; }
.hm-print .hm-table-inner { width: auto !important; }
.hm-print .hm-table-grid .hm-table-cell { min-width: 0 !important; }
.hm-print .hm-diagram { cursor: default; overflow: visible; }
.hm-print tr, .hm-print img.hm-image, .hm-print .hm-diagram { break-inside: avoid; }
.hm-print .hm-heading { break-after: avoid; }
`;
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(done, timeout) {
  const until = Date.now() + timeout;
  while (!done() && Date.now() < until)
    await delay(50);
}
function firstHeading(view) {
  let title = "";
  view.state.doc.forEach((node) => {
    if (title)
      return;
    const m = node.textContent.match(/^#{1,6}\s+(.+)$/);
    if (m)
      title = m[1].trim();
  });
  return title;
}
function printableClone(dom) {
  const clone = dom.cloneNode(true);
  const boxes = dom.querySelectorAll('input[type="checkbox"]');
  clone.querySelectorAll('input[type="checkbox"]').forEach((box, i) => {
    box.toggleAttribute("checked", !!boxes[i]?.checked);
  });
  for (const el of clone.querySelectorAll(".hm-table-ui, .ProseMirror-separator"))
    el.remove();
  for (const cell of clone.querySelectorAll(".hm-table-cell-editing")) {
    cell.replaceChildren(renderCellPreview(cellSourceFromInput(cell.textContent ?? "")));
  }
  for (const el of [clone, ...clone.querySelectorAll("*")]) {
    el.removeAttribute("contenteditable");
    el.removeAttribute("tabindex");
    el.removeAttribute("spellcheck");
    el.classList.remove("hm-table-cell-editing", "hm-table-cell-picked", "hm-table-picking", "hm-image-selected", "ProseMirror-focused");
  }
  return clone;
}
function themeVariables(mount) {
  const names = new Set;
  const scan = (text) => {
    for (const m of text.matchAll(/--hm-[\w-]+/g))
      names.add(m[0]);
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules))
        scan(rule.cssText);
    } catch {}
  }
  const cs = getComputedStyle(mount);
  const out = [];
  for (const name of names) {
    const v = cs.getPropertyValue(name).trim();
    if (v)
      out.push(`${name}: ${v}`);
  }
  return out.join("; ");
}
function pageBackground(el) {
  for (let n = el;n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg))
      return bg;
  }
  return "#fff";
}
var escapeHTML = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function buildPrintDocument(view, options = {}) {
  const mount = view.dom.parentElement ?? view.dom;
  const title = options.title ?? (firstHeading(view) || document.title || "Untitled");
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((el) => {
    if (el instanceof HTMLLinkElement)
      return `<link rel="stylesheet" href="${escapeHTML(el.href)}">`;
    return el.outerHTML;
  }).join(`
`);
  const classes = Array.from(mount.classList).filter((c) => c !== "hm-source");
  if (!classes.includes("handymd"))
    classes.push("handymd");
  classes.push("hm-print");
  const bg = pageBackground(mount);
  return [
    "<!doctype html>",
    `<html class="${escapeHTML(document.documentElement.className)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<base href="${escapeHTML(document.baseURI)}">`,
    `<title>${escapeHTML(title)}</title>`,
    styles,
    `<style>${PRINT_CSS}
html, body { background: ${bg}; }
${options.css ?? ""}</style>`,
    "</head>",
    `<body class="${escapeHTML(document.body.className)}">`,
    `<div class="${escapeHTML(classes.join(" "))}" style="${escapeHTML(themeVariables(mount))}">`,
    printableClone(view.dom).outerHTML,
    "</div>",
    "</body>",
    "</html>"
  ].join(`
`);
}
async function settle(doc, timeout) {
  const once = (el) => new Promise((r) => {
    el.addEventListener("load", () => r(), { once: true });
    el.addEventListener("error", () => r(), { once: true });
  });
  const waits = [];
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (!link.sheet)
      waits.push(once(link));
  }
  for (const img of doc.querySelectorAll("img"))
    if (!img.complete)
      waits.push(once(img));
  if (doc.fonts?.ready)
    waits.push(doc.fonts.ready);
  await Promise.race([Promise.all(waits), delay(timeout)]);
}
async function exportToPDF(view, options = {}) {
  const timeout = options.timeout ?? 8000;
  const st = concealKey.getState(view.state);
  let restore = null;
  if (st && (!st.readOnly || st.source)) {
    restore = { readOnly: st.readOnly, source: st.source };
    view.dispatch(view.state.tr.setMeta(concealKey, { readOnly: true, source: false }));
  }
  let html;
  try {
    await waitUntil(() => !view.dom.querySelector(".hm-diagram-loading, img.hm-image-loading"), timeout);
    html = buildPrintDocument(view, options);
  } finally {
    if (restore && !view.isDestroyed)
      view.dispatch(view.state.tr.setMeta(concealKey, restore));
  }
  for (const old of document.querySelectorAll("iframe[data-hm-print]"))
    old.remove();
  const iframe = document.createElement("iframe");
  iframe.dataset.hmPrint = "";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    throw new Error("[handymd] exportToPDF: cannot create print frame");
  }
  doc.open();
  doc.write(html);
  doc.close();
  await settle(doc, timeout);
  const prevTitle = document.title;
  document.title = doc.title;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned)
      return;
    cleaned = true;
    document.title = prevTitle;
    iframe.remove();
  };
  win.addEventListener("afterprint", () => setTimeout(cleanup, 0), { once: true });
  try {
    win.focus();
    await (options.print ?? ((w) => w.print()))(win);
  } finally {
    if (options.print)
      cleanup();
  }
}

// src/image.ts
import { Plugin as Plugin9, TextSelection as TextSelection6 } from "prosemirror-state";
function escapeAlt(alt) {
  return alt.replace(/[\[\]\r\n]/g, " ").trim();
}
function escapeSrc(src) {
  return src.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}
function imageMarkdown({ src, alt = "" }) {
  return `![${escapeAlt(alt)}](${escapeSrc(src)})`;
}
function altFromFileName(name) {
  return name.replace(/\.[^.]+$/, "");
}
function insertImage(options) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth !== 1 || !options.src)
      return false;
    if (!dispatch)
      return true;
    const md = imageMarkdown(options);
    dispatch(insertImageLines(state, [md]).scrollIntoView());
    return true;
  };
}
function insertImageLines(state, lines) {
  const { $from } = state.selection;
  const block = $from.parent;
  const blockPos = $from.before();
  let tr = state.tr;
  let at;
  if (block.content.size === 0) {
    tr = tr.delete(blockPos, blockPos + block.nodeSize);
    at = blockPos;
  } else {
    at = blockPos + block.nodeSize;
  }
  for (const line of lines) {
    const node = schema.nodes.block.create(null, schema.text(line));
    tr = tr.insert(at, node);
    at += node.nodeSize;
  }
  const next = tr.doc.nodeAt(at);
  if (!next || next.content.size > 0)
    tr = tr.insert(at, schema.nodes.block.create());
  return tr.setSelection(TextSelection6.create(tr.doc, at + 1));
}
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader;
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
var placeholderSeq = 0;
function placeholderSrc(file) {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const src = URL.createObjectURL(file);
      return { src, revoke: () => URL.revokeObjectURL(src) };
    } catch {}
  }
  return { src: `uploading:${++placeholderSeq}`, revoke: () => {} };
}
function replacePlaceholder(view, placeholder, replacement) {
  const { doc } = view.state;
  let found = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText)
      return !found;
    const text = node.text ?? "";
    const idx = text.indexOf(`](${placeholder})`);
    if (idx < 0)
      return false;
    const imgFrom = text.lastIndexOf("![", idx);
    found = {
      from: pos + idx + 2,
      to: pos + idx + 2 + placeholder.length,
      imgFrom: pos + (imgFrom < 0 ? idx : imgFrom),
      imgTo: pos + idx + 3 + placeholder.length
    };
    return false;
  });
  if (!found)
    return;
  const f = found;
  let tr = view.state.tr;
  if (replacement === null)
    tr = tr.delete(f.imgFrom, f.imgTo);
  else
    tr = tr.insertText(escapeSrc(replacement), f.from, f.to);
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}
function isImageFile(file) {
  return file.type.startsWith("image/");
}
async function insertImageFiles(view, files, upload) {
  const images = Array.from(files).filter(isImageFile);
  if (!images.length)
    return;
  const pending = images.map((file) => ({ file, ...placeholderSrc(file) }));
  const lines = pending.map(({ file, src }) => `![${escapeAlt(altFromFileName(file.name))}](${src})`);
  view.dispatch(insertImageLines(view.state, lines).scrollIntoView());
  await Promise.all(pending.map(async ({ file, src, revoke }) => {
    let url = null;
    try {
      url = upload ? await upload(file) : await readAsDataURL(file);
    } catch (err) {
      console.error("[handymd] image upload failed", err);
    }
    if (!view.isDestroyed)
      replacePlaceholder(view, src, url);
    revoke();
  }));
}
function imageFilesOf(data) {
  if (!data)
    return [];
  return Array.from(data.files ?? []).filter(isImageFile);
}
function findImage(state, pos, test) {
  const st = concealKey.getState(state);
  if (!st || st.source)
    return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 1)
    return null;
  const block = st.blocks[findBlockAt(st.blocks, $pos.before())];
  if (!block)
    return null;
  return block.elements.find((el) => el.kind === "image" && test(el)) ?? null;
}
function selectedImage(state) {
  const { from, to } = state.selection;
  if (from === to)
    return null;
  return findImage(state, from, (el) => el.from === from && el.to === to);
}
function selectRange(view, from, to) {
  view.dispatch(view.state.tr.setSelection(TextSelection6.create(view.state.doc, from, to)));
  return true;
}
function imageFromDOM(view, dom) {
  let pos;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return null;
  }
  return findImage(view.state, pos, (el) => el.from === pos);
}
function handleImageKey(view, e) {
  if (e.metaKey || e.ctrlKey || e.altKey)
    return false;
  const { state } = view;
  const sel = state.selection;
  const picked = selectedImage(state);
  if (picked) {
    if (e.shiftKey)
      return false;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        return selectRange(view, picked.from, picked.from);
      case "ArrowRight":
      case "ArrowDown":
        return selectRange(view, picked.to, picked.to);
      case "Enter": {
        const tr = state.tr.split(picked.to);
        view.dispatch(tr.setSelection(TextSelection6.create(tr.doc, picked.to + 2)).scrollIntoView());
        return true;
      }
    }
    return false;
  }
  if (!sel.empty || e.shiftKey)
    return false;
  const pos = sel.from;
  let img = null;
  if (e.key === "Backspace" || e.key === "ArrowLeft")
    img = findImage(state, pos, (el) => el.to === pos);
  else if (e.key === "Delete" || e.key === "ArrowRight")
    img = findImage(state, pos, (el) => el.from === pos);
  if (!img)
    return false;
  return selectRange(view, img.from, img.to);
}
function snapSelectionToImages(state) {
  const sel = state.selection;
  if (!(sel instanceof TextSelection6))
    return null;
  const st = concealKey.getState(state);
  if (!st || st.source || st.composing || st.readOnly)
    return null;
  const inside = (pos) => findImage(state, pos, (el) => pos > el.from && pos < el.to);
  if (sel.empty) {
    const img = inside(sel.head);
    return img ? state.tr.setSelection(TextSelection6.create(state.doc, img.from, img.to)) : null;
  }
  const forward = sel.head >= sel.anchor;
  const a = inside(sel.anchor);
  const h = inside(sel.head);
  if (!a && !h)
    return null;
  const anchor = a ? forward ? a.from : a.to : sel.anchor;
  const head = h ? forward ? h.to : h.from : sel.head;
  return state.tr.setSelection(TextSelection6.create(state.doc, anchor, head));
}
function imagePlugin(options = {}) {
  return new Plugin9({
    appendTransaction: (_trs, _old, state) => snapSelectionToImages(state),
    props: {
      handleKeyDown: (view, event) => view.editable ? handleImageKey(view, event) : false,
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target;
          if (!target?.classList?.contains("hm-image") || event.button !== 0)
            return false;
          event.preventDefault();
          if (!view.editable)
            return true;
          const img = imageFromDOM(view, target);
          if (!img)
            return true;
          selectRange(view, img.from, img.to);
          view.focus();
          return true;
        }
      },
      handlePaste(view, event) {
        const files = imageFilesOf(event.clipboardData);
        if (!files.length || !view.editable)
          return false;
        event.preventDefault();
        insertImageFiles(view, files, options.upload);
        return true;
      },
      handleDrop(view, event) {
        const files = imageFilesOf(event.dataTransfer);
        if (!files.length || !view.editable)
          return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) {
          view.dispatch(view.state.tr.setSelection(TextSelection6.create(view.state.doc, coords.pos)));
        }
        insertImageFiles(view, files, options.upload);
        return true;
      }
    }
  });
}

// src/editor.ts
class HandyEditor {
  view = null;
  autosave = null;
  phaseValue = "loading";
  readOnlyValue;
  sourceModeValue;
  readOnlyBeforeConflict = false;
  remoteMarkdown = null;
  lastLoadError = null;
  opts;
  listeners = new Map;
  constructor(options) {
    this.opts = options;
    this.readOnlyValue = options.readOnly ?? false;
    this.sourceModeValue = options.sourceMode ?? false;
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
        source: this.sourceModeValue,
        renderDiagram: this.opts.diagram ? createDiagramRenderCallback(this.opts.diagram) : undefined,
        onOpenLink: this.opts.onOpenLink,
        resolveImage: this.opts.resolveImage
      }),
      imePlugin(),
      headingInputPlugin(),
      interactionsPlugin({ onOpenLink: this.opts.onOpenLink }),
      caretGuardPlugin(),
      imagePlugin({ upload: this.opts.uploadImage }),
      clipboardPlugin(),
      markdownKeymap()
    ];
    plugins.push(highlightPlugin(this.opts.highlight ?? createShikiHighlighter()));
    if (this.opts.history !== false) {
      plugins.push(history());
      plugins.push(keymap2({ "Mod-z": undo2, "Mod-y": redo2, "Mod-Shift-z": redo2 }));
    }
    plugins.push(keymap2(baseKeymap));
    if (this.opts.normalizeOrderedLists !== false)
      plugins.push(normalizePlugin());
    plugins.push(new Plugin10({
      filterTransaction: (tr) => !tr.docChanged || !this.readOnlyValue || tr.getMeta("handymd-programmatic") === true
    }));
    if (this.opts.plugins)
      plugins.push(...this.opts.plugins);
    const state = EditorState.create({ doc, plugins });
    this.opts.mount.classList.add("handymd");
    this.opts.mount.classList.toggle("hm-source", this.sourceModeValue);
    this.opts.mount.addEventListener("keydown", this.onMountKeyDown);
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
  onMountKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      this.flush();
    }
  };
  getMarkdown() {
    return this.view ? docToMarkdown(this.view.state.doc) : this.opts.content ?? "";
  }
  setMarkdown(markdown, options = {}) {
    const view = this.view;
    if (!view)
      return;
    const doc = markdownToDoc(markdown);
    let tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    tr = tr.setSelection(TextSelection7.atStart(tr.doc));
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
  insertImage(options) {
    const view = this.view;
    if (!view || this.phaseValue !== "ready" || this.readOnlyValue)
      return false;
    return insertImage(options)(view.state, view.dispatch.bind(view));
  }
  async insertImageFiles(files) {
    const view = this.view;
    if (!view || this.phaseValue !== "ready" || this.readOnlyValue)
      return;
    await insertImageFiles(view, Array.from(files), this.opts.uploadImage);
  }
  focus() {
    this.view?.focus();
  }
  exportToPDF(options = {}) {
    const view = this.view;
    if (!view || this.phaseValue === "loading" || this.phaseValue === "destroyed") {
      return Promise.resolve();
    }
    return exportToPDF(view, options);
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
  get sourceMode() {
    return this.sourceModeValue;
  }
  setSourceMode(source) {
    this.sourceModeValue = source;
    this.opts.mount.classList.toggle("hm-source", source);
    if (!this.view)
      return;
    const meta = { source };
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
    this.opts.mount.removeEventListener("keydown", this.onMountKeyDown);
    this.view?.destroy();
    this.view = null;
    this.setPhase("destroyed");
  }
}
function createEditor(options) {
  return new HandyEditor(options);
}
// src/imagestore.ts
var STORE = "files";
function openDB(name) {
  if (typeof indexedDB === "undefined")
    return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idb(db, mode, run) {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function contentHash(file) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest).slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(16).slice(2, 12);
  }
}
var EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif"
};
function fileSlug(file) {
  const m = file.name.match(/^(.*?)(?:\.([A-Za-z0-9]+))?$/);
  const base = (m?.[1] ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const ext = (m?.[2] ?? EXT_BY_TYPE[file.type] ?? "png").toLowerCase();
  return { base: base || "image", ext };
}
function createLocalImageStore(options = {}) {
  const prefix = options.prefix ?? "assets/";
  const dbName = options.dbName === undefined ? "handymd-images" : options.dbName;
  const blobs = new Map;
  const urls = new Map;
  let dbPromise = null;
  const db = () => {
    if (!dbPromise)
      dbPromise = (dbName ? openDB(dbName) : null)?.catch(() => null) ?? Promise.resolve(null);
    return dbPromise;
  };
  const get = async (path) => {
    const hit = blobs.get(path);
    if (hit)
      return hit;
    const d = await db();
    if (!d)
      return null;
    const blob = await idb(d, "readonly", (s) => s.get(path)).catch(() => {
      return;
    });
    if (blob)
      blobs.set(path, blob);
    return blob ?? null;
  };
  const urlFor = (path, blob) => {
    let url = urls.get(path);
    if (!url) {
      url = URL.createObjectURL(blob);
      urls.set(path, url);
    }
    return url;
  };
  return {
    async upload(file) {
      const { base, ext } = fileSlug(file);
      const path = `${prefix}${base}-${await contentHash(file)}.${ext}`;
      blobs.set(path, file);
      const d = await db();
      if (d)
        await idb(d, "readwrite", (s) => s.put(file, path)).catch(() => {});
      return path;
    },
    resolve(src) {
      if (!src.startsWith(prefix))
        return src;
      let path = src;
      try {
        path = decodeURI(src);
      } catch {}
      const hit = blobs.get(path);
      if (hit)
        return urlFor(path, hit);
      return get(path).then((blob) => blob ? urlFor(path, blob) : src);
    },
    get
  };
}
export {
  toggleInline,
  toCommonMark,
  tableControllerAt,
  tableColCount,
  splitWithoutPrefix,
  splitTableSource,
  shiftArrowLeftSkipPrefix,
  setTableColumnAlign,
  setHeading,
  setConcealMeta,
  selectedImage,
  schema,
  revealSignature,
  renderCellPreview,
  removeTab,
  printableClone,
  parseTableRow,
  parseTableModel,
  parseTableAlign,
  parseInlineCached,
  parseInline,
  parseDoc,
  normalizePlugin,
  moveTableRow,
  moveTableColumn,
  markdownToSlice,
  markdownToDoc,
  markdownKeymap,
  looksLikeTableRow,
  joinTableSource,
  isTableSeparator,
  isRevealed,
  interactionsPlugin,
  insertTableRow,
  insertTableColumn,
  insertTable,
  insertTab,
  insertImageFiles,
  insertImage,
  indentListItem,
  imePlugin,
  imagePlugin,
  imageMarkdown,
  htmlToMarkdown,
  highlightPlugin,
  highlightKey,
  headingInputPlugin,
  goToPrevTableCell,
  goToNextTableCell,
  formatTableRow,
  formatSeparator,
  focusTableCell,
  exportToPDF,
  docToMarkdown,
  diagramLangOf,
  deleteToContentStart,
  deleteToContentEnd,
  deleteTableRow,
  deleteTableColumn,
  deleteIntoTable,
  deleteForwardStripPrefix,
  dedentListItem,
  createShikiHighlighter,
  createMermaidRenderer,
  createLocalImageStore,
  createEditor,
  createDiagramRenderCallback,
  continueTableRow,
  continueListItem,
  concealPlugin,
  concealKey,
  closeFenceOnEnter,
  clipboardPlugin,
  classifyLines,
  caretGuardPlugin,
  buildTableMarkdown,
  buildPrintDocument,
  buildBlockDecos,
  backspaceIntoTable,
  backspaceBlockFormat,
  arrowUpToPrevContentEnd,
  arrowLeftSkipPrefix,
  HandyEditor,
  Autosave
};

//# debugId=1684DFF1C4FBD78964756E2164756E21
