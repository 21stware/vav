# RPML Element Index

All elements registered by the RPUI runtime. RPML authoring uses the bare language tag names listed below; the runtime maps each to its Web Component tag. This table is the authoritative roster — `packages/rpml-parser/src/vocabulary.ts` is the single source it mirrors.

## Canvas elements

| Element           | Category | Description                                                                                                                                                                                                |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page              | Canvas   | Root document shell; `title`, `route`, `description`, optional `mode`. Default (snapshot): main view left, annotations right. `mode="doc"`: single-column document flow, no route badge, no view/pins/pane |
| view              | Canvas   | Scaled snapshot frame; device preset sets fixed width; scale attribute zooms the canvas                                                                                                                    |
| annotation        | Canvas   | Specification block; top-level (id=N) links to data-pin="N"; nested adds sub-region spec                                                                                                                   |
| annotation-global | Canvas   | Page-level, pin-less note for cross-cutting concerns; renders at top of pane; no id/pin                                                                                                                    |
| enum              | Canvas   | Horizontal row of mutually exclusive state/variant cards                                                                                                                                                   |
| enum-item         | Canvas   | One state card with label and optional description; auto-numbered with a black square badge                                                                                                                |
| anchor            | Canvas   | Cross-page link (to, optional section) to another screen in the file set                                                                                                                                   |
| *(attr)* `link`   | Canvas   | On any snapshot control: `link="other.rpml"` (+ optional `link-section`) paints a path chip; ⌘/Ctrl+click jumps in workbench/viewer                                                                      |
| diagram           | Canvas   | Mermaid → SVG (flow/state/sequence/ER); token-themed; node-radius / edge-radius soften sharp geometry                                                                                                        |

## Layout primitives

| Element      | Category | Description                                                                                                   |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| viewport     | Layout   | Fixed-width snapshot viewport matching a device preset; auto height by default                                |
| layout       | Layout   | CSS grid container with columns, rows, and gap attributes                                                     |
| panel        | Layout   | White panel/card shell with optional padding and elevation                                                    |
| pane         | Layout   | Logical region with **no visual chrome** (no border/fill/radius); optional `padding`/`width`; pin-friendly flat grouping |
| navigator    | Layout   | Top navigation bar container                                                                                  |
| sidebar      | Layout   | Side navigation container; supports collapsed state                                                           |
| logo         | Layout   | Logo placeholder with size and label                                                                          |
| split-pane   | Layout   | Two-column split layout                                                                                       |
| divider      | Layout   | Horizontal or vertical divider line                                                                           |
| separator    | Layout   | Visual divider; orientation horizontal or vertical                                                            |
| spacer       | Layout   | Empty space with explicit size                                                                                |
| scroll-area  | Layout   | Custom-styled scrollable container with thin scrollbar; height is optional, defaults to content-driven        |
| collapsible  | Layout   | Expand/collapse section with label and expanded state; body slot for children                                 |
| aspect-ratio | Layout   | Container maintaining a width/height ratio; ratio attribute (e.g. 16/9)                                       |
| flex-layout  | Layout   | Primary flexbox container; direction, gap, align, justify, wrap, divider, padding, plus child flex attributes |
| row          | Layout   | Horizontal flex row; gap and align                                                                            |
| col          | Layout   | Vertical flex column; gap                                                                                     |
| section      | Layout   | Block-level section with optional padding                                                                     |
| app-shell    | Layout   | Application shell: desktop sidebar + navigator + main; mobile ios-navbar + content + ios-tabbar; height (incl. auto), padding, direction |
| toolbar      | Layout   | Horizontal action bar with gap and stretch behavior                                                           |
| heading      | Layout   | Block heading; level, size, variant, color, align, weight                                                     |
| text         | Layout   | Block text paragraph; size, variant, color, align, weight                                                     |
| icon         | Layout   | Inline SVG icon; type, size, mode, color                                                                      |

## Control primitives

