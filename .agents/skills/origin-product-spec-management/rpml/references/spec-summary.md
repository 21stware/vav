# RPML Spec Summary (Context Pack)

## File format

An RPML file is HTML-like markup, parsed as HTML (not strict XML). The root element is `<page>`. No HTML wrapper, no doctype required. Because it parses as HTML, boolean attributes may omit their value (`required`, `has-action`) and bare `&` in text needs no escaping. Import the renderer once:

```html
<script type="module" src="./dist/rpui.js"></script>
```

Or load a standalone `.rpml` file at runtime via the playground (`?rpml=`), `npx @21stware/rpui serve .`, or the compiler.

## Root structure

Snapshot mode (default) — one screen with a scaled canvas and annotation pane:

```html
<page
  title="..."
  route="/route"
  description="Snapshot shows [representative state]"
>
  <view device="desktop|tablet|mobile" scale="0.65">
    <viewport device="desktop|tablet|mobile">
      <!-- snapshot: RPML primitives only, data-pin="N" on meaningful regions -->
    </viewport>
  </view>

  <annotation id="1" label="Region Name">
    Spec prose.
    <enum>
      <enum-item label="State A" description="Trigger/condition."
        ><!-- RPML primitives --></enum-item
      >
    </enum>
    <annotation label="Sub-region">Nested spec.</annotation>
  </annotation>
  <!-- one <annotation id="N"> per data-pin="N" -->
</page>
```

Document mode (`mode="doc"`) — linear prose, no canvas, no route:

```html
<page title="..." mode="doc">
  <doc-heading level="1">Title</doc-heading>
  <doc-paragraph
    >Body text with <strong>bold</strong> and <code>code</code>.</doc-paragraph
  >
  <doc-list type="bullet">
    <doc-list-item>Item one.</doc-list-item>
  </doc-list>
  <doc-quote cite="Source">Quoted text.</doc-quote>
</page>
```

## Two-layer model

**Canvas layer** — document structure and specification:

- `page` — root; `title`, `route` (snapshot mode), `description`, optional `mode` (`snapshot` default | `doc` for linear documents with no canvas/route/pins).
- `view` — scaled snapshot frame; `device`, `scale`, optional `width`/`height`.
- `viewport` — snapshot viewport; same `device` as view.
- `annotation` — specification block; top-level has `id` matching a pin, nested has no `id`.
- `annotation-global` — page-level, pin-less note for cross-cutting concerns; renders at the top of the pane. No `id`, no pin.
- `enum` — horizontal container for mutually exclusive states.
- `enum-item` — one state card; `label` required, `description` optional.
- `anchor` — cross-page link (`to`, optional `section`) to another screen in the file set.
- `diagram` — Mermaid text → inline SVG at 1:1; README flows use `flowchart LR`. Place in an annotation or in `mode="doc"`.

**Primitive layer** — static UI building blocks used inside `view` and inside annotation `enum-item` bodies. A broad library across layout, controls, navigation, data display, feedback, iOS, and agent families. The full registered set is enumerated in `element-index.md`.

## Pin system

- Add `data-pin="N"` to any element inside `<view>`. Pins number from 1 with no gaps. Pin as many regions as the page has — no target count.
- Strict bidirectional parity: every `data-pin="N"` ↔ exactly one top-level `<annotation id="N">`. A numbered annotation with no pin is a defect — put cross-cutting notes in `<annotation-global>` instead.
- The runtime renders water-drop pin markers automatically. Never write pin DOM manually.

## Annotation nesting and section addressing

Annotations nest arbitrarily. The runtime auto-assigns `data-rp-section` paths (authors do not write them):

| Depth                | Example path | Marker                                |
| -------------------- | ------------ | ------------------------------------- |
| Top-level (has `id`) | `3`          | Blue water-drop, shows id             |
| Nested depth 1       | `3-2`        | Purple circle, shows local index `2`  |
| Nested depth ≥2      | `3-2-1`      | Green triangle, shows local index `1` |

Local index = 1-based position among annotation siblings under the same parent. Sibling order is significant.

Clicking a pin or annotation title sets `?section=<path>` in the URL. Loading a URL with `?section=3-2-1` focuses that annotation.

## Decomposition levels (L1–L5)

| Level | What it describes                                                         |
| ----- | ------------------------------------------------------------------------- |
| L1    | Page region (annotation with id)                                          |
| L2    | Element or concern inside the region (nested annotation)                  |
| L3    | State family — mutually exclusive states (enum)                           |
| L4    | Per-state rule — trigger, threshold, transition (enum-item + description) |
| L5    | Boundary/exception — edge cases, overflow, permission denial              |

Not every region reaches L5. Let domain complexity decide depth.

## enum usage

Use `<enum>` for: state families (loaded/loading/empty/error), permission variants, validation branches, overlay results (open/closed, success/failure), and any conditional branch in code. Each `enum-item` gets an auto-numbered black square badge. Combinatorial states (permission × state) must be enumerated as products, not as separate flat lists.

## Overlay pattern

`modal`, `drawer`, `dropdown`, `popover`, `tooltip`, `toast` are **never placed in the main snapshot**. Pin the trigger element; render the overlay inside the trigger's annotation (usually inside `<enum>`).

Exception: a permanently docked side panel may appear open in the snapshot as the representative state, but its trigger and conditions must still be documented.

## Forbidden in RPML

- Raw `div`, `button`, `input`, `table`, `script`, `style` for product UI.
- `style="..."` attribute on any element — RPML's look is determined by element semantics, not inline CSS. The validator rejects it.
- `onclick`, event attributes, timers, API calls, framework state.
- External images (use `image-placeholder`), external CSS, CDN icons.
- `position:absolute` or `position:fixed` in snapshot content.
- Prefixed or aliased tags — use bare RPML tag names only.
- Interactive JS of any kind.

## Validation

```
bun run validate <file.rpml>
```

Checks structural constraints (root is `page`, exactly one `view`, `page` has a `title`, `annotation-global` carries no `id`), pin↔annotation parity, and consecutive pin numbering from 1.
