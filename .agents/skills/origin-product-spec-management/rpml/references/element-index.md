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
| diagram           | Canvas   | Renders Mermaid text (flow/state/sequence/ER) to inline SVG inside an annotation                                                                                                                           |

## Layout primitives

| Element      | Category | Description                                                                                                   |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| viewport     | Layout   | Fixed-width snapshot viewport matching a device preset; auto height by default                                |
| layout       | Layout   | CSS grid container with columns, rows, and gap attributes                                                     |
| panel        | Layout   | White panel/card shell with optional padding and elevation                                                    |
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
| app-shell    | Layout   | Application shell: sidebar + topbar + main content area; optional height, padding, and direction              |
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
| select                 | Controls | Dropdown select; state collapsed/expanded/filled/error/disabled; options CSV; error        |
| button                 | Controls | Action button with variant (primary/secondary/ghost/danger/link), state, icon, size        |
| button-group           | Controls | Container grouping related buttons                                                         |
| checkbox               | Controls | Checkbox with state (unchecked/checked/indeterminate/disabled/error)                       |
| checkbox-group         | Controls | Checkbox group with label, direction, and validation error                                 |
| radio                  | Controls | Radio button with state (unchecked/checked/disabled/error)                                 |
| radio-group            | Controls | Radio group with label, direction, and validation error                                    |
| toggle                 | Controls | Toggle switch with state (on/off/disabled/error)                                           |
| password-input         | Controls | Masked password field with optional eye toggle; full state matrix                          |
| tag-input              | Controls | Chip multi-input; tags CSV, placeholder, label, state, error                               |
| form                   | Controls | Form container with layout (vertical/horizontal)                                           |
| form-item              | Controls | Labeled form field wrapper with required, error, help                                      |
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
| list            | Navigation | Generated list; auto-creates items when no children provided                                    |
| list-item       | Navigation | List row with label, icon, badge, and state                                                     |
| tabs            | Navigation | Tabbed navigation container with active tab                                                     |
| tab             | Navigation | Individual tab with label and optional badge                                                    |
| pagination      | Navigation | Pagination control with total, current, and page-size                                           |
| steps           | Navigation | Step indicator for multi-step flows with active step                                            |
| breadcrumb      | Navigation | Breadcrumb trail from comma-separated items                                                     |
| segmented       | Navigation | Segmented control (button group acting as radio)                                                |
| command-palette | Navigation | Command palette overlay with query and results                                                  |
| context-menu    | Navigation | Context menu with comma-separated items                                                         |
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
| table           | Data display | Static table; columns CSV; has-checkbox and has-action add affordances; `<table-row>` children pin exact cell values, else sampled by `rows` |
| table-row       | Data display | `table` child declaring one explicit row; `content` CSV, optional `checked`                                                                  |
| table-list-row  | Data display | Standalone row slice with `content` CSV and state (default/selected/unread/highlighted/disabled)                                             |
| chart           | Data display | Static inline-SVG data viz; kind bar/line/area/donut/sparkline; data CSV; labels; height; color                                              |
| avatar-group    | Data display | Overlapping avatar stack with +N overflow; items count or `<avatar>` children                                                                |
| comment         | Data display | Comment thread entry; author/avatar/time; body slot; nest for replies                                                                        |
| file-list       | Data display | File attachment list container; items count or `<file-item>` children                                                                        |
| file-item       | Data display | One file row; name (sets icon), size, state uploaded/uploading/error, progress                                                               |
| bulk-action-bar | Data display | Bulk action bar shown when rows are selected; count and actions CSV                                                                          |
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
| ios-navbar       | iOS      | iOS-style navigation bar with title, large variant, back, trailing |
| ios-tabbar       | iOS      | iOS tab bar with items, icons, active tab                          |
| ios-list         | iOS      | iOS grouped list with header                                       |
| ios-list-item    | iOS      | iOS list row with label, detail, icon, chevron                     |
| ios-action-sheet | iOS      | iOS action sheet with title, actions, destructive action           |
| ios-alert        | iOS      | iOS alert dialog with title, message, actions                      |
| ios-switch       | iOS      | iOS-style toggle switch                                            |
| ios-segmented    | iOS      | iOS segmented control                                              |
| ios-button       | iOS      | iOS-style button (filled/tinted/plain)                             |
| ios-search       | iOS      | iOS search bar                                                     |
| ios-stepper      | iOS      | iOS stepper control                                                |

## Agent / conversational UI primitives

| Element         | Category | Description                                                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| chat            | Agent    | Conversation container wrapping the message stream                                                                 |
| user-message    | Agent    | Right-aligned user message bubble                                                                                  |
| agent-message   | Agent    | Left-aligned agent message (default role "Agent") with optional rich children                                      |
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