| Element                | Category | Description                                                                                |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ |
| search                 | Controls | Search field with state (default/focus/filled/error/disabled) and optional clear button    |
| input                  | Controls | Text input with label, state, value, optional leading icon, error, help                    |
| textarea               | Controls | Multi-line text input with rows, label, state, error, help                                 |
| select                 | Controls | Dropdown; **required** `options` (`,` short tokens or `\|` if labels contain commas); `value`; state; error |
| button                 | Controls | Action button with variant (primary/secondary/ghost/danger/link), state, icon, size        |
| button-group           | Controls | Container grouping related buttons                                                         |
| checkbox               | Controls | Checkbox with state (unchecked/checked/indeterminate/disabled/error)                       |
| checkbox-group         | Controls | Checkbox group with label, direction, and validation error                                 |
| radio                  | Controls | Radio button with state (unchecked/checked/disabled/error)                                 |
| radio-group            | Controls | Radio group with label, direction, and validation error                                    |
| toggle                 | Controls | Toggle switch with state (on/off/disabled/error)                                           |
| password-input         | Controls | Masked password field with optional eye toggle; full state matrix                          |
| tag-input              | Controls | Chip multi-input; tags CSV, placeholder, label, state, error                               |
| form                   | Controls | Field grid: `columns="2|3|4"`, `gap`; `layout="horizontal"` is label-left form mode. Prefer multi-col on desktop |
| form-item              | Controls | `label` `required` `error` `help`; `span="all"` full row; **`layout="row"`** label-left control-right (settings); `actions` button row |
| form-field-description | Controls | Field-level remark rendered below a field; `text` attr or child text                       |
| radio-card             | Controls | Selectable card with radio indicator; label, description, state unchecked/checked/disabled |
| date-picker            | Controls | Date picker input with state, value, error, help                                           |
| upload                 | Controls | File upload zone with state (empty/has-file/uploading/error) and progress                  |
| image-placeholder      | Controls | Placeholder for images; use instead of external image URLs                                 |
| progress               | Controls | Progress bar or circle with value, kind, and status                                        |
| slider                 | Controls | Single-thumb slider with value, min, max; state error/disabled                             |
| range                  | Controls | Dual-thumb range slider with low, high, min, max; state error/disabled                     |
| number-input           | Controls | Numeric input with +/- steppers; state error/disabled                                      |
| rating                 | Controls | Star rating display with value and max; state disabled                                     |
| pin-input              | Controls | OTP/PIN cell input with length and value; state disabled                                   |
| color-swatch           | Controls | Color swatch chip with hex value and label; state disabled                                 |
| autocomplete           | Controls | Autocomplete input; open shows list; label, state, error                                   |
| combobox               | Controls | Search-select combo box; options CSV, value, placeholder                                   |
| input-group            | Controls | Input with prefix/suffix addons; prefix, suffix, placeholder, value                        |
| toggle-group           | Controls | Toggle button group; type single/multiple, options CSV, active index                       |
| toggle-group-item      | Controls | Individual toggle group button with label and active state                                 |
| field                  | Controls | Field wrapper; label, description, error attributes; control slot for children             |

## Navigation primitives

