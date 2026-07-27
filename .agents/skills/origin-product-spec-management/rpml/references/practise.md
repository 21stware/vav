# RPML Generation Practices

The single reference for _how_ to decompose a page into a complete RPML prototype. `SKILL.md` routes here for method depth; the runnable system prompt is `prompts/generate-rpml.md`.

**Governing order (non-negotiable):**

```text
inputs → information architecture (IA) → representative state → layout chrome → content & states
```

Never invent layout or fill controls before the IA of the screen (or product) is explicit. Layout is how IA is expressed, not a substitute for it.

## 1. Inputs to gather before generating

Collect in priority order:

1. **Product requirement / user story** — the feature, route, and user goal.
2. **Screenshot or design draft** — identifies regions, layout, and density.
3. **Existing code with conditionals** — read every `v-if`, `&&`, ternary, and guard; each is a state to enumerate.
4. **Permission matrix / role notes** — which roles exist and what differs per role.
5. **Known async states** — loading, empty, error, retry, partial-failure, timeout.
6. **Existing IA in this project** — README route map, sibling screens, shared chrome (sidebar/tabs), and the current page's region map if editing.

If any input is missing, infer common SaaS/product states and make every assumption explicit in an annotation. Never silently omit a plausible state.

## 1b. Information architecture first (before any layout)

IA answers: **what must the user understand and do here, in what order of importance, and how is that hierarchy expressed as regions?**  
Layout answers: **which RPML primitives and columns implement that hierarchy.**  
Content answers: **what labels, values, and states fill those regions.**

If you skip IA, you get pretty but incoherent screens: equal-weight cards, random side panels, tabs that don't match jobs-to-be-done, and incremental edits that bolt features onto the wrong place.

### 1b.1 What "IA" means at two scales

| Scale | Design object | Must decide before markup |
| ----- | ------------- | ------------------------- |
| **Product / set** | Screen inventory + nav model | Which screens exist, entry routes, primary nav (sidebar / tabs / stack), what each screen owns vs. shares |
| **Single page** | Region hierarchy | Primary job of this view, ordered regions (primary → secondary → tertiary), what is chrome vs. content, what is always visible vs. progressive disclosure |

Product-level IA usually lives in `README.rpml` (route map, modules, flows). Page-level IA is decided **every time** you generate or materially update a screen — even when the README already exists.

### 1b.2 Page IA model (required mental model)

Before writing `<view>` content, lock these five layers:

1. **Purpose** — one sentence: the user's primary job on this screen (e.g. "triage open tickets and open one for action").
2. **Priority stack** — ordered list of information/actions by importance (P0 must be visible without scroll on the main canvas; P1 visible in the default state; P2 progressive / secondary / overlay).
3. **Region map** — named structural areas and their roles, not widgets. Example:
   - Chrome: app nav / page header / contextual toolbar  
   - Primary: main work surface (list, canvas, feed, form)  
   - Secondary: filters, inspectors, summaries that support the primary job  
   - Tertiary: metadata, audit, help, overflow  
   - Transient: overlays triggered from regions (not co-equal regions)
4. **Grouping & sequencing** — what is scanned first (F/Z patterns, reading order), what is grouped together because it is one decision, what must not compete for attention.
5. **Disclosure model** — always-on vs. collapsed vs. docked vs. modal; which states change the hierarchy (empty vs. loaded vs. selection-active).

**Anti-pattern:** jumping from a feature request to "add a card / column / tab" without re-ranking the priority stack. New content must earn a place in the hierarchy or force a deliberate restructure of it.

### 1b.3 How IA shows up in RPML (so it actually shapes output)

IA is not a private thought — encode it so layout and annotations cannot drift:

| IA decision | Where it appears in the `.rpml` |
| ----------- | ------------------------------- |
| Screen purpose + representative hierarchy | `<page description="…">` — name the job and the hierarchy emphasis, not only the data state |
| Cross-page nav model | README route map + each screen's chrome (sidebar active item / tabbar active / breadcrumb) |
| Region map | `data-pin` order follows **importance / reading order**, not arbitrary paint order; L1 annotation labels match region roles ("Primary list", "Context inspector") |
| Priority (P0/P1/P2) | Snapshot composition: P0 fills the dominant surface; P1 sits adjacent; P2 in overflow, accordion, or annotation-only |
| Shared chrome vs. page body | `app-shell` / `navigator` / `ios-tabbar` for shared; body for page-owned content — never reinvent nav per file without reason |
| Hierarchy change under selection / filter / role | Documented in annotation bodies + `<enum>`; snapshot shows the **selected hierarchy** if that is the densest real use |

Pin numbers should roughly track scan order (1 = most critical region users must understand first). That makes the annotation pane read as a guided IA walkthrough, not a random inventory.

### 1b.4 IA checklist (pass before building markup)

