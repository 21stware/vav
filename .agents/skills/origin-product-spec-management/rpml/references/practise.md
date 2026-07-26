# RPML Generation Practices

The single reference for _how_ to decompose a page into a complete RPML prototype. `SKILL.md` routes here for method depth; the runnable system prompt is `prompts/generate-rpml.md`.

## 1. Inputs to gather before generating

Collect in priority order:

1. **Product requirement / user story** — the feature, route, and user goal.
2. **Screenshot or design draft** — identifies regions, layout, and density.
3. **Existing code with conditionals** — read every `v-if`, `&&`, ternary, and guard; each is a state to enumerate.
4. **Permission matrix / role notes** — which roles exist and what differs per role.
5. **Known async states** — loading, empty, error, retry, partial-failure, timeout.

If any input is missing, infer common SaaS/product states and make every assumption explicit in an annotation. Never silently omit a plausible state.

## 2. Recursive decomposition (L1–L5)

Apply this top-down to every pinned region. Stop when further splitting adds no implementation value.

| Level | Element                                      | Purpose                                                                                        |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| L1    | `<annotation id="N">` (pinned)               | Structural area of the page: navbar, sidebar, filter bar, table, drawer                        |
| L2    | Nested `<annotation>`                        | Distinct responsibility inside the region: one column, a form field group, the bulk-action bar |
| L3    | `<enum>` or nested annotation containing one | Mutually exclusive states for that element: default/focus/filled/error; collapsed/expanded     |
| L4    | `<enum-item>` + `description`                | What each state means: trigger, threshold, transition, permission gate                         |
| L5    | Deepest annotation/enum                      | Extremes and failure modes: 0/empty/overflow values, race conditions, permission denials       |

A simple stat card may stop at L3. A data table with a detail drawer routinely reaches L5. Let the domain decide depth; let completeness decide breadth.

## 3. Coverage-matrix method

Completeness in complex apps is combinatorial, not a flat list. When two or more axes interact, enumerate the **product**, not each axis alone:

- **permission × state** — detail-drawer buttons differ by role _and_ by ticket status.
- **role × data-size** — admin view of 5000 rows vs agent view of 7 rows.
- **flow-step × validation** — each wizard step × (valid / invalid / pending).
- **read-state × SLA × selection** — a table row's appearance is the product of all three.

Build the matrix mentally, drop impossible cells, and create one `<enum-item>` per surviving combination. If a cell is intentionally out of scope, say so in an annotation rather than leaving it blank.

## 4. Annotation body structure

L1/L2 bodies must read like a spec, not a caption. For a non-trivial region, cover the relevant subset in plain prose — one or two precise sentences each:

- **Trigger / entry condition** — what causes this to appear or activate.
- **Data source & refresh** — where values come from, polling/refresh cadence.
- **State enumeration** — which states exist (then expand them in `<enum>`).
- **Permission gate** — which roles see/use it, what changes per role.
- **Validation rule** — required fields, formats, cross-field constraints.
- **Error / async handling** — loading, empty, partial-failure, retry behavior.
- **Boundary values** — limits, overflow, truncation, zero/critical states.

"Compact" means no padding — it does **not** mean omitting a dimension that matters. Completeness wins over brevity; precision wins over length.

### 4.1 Cross-cutting concerns → `<annotation-global>`

Some notes don't belong to any single pinned region: a role/permission matrix that spans the whole page, a global empty/error/loading policy, a glossary of domain terms, page-wide conventions. **Do not** invent a numbered annotation for these — a numbered annotation must always have a matching pin. Put them in `<annotation-global label="…">`, which is pin-less by design and renders at the top of the annotation pane (the "0th" annotation):

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

- **`<anchor to="other.rpml" section="N" label="…">`** — link to another screen in the file set; `section` optionally deep-links a specific annotation on the target. Use for flow transitions and drill-downs so the set reads as one connected product.
- **`<diagram>`** — render a Mermaid flow / state / sequence / ER diagram inside an annotation to specify a state machine or flow precisely. Put the diagram header (`graph TD`, `stateDiagram-v2`, …) on its own line.

## 5. Quality bar

A prototype meets the bar when a reviewer reading it has no remaining "but what happens when…" questions.

Concrete targets:

- **One annotation per pinned region — no target count.** Pin and annotate every meaningful region the page actually has. A dense admin page has many; a simple form has few. Never pad to a number, never drop a real region to stay under one. _Completeness decides breadth; the page decides the count._
- **Depth follows complexity.** Nest as deep as the region warrants — a stat card stays shallow, a data table with a detail drawer goes deep. Don't force uniform depth.
- **Strict pin↔annotation parity.** Every `data-pin="N"` ↔ exactly one numbered `<annotation id="N">`, both directions. A numbered annotation with no pin is a defect. Cross-cutting notes go in `<annotation-global>` (see §4.1), not an orphan numbered annotation.
- **Every conditional branch** in `<enum>` — states, permission variants, validation outcomes, async results.
- **Implementation-depth annotation bodies**: trigger conditions, data source, state-machine transitions, permission gates, validation rules, error handling, boundary values.

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

## 7. Validation

Run the validator after generating:

```
bun run validate <file.rpml>
```

The validator checks:

- Every `data-pin="N"` has a matching top-level `<annotation id="N">`.
- Pin numbers are continuous from 1 with no gaps.
- Structural constraints (page root, exactly one view, etc.).

Fix all reported errors before delivering the file.