| Element         | Category   | Description                                                                                     |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| badge           | Navigation | Numeric badge/count indicator with max cap                                                      |
| avatar          | Navigation | User avatar circle with initials and size                                                       |
| list            | Navigation | List container; optional `header`/`footer`/`inset`; auto-demo rows only when empty              |
| list-item       | Navigation | Composable row: `title`/`subtitle`/`detail`/`icon`/`badge`/`chevron`; children → leading/body/trailing slots |
| tabs            | Navigation | Tabbed navigation container with active tab                                                     |
| tab             | Navigation | Individual tab with label and optional badge                                                    |
| pagination      | Navigation | Pagination control with total, current, and page-size                                           |
| steps           | Navigation | Step indicator for multi-step flows with active step                                            |
| breadcrumb      | Navigation | Prefer `breadcrumb-item` children with `link=`. Compact: `items` (+ optional `links`) |
| breadcrumb-item | Navigation | Crumb host: `label`, optional `link` / `link-section` |
| segmented       | Navigation | Prefer `segmented-item` children with `link=`. Compact: **required** `options` (+ optional `links`); `active` index or label. Empty → Day/Week/Month. |
| segmented-item  | Navigation | Segment host: `label`, optional `link` / `pin` |
| command-palette | Navigation | Command palette: `query`, `results` list                                                        |
| context-menu    | Navigation | Menu: `items` list of short labels                                                              |
| menu            | Navigation | Menu container                                                                                  |
| menu-item       | Navigation | Menu row with label, icon, shortcut, and state                                                  |
| toc             | Navigation | Table of contents from comma-separated items                                                    |
| kbd             | Navigation | Keyboard shortcut chip(s)                                                                       |
| menubar         | Navigation | Horizontal menu bar container; contains menubar-item children                                   |
| menubar-item    | Navigation | Menu bar item with label and dropdown chevron                                                   |
| nav-menu        | Navigation | Horizontal navigation menu with bottom-border active indicator; contains nav-menu-item children |
| nav-menu-item   | Navigation | Navigation menu item with label and active state                                                |

## Data display primitives

| Element         | Category     | Description                                                                                                                                  |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| table           | Data display | Static table; `columns` list; has-checkbox / has-action; prefer `<table-row>` children for exact cells                                        |
| table-row       | Data display | Explicit row: `content` list matching `columns` (use `\|` if a cell has commas/money); optional `checked`                                    |
| table-list-row  | Data display | Standalone row: `content` list + state (default/selected/unread/highlighted/disabled)                                                        |
| chart           | Data display | Viz: `kind`, pure-number `data` (commas OK), `labels`, height, color                                                                         |
| avatar-group    | Data display | Overlapping avatar stack with +N overflow; items count or `<avatar>` children                                                                |
| comment         | Data display | Comment thread entry; author/avatar/time; body slot; nest for replies                                                                        |
| file-list       | Data display | File attachment list container; items count or `<file-item>` children                                                                        |
| file-item       | Data display | One file row; name (sets icon), size, state uploaded/uploading/error, progress                                                               |
| bulk-action-bar | Data display | Selection bar: `count` + `actions` list (short labels → `,`; free text with commas → `\|`)                                                   |
| empty           | Data display | Empty state with label, description, and optional action                                                                                     |
| loading         | Data display | Loading placeholder; kind skeleton or spinner; rows count                                                                                    |
| alert           | Data display | Inline alert banner (info/success/warning/error) with title and message                                                                      |
| toast           | Data display | Toast notification (info/success/warning/error) rendered in annotations                                                                      |
| dropdown        | Data display | Static opened dropdown panel                                                                                                                 |
| popover         | Data display | Static opened popover panel                                                                                                                  |
| tooltip         | Data display | Visible tooltip bubble with text and position                                                                                                |
| modal           | Data display | Static opened modal dialog with title, width, optional footer                                                                                |
| drawer          | Data display | Static opened side drawer with side, width, title                                                                                            |
| card            | Data display | Content card with title, subtitle, optional image and footer slots                                                                           |
| stat-card       | Data display | KPI card with label, value, trend, and change                                                                                                |
| tag             | Data display | Colored label tag; closable variant                                                                                                          |
| chip            | Data display | Compact token chip with label, icon, closable                                                                                                |
| tree            | Data display | Tree container                                                                                                                               |
| tree-item       | Data display | Tree node with label, icon, level, expanded/collapsed, state                                                                                 |
| timeline        | Data display | Timeline container                                                                                                                           |
| timeline-item   | Data display | Timeline event with label, time, and state                                                                                                   |
| calendar        | Data display | Month grid calendar with selected date                                                                                                       |
| kanban          | Data display | Kanban board container                                                                                                                       |
| kanban-column   | Data display | Kanban column with title and count                                                                                                           |
| kanban-card     | Data display | Kanban card with label and tag                                                                                                               |
| code-block      | Data display | Code block with language label; accepts `code` attr or child text as real content, falls back to placeholder lines                           |
| diff            | Data display | Diff view with +/-/context lines; accepts `content` attr or child text as real diff content, falls back to placeholder rows                  |
| image-grid      | Data display | Grid of image placeholders with count and columns                                                                                            |
| key-value       | Data display | Description list container                                                                                                                   |
| kv-row          | Data display | Key-value row with label and value                                                                                                           |
| accordion       | Data display | Accordion container                                                                                                                          |
| accordion-item  | Data display | Expandable accordion section with label                                                                                                      |
| banner          | Data display | Full-width page-level banner (info/success/warning/error)                                                                                    |
| skeleton        | Data display | Loading skeleton shape (line/block/card/list/avatar)                                                                                         |
| countdown       | Data display | Time-remaining chip with value                                                                                                               |
| result          | Data display | Full-page result screen (success/error/empty) with title and optional action                                                                 |
| carousel        | Data display | Horizontal scrolling carousel with prev/next buttons; contains carousel-item children                                                        |
| carousel-item   | Data display | One slide in a carousel; fixed 300px width                                                                                                   |
| data-table      | Data display | Enhanced table with sortable headers; columns CSV, rows semicolon-separated                                                                  |
| hover-card      | Data display | Inline trigger text that shows a card on hover; trigger, title, description                                                                  |
| sonner          | Data display | Toast notification card; title, description, type (info/success/warning/error)                                                               |
| permission-gate | Overlays     | Locked content wrapper with reason label                                                                                                     |
| quota-bar       | Data display | Usage bar that turns red at ≥90%; label, used, limit                                                                                         |
| api-key         | Data display | Masked API key display with copy affordance                                                                                                  |
| audit-row       | Data display | Audit log row with actor, action, time                                                                                                       |
| workflow-node   | Data display | Workflow step node with label and state                                                                                                      |