- [ ] I can state the page's primary job in one sentence.
- [ ] I have an ordered priority stack (P0/P1/P2) for information and actions.
- [ ] Every major region has a role (chrome / primary / secondary / tertiary / transient).
- [ ] Shared product chrome matches sibling screens (same nav model and active state).
- [ ] Nothing of equal visual weight competes with the primary job without a reason.
- [ ] Overlays are not treated as permanent peers of the primary region.
- [ ] If this is an **update**, I have decided whether the change **extends**, **reorders**, or **restructures** the existing IA (see §1b.5).

### 1b.5 Updates: restructure IA — do not only append

Edits that add capability almost always change hierarchy. **Default is wrong:** "find a gap and insert another block." **Default should be:** re-evaluate the page IA with the new requirement as a first-class input, then choose the smallest structural move that preserves a clear hierarchy.

| Change type | IA response | Typical RPML action |
| ----------- | ----------- | ------------------- |
| **Reinforces existing P0** | Keep region map; deepen primary region | Edit primary pin/annotation; add enums |
| **Promotes a secondary concern to frequent use** | Re-rank priority stack; may swap primary/secondary surfaces | Move content between regions; retitle pins; renumber if scan order changes |
| **New job that doesn't fit any region** | Add a region **or** split a new screen — decide by whether the job shares context with this route | New L1 pin **or** new `.rpml` + anchors; update README routes |
| **Cross-cutting policy / permission** | Not a new visual peer | `<annotation-global>` or shared chrome change across files |
| **Deprecates old primary** | Demote or remove; do not leave zombie equal-weight UI | Remove/repurpose pins; rewrite description; fix active nav |
| **Density overflow** | Progressive disclosure or split screen — never endless equal cards | Collapse to filters/tabs/inspector; or split file |

**Hard rules for updates:**

1. **Read the current page (and README) first** — reconstruct the existing region map and priority stack before editing.
2. **Name the IA delta** in your reasoning (and briefly in `description` or a global note when the hierarchy changed): what was P0 before, what is P0 after.
3. **Prefer re-homing over stacking** — if a new filter, metric, or action is added, place it where the hierarchy says it belongs; do not append a fifth equal card under four existing ones.
4. **Renumber pins when scan order changes** — pin order is part of the IA narrative.
5. **Keep sibling screens consistent** — if nav, IA module boundaries, or shared chrome change, update related files in the same pass when the user is editing the product set.
6. **Reject pure accretion** when it creates two primaries, duplicate entry points, or a "misc" dumping ground region.

Worked intuition: user asks to "add AI summary to the ticket list."  
- Bad: another full-width card above the list (steals P0, breaks triage job).  
- Better IA: summary as **selection-dependent secondary** in an inspector, or a one-line insight in the list toolbar, with full summary in annotation enums — primary remains the list.

## 2. Recursive decomposition (L1–L5)

Apply this top-down to every pinned region **after** the page IA region map is fixed. L1 pins should map 1:1 onto IA regions (chrome / primary / secondary…), not onto random widgets. Stop nesting when further splitting adds no implementation value.

| Level | Element                                      | Purpose                                                                                        |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| L1    | `<annotation id="N">` (pinned)               | Structural area of the page: navbar, sidebar, filter bar, table, drawer                        |
| L2    | Nested `<annotation>`                        | Distinct responsibility inside the region: one column, a form field group, the bulk-action bar |
| L3    | `<enum>` or nested annotation containing one | Mutually exclusive states for that element: default/focus/filled/error; collapsed/expanded     |
| L4    | `<enum-item>` + `description`                | What each state means: trigger, threshold, transition, permission gate                         |
| L5    | Deepest annotation/enum                      | Extremes and failure modes: 0/empty/overflow values, race conditions, permission denials       |

A simple stat card may stop at L3. A data table with a detail drawer routinely reaches L5. Let the domain decide depth; let completeness decide breadth. **IA decides which L1 regions exist; decomposition decides how deep each goes.**

## 3. Coverage-matrix method

Completeness in complex apps is combinatorial, not a flat list. When two or more axes interact, enumerate the **product**, not each axis alone:

- **permission × state** — detail-drawer buttons differ by role _and_ by ticket status.
- **role × data-size** — admin view of 5000 rows vs agent view of 7 rows.
- **flow-step × validation** — each wizard step × (valid / invalid / pending).
- **read-state × SLA × selection** — a table row's appearance is the product of all three.

Build the matrix mentally, drop impossible cells, and create one `<enum-item>` per surviving combination. If a cell is intentionally out of scope, say so in an annotation rather than leaving it blank.

## 4. Annotation body structure

L1/L2 bodies must read like a spec, not a caption. For a non-trivial region, cover the relevant subset in plain prose — one or two precise sentences each:

- **IA role** — primary / secondary / chrome / transient; why this region exists for the page job.
- **Trigger / entry condition** — what causes this to appear or activate.
- **Data source & refresh** — where values come from, polling/refresh cadence.
- **State enumeration** — which states exist (then expand them in `<enum>`).
- **Permission gate** — which roles see/use it, what changes per role.
- **Validation rule** — required fields, formats, cross-field constraints.
- **Error / async handling** — loading, empty, partial-failure, retry behavior.
- **Boundary values** — limits, overflow, truncation, zero/critical states.