## iOS platform primitives (use with device="mobile")

| Element          | Category | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| ios-navbar       | iOS      | Nav bar: title, large; `back` / `back-label`. Prefer children: `ios-nav-action` (`slot="trailing"`/`leading`) with per-action `link`/`pin`. Compact: trailing / trailing-icon + `trailing-links`/`trailing-pins`/`back-link`. |
| ios-nav-action   | iOS      | Navbar action host: `icon` and/or `label`; own `link` / `link-section` / `pin`. |
| ios-tabbar       | iOS      | Prefer children: `ios-tab` with `link`/`pin`. Compact: `items`+`icons` (+ optional `links`/`pins`). **`active` = this page's tab**. |
| ios-tab          | iOS      | Single tab: `label`, `icon`, optional `link` / `pin` / `state="active"`. |
| ios-list         | iOS      | Grouped list; optional `header` / `footer`                         |
| ios-list-item    | iOS      | Row: `label`, optional **`detail`** (same-row trailing, e.g. `¥52,360`), `icon`, `chevron`, `sub` |
| ios-action-sheet | iOS      | Prefer **child `ios-list-item`** for icon+label+value. Flat `actions` only for short labels; money/commas → `\|` or children. `title`, `destructive`, `cancel`. |
| ios-alert        | iOS      | `title`, `message`, `actions` (short button labels, comma OK)       |
| ios-switch       | iOS      | Toggle; optional `label`; `off` / state                            |
| ios-segmented    | iOS      | Prefer `ios-segment` children with `link=`. Compact: **required** `options` (+ optional `links`); `active` index or label. Empty → Day/Week/Month. |
| ios-segment      | iOS      | Segment item: `label`, optional `link` / `pin` / `state="active"`. |
| ios-button       | iOS      | iOS-style button (filled/tinted/plain)                             |
| ios-search       | iOS      | iOS search bar                                                     |
| ios-stepper      | iOS      | iOS stepper control                                                |

## Agent / conversational UI primitives