"Compact" means no padding — it does **not** mean omitting a dimension that matters. Completeness wins over brevity; precision wins over length.

### 4.1 Cross-cutting concerns → `<annotation-global>`

Some notes don't belong to any single pinned region: a role/permission matrix that spans the whole page, a global empty/error/loading policy, a glossary of domain terms, page-wide conventions, **or the page-level IA summary** (purpose + priority stack) when it helps implementers. **Do not** invent a numbered annotation for these — a numbered annotation must always have a matching pin. Put them in `<annotation-global label="…">`, which is pin-less by design and renders at the top of the annotation pane (the "0th" annotation):

```html
<annotation-global label="角色权限矩阵">
  三类角色能力差异，供研发实现 RBAC、QA 设计权限用例。
  <enum>
    <enum-item label="管理员" description="全量读写"></enum-item>
    <enum-item label="成员" description="读写本人"></enum-item>
    <enum-item label="只读" description="仅查看与导出"></enum-item>
  </enum>
</annotation-global>
```

### 4.2 Cross-page links and diagrams

- **`<anchor to="other.rpml" section="N" label="…">`** — explicit jump control in annotation bodies / flow notes; `section` deep-links a target annotation.
- **`link="other.rpml"`** (+ optional `link-section`) on snapshot elements — marks the real UI control as a cross-page jump (chip + ⌘/Ctrl+click in workbench). **Required** when the annotation describes navigation: never prose-only "goes to X".
- **`<diagram>`** — render a Mermaid flow / state / sequence / ER diagram inside an annotation to specify a state machine or flow precisely. Put the diagram header (`graph TD`, `stateDiagram-v2`, …) on its own line. For product-level IA, a site-map or nav diagram in README is preferred over inventing ad-hoc nav on every screen.

## 5. Quality bar

A prototype meets the bar when a reviewer reading it has no remaining "but what happens when…" questions — **and** can restate the page's primary job and region hierarchy without guessing.

Concrete targets:

- **IA before layout.** Purpose, priority stack, and region map were decided before markup; the snapshot visibly expresses that hierarchy.
- **One annotation per pinned region — no target count.** Pin and annotate every meaningful region the page actually has. A dense admin page has many; a simple form has few. Never pad to a number, never drop a real region to stay under one. _Completeness decides breadth; the page decides the count._
- **Depth follows complexity.** Nest as deep as the region warrants — a stat card stays shallow, a data table with a detail drawer goes deep. Don't force uniform depth.
- **Strict pin↔annotation parity.** Every `data-pin="N"` ↔ exactly one numbered `<annotation id="N">`, both directions. A numbered annotation with no pin is a defect. Cross-cutting notes go in `<annotation-global>` (see §4.1), not an orphan numbered annotation.
- **Every conditional branch** in `<enum>` — states, permission variants, validation outcomes, async results.
- **Implementation-depth annotation bodies**: IA role, trigger conditions, data source, state-machine transitions, permission gates, validation rules, error handling, boundary values.
- **Updates restructure when needed.** No pure accretion that creates dual primaries or orphan dump regions.

Reference: [`example-reference.rpml`](example-reference.rpml) (bundled with this skill) — implementation-level bodies, every overlay modeled as trigger → result, with cross-cutting concerns in `<annotation-global>`. Study it before authoring; it is the complexity bar.

## 6. What NOT to do

- Do not use `div`, `button`, `input`, or `table` for product UI. Use RPML primitives only.
- Do not add `onclick`, hover behavior, runtime focus, timers, API calls, or framework state.
- Do not import external CSS, image CDNs, or icon CDNs. The runtime provides inline SVG icons.
- Do not use `position:absolute` or `position:fixed` in snapshot content. RPUI owns pin positioning.
- Do not place overlays (`modal`, `drawer`, `dropdown`, `popover`, `tooltip`, `toast`) in the main snapshot. Pin the trigger; render the overlay inside its annotation enum.
- Do not stack mutually exclusive states (empty + loading + modal) side by side in the snapshot.
- Use bare RPML tags. Single-word elements have no suffix (`button`, `table`); compound names keep their hyphen (`list-item`, `table-row`); platform primitives use `ios-*`.
- Do not omit a plausible state because the input didn't mention it; infer and annotate.
- **Do not lay out before IA** — no columns, cards, or tabs until purpose, priority stack, and region map are fixed.
- **Do not update by pure append** — re-rank hierarchy; restructure regions when new content changes the primary job.
- **Do not create two visual primaries** or a catch-all "other" region to avoid IA decisions.

## 7. Validation

Run the validator after generating:

```
bun run validate <file.rpml>
```

The validator checks:

- Every `data-pin="N"` has a matching top-level `<annotation id="N">`.
- Pin numbers are continuous from 1 with no gaps.
- Structural constraints (page root, exactly one view, etc.).

Fix all reported errors before delivering the file. After structural validation, re-check the IA checklist in §1b.4 yourself — the machine validator does not know your hierarchy.