| Element         | Category | Description                                                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| chat            | Agent    | Conversation container wrapping the message stream                                                                 |
| user-message    | Agent    | Full-width user turn; role title (`name`, default "User") is the first line of the text body — no chat bubble |
| agent-message   | Agent    | Full-width agent turn; role title (`name`, default "Agent") is the first line of the text body — no chat bubble; `plain` for long-form article body |
| system-message  | Agent    | Centered system/context note                                                                                       |
| tool-call       | Agent    | Tool call; shows the tool name as headline + 工具 tag + status; args on their own line                             |
| agent-output    | Agent    | Command/code/tool output block (kind: text/code/terminal)                                                          |
| reasoning       | Agent    | Collapsible thinking/reasoning block                                                                               |
| message-actions | Agent    | Per-message action buttons (copy/retry/up/down/edit/share)                                                         |
| suggestions     | Agent    | Suggested reply/prompt chips                                                                                       |
| typing          | Agent    | Streaming typing indicator                                                                                         |
| composer        | Agent    | Prompt input bar; attachments (files), mode toggles (thinking/web/code), model pill, state idle/streaming/disabled |
| citation        | Agent    | Source reference chip with index and title                                                                         |
| token-usage     | Agent    | Token/context usage meter with used and limit                                                                      |

## Document mode primitives (mode="doc" pages only)

| Element       | Category | Description                                                 |
| ------------- | -------- | ----------------------------------------------------------- |
| doc-heading   | Document | Heading level 1–6; level 2+ adds a bottom border            |
| doc-paragraph | Document | Body paragraph; inline `strong`, `em`, `code`, `a` allowed  |
| doc-list      | Document | Ordered/unordered list; type `bullet` (default) or `number` |
| doc-list-item | Document | List item inside `doc-list`                                 |
| doc-quote     | Document | Block quote with optional `cite` attribution line           |

## Preferred component paths (avoid aliases)

When multiple primitives cover the same idea, **prefer the left-hand form**. Aliases remain registered for back-compat but should not be used in new RPML.

| Prefer | Avoid / secondary | Notes |
| --- | --- | --- |
| `dropdown-menu` | `dropdown`, bare `menu` | Structured menu with items |
| `form-item` | `field` | Field wrapper with label/error; `field` is shadcn-aligned alias |
| `table` + `table-row` | `data-table` for simple cases | Use `data-table` only when you need sortable header chrome |
| `segmented` | `toggle-group` (for exclusive choice) | `toggle-group` is fine for multi-select toolbars |
| `alert` | `toast` / `sonner` for inline | Use `toast-stack` / `sonner` for corner notifications |
| `separator` | `divider` | Same visual role; `separator` has orientation |
| `overlay-stage` + `modal`/`drawer`/`sheet` | bare modal in a layout cell | Stage supplies the dimmed backdrop |

## New / enhanced primitives

| Element | Category | Description |
| --- | --- | --- |
| overlay-stage | Overlays | Dimmed stage that centers (or docks) a modal/drawer/sheet |
| sheet | Overlays | Bottom/side sheet with optional handle and footer |
| filter-bar | Navigation | List-page filter chrome; optional search + filter chips |
| nav-item | Navigation | Sidebar row: icon + label + badge + active/disabled |
| toast-stack | Data display | Vertical stack of notification cards |
| map-placeholder | Data display | Map region placeholder with pin |
| media-placeholder | Data display | Video/media region placeholder with play affordance |
| plan-card | Data display | Pricing plan card (name, price, features, CTA) |
| button-group | Controls | Grouped buttons sharing edges; optional size/variant inheritance |

### Table enhancements
- `sortable` — sort chevrons on headers
- `density="compact"|"comfortable"` — cell padding
- `rows="0"` with no `table-row` children — empty state

### Chart enhancements
- Y-axis line + max label (bar/line/area)
- `legend` attribute for swatch legend
- Donut `center` / `label` for center text (defaults to total)

### Result kinds
`kind` (or `status`): `success` | `error` | `empty` | `offline` | `not-found` | `404` | `500`

### Density
Set `data-rp-density="compact"` on `.rpui-scope` (or any ancestor) to tighten padding tokens globally.
