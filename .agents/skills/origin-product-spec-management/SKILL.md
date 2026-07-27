---
name: origin-product-spec-management
description: Read, author, validate, and stay in sync with Origin product design specs written in RPML. Prefer Origin MCP tools when connected; otherwise use the originai CLI. Use when reading a project's design specs, implementing code from them, tracking release diffs, writing specs back from a codebase, or checking that code matches the defined product.
---

# Origin Product Spec Management

This skill connects [Origin](https://getoriginai.com) product design specs to your
coding agent. Origin specs are **RPML** documents — each `.rpml` file is one
screen/region describing every state, permission variant, and edge case in a
single annotated layout.

**Tools (preferred order):**
1. **Origin MCP tools** — when `get_diff`, `list_documents`, `whoami`, etc. are
   available in this session, **use them**. Do not shell out to the CLI for the
   same operation. (Claude Code plugin runs local `originai mcp`; remote clients
   may use `https://mcp.getoriginai.com`.)
2. **`originai` CLI** (`bunx originai` / `npx originai`) — fallback when MCP is
   not connected (Codex, Pi, Hermes, OpenCode, skills.sh installs, CI). Never
   invent raw HTTP/curl against the API.

## Setup

**Once per machine (auth):**
```bash
npx originai login
# stores token in ~/.origin/settings.json — never commit
```

**Once per product repo (bind project + optional skill files):**
```bash
npx originai link --project feea5b82-31bd-4418-a57f-23bc4042e8ff
# or: --skill / --claude-code / --codex / --cursor / --all
```

Project config is in `.origin.json` (committed, no secrets):
```json
{
  "api_url": "https://vehcxhxmmfasujqtwdat.supabase.co/functions/v1/origin-api",
  "project_id": "feea5b82-31bd-4418-a57f-23bc4042e8ff",
  "release_hash": null,
  "sync_readme_badge": false
}
```
(`sync_readme_badge` is optional — omit until the user has been asked; `true` keeps the README badge updated on `sync`.)


**Token model**
- **Humans (default):** `npx originai login` → `~/.origin/settings.json`.
  Claude Code plugin MCP uses local `originai mcp`, which reads this store.
- **CI / headless / remote-only MCP hosts:** `ORIGIN_TOKEN=oat_…`
  (create under Origin Settings → Access tokens). Never commit.
- Diagnose: `npx originai doctor`.

## Sync model (how the repo and Origin stay in sync)

`.origin.json` binds this repo to one Origin project and carries the sync pointer:

- `project_id` — the bound Origin project.
- `release_hash` — the last **published release** this repo synced to. This is
  the anchor for two-way sync. Origin shows every release's hash in its UI, so
  the hash in `.origin.json` tells you exactly which release the code reflects.

All read commands (`list-documents`, `get-document`, `grep`, `find`, `get-diff`)
read the **latest published release snapshot** by default — never the live
workspace. So you always work against formally released specs, not in-progress
edits. Pass `--read-type workspace` to read the live `rpml_files` tree instead
(use this when indexing a pre-release project — see Workflow C), or
`--release-tag <hash>` to pin a read to a specific published release.

**Write commands (`write-document`, `delete-document`) only work when the project
has no published release yet.** Once a release exists, the workspace becomes the
user's authority — specs must be edited in the Origin workbench, not via the API.
This prevents stale-snapshot overwrites: the agent reads a release snapshot, and
if it could also write, it might clobber in-progress workbench edits based on
outdated understanding.

There are two directions, and knowing which one you are in matters:

- **Origin → repo (pull & implement).** The project was designed in Origin.
  Run `get-diff` (read-only — does **not** advance the hash). The response always
  includes a unified `diff` with +/- markers for every change, and by default also
  embeds to-side full `content`. **Read `diff` first** — that is the change set.
  Use `content` when you need the whole file. Then `sync` to advance
  `release_hash`. Do **not** script a `get-document` loop over the diff ids.
  This is Workflow A/B below.

- **Repo → Origin (index & write).** The Origin project has **no release yet**.
  Read the codebase, author RPML content, `validate --content`, then
  `write-document --content` to push it **directly to Origin** — do **not** save
  `.rpml` files locally. Needs a read-write token. Read back what you wrote with
  `list-documents --read-type workspace` (the default release read returns 404
  until a release is published). The user then publishes a release in Origin,
  producing a new hash your next `get-diff` will sync to.
  **After the first release is published, the agent can no longer write** —
  further spec edits happen in the Origin workbench. This is Workflow C below.

Always keep `.origin.json` committed so every teammate shares the same sync
pointer; never commit the token.

## Release badge (optional README) — how to add it

Public release pages ship a Markdown badge image:
`https://spec.getoriginai.com/<project_id>/<release_hash>/badge-dark.svg`
(also `badge-light.svg`).

**Never add or edit the badge silently.** Follow this procedure when the user
asks for a badge, or after a successful `sync` if `.origin.json` has no
`sync_readme_badge` field yet (ask once, then stop asking).

### Step-by-step (agent)

1. **Read** `.origin.json` and take `project_id` + `release_hash`.
   - If `release_hash` is `null`, run `bunx originai get-diff` (or MCP
     `get_diff`) and use the response `to_hash` as the release hash. If there
     is no published release yet, tell the user to publish in Origin first —
     do not invent a hash.
2. **Ask the user** (quote this intent):  
   “Add an originai release badge to `README.md` and keep it updated on
   `originai sync`? (yes / no)”
3. **On decline**: set in `.origin.json`: `"sync_readme_badge": false`
   (keep other fields). Commit if appropriate. Stop.
4. **On agree**:
   - Set `"sync_readme_badge": true` in `.origin.json` (merge; do not wipe
     `api_url` / `project_id` / `release_hash`).
   - Ensure root `README.md` exists (create a minimal one if missing).
   - Insert or replace this **exact** marker block (substitute real ids from
     step 1; prefer `badge-dark`):

```md
<!-- originai-release-badge:start -->
[![originai](https://spec.getoriginai.com/PROJECT_ID/RELEASE_HASH/badge-dark.svg)](https://spec.getoriginai.com/PROJECT_ID/RELEASE_HASH)
<!-- originai-release-badge:end -->
```

   - Place the block after the first `#` heading, or at the top of the file.
   - If the markers already exist, replace only the content between them.
5. **Optional**: run `bunx originai sync` so a newer CLI can refresh the same
   marker block when `release_hash` advances. If sync asks about the badge and
   the field is already set, it will not ask again.
6. Show the user the badge Markdown and remind them to commit
   `.origin.json` + `README.md`.

### Rules

- Do **not** set `sync_readme_badge` without an explicit yes/no from the user.
- Do **not** edit README badge content when `sync_readme_badge` is `false`.
- When `sync_readme_badge` is `true` and you advance `release_hash` via sync,
  update the marker block to the new hash (or rely on `originai sync` to do it).

## Understanding RPML (read this before authoring)

RPML replaces time with space: one `.rpml` = one `<page>` with exactly one
`<view>`, snapshot built from RPML primitives, `data-pin="N"` on every meaningful
region, and a matching top-level `<annotation id="N">` per pin. Conditional states
go in `<enum>`; cross-cutting notes in `<annotation-global>`. Read the bundled
references **in `rpml/`** (do not re-derive them):

- `rpml/references/spec-summary.md` — root structure, attributes, rules at a glance.
- `rpml/references/element-index.md` — every element + its attributes.
- `rpml/references/practise.md` — the authoring method (IA-first, update restructure, recursive decomposition, coverage matrix).
- `rpml/references/example-reference.rpml` — a complete worked example (the quality bar).
- `rpml/prompts/generate-rpml.md` — author a new `.rpml` from requirements/code (IA gate before layout).
- `rpml/prompts/rpml-to-code.md` — extract a spec from `.rpml` and implement it.
- `rpml/prompts/rpml-diff-impact.md` — classify what changed between two versions.
- `rpml/prompts/review-rpml.md` — check an existing `.rpml` for completeness.

## Tools & commands

**Never construct raw HTTP (curl/fetch) to Origin yourself.** Use MCP tools or
the `originai` CLI only.

### A. Origin MCP (preferred when connected)

Local bridge (Claude plugin default): `npx originai mcp` (uses `originai login`).
Remote HTTP (advanced/CI): `https://mcp.getoriginai.com` with Bearer `ORIGIN_TOKEN`.
Tool names match origin-api actions (snake_case). Pass `project_id` from
`.origin.json` when required. Default reads = latest **published release**.

| MCP tool | Use for |
|----------|---------|
| `whoami` | Token owner + project count |
| `list_projects` | Owned projects + latest release hash |
| `create_project` | New empty project |
| `list_documents` | File tree (`read_type`: release\|workspace) |
| `get_document` | One file + content |
| `get_diff` | Unified diff between hashes; default embeds to-side content. Prefer this over looping `get_document`. |
| `grep_documents` / `find_documents` | Search content / names |
| `write_document` / `delete_document` / `delete_documents` | Workspace writes (**403 after first release**) |
| `validate` | RPML check (`source` and/or `file_id`) |

**MCP has no `sync` tool.** After implementing a release, advance the local
pointer with CLI: `bunx originai sync` (updates `.origin.json` `release_hash`).
Or pass explicit `hash` / `to_hash` on the next `get_diff`.

### B. originai CLI (fallback)

Prefer `bunx originai <command>` (~40ms) over `npx originai` (~1.2s).

| Command | Description |
|---------|-------------|
| `list-projects` | List accessible projects |
| `create-project --name "<n>" [--description "<d>"]` | Create a new empty project (read-write) |
| `list-documents` | File tree from latest release (or `--read-type workspace` for the live tree) |
| `get-document --id <file-id>` | Get single document with content |
| `get-diff` (`diff`) | Diff since last sync (read-only). **Always** returns unified `diff` (+/- markers). Default also embeds to-side `content`. Prefer `diff` for implementation; do **not** loop `get-document`. `--from-hash`/`--to-hash`; `--content-mode none\|to\|both` |
| `sync` | Advance `release_hash` to the latest release (after implementing a diff) |
| `grep --pattern "<regex>" -p <project-id>` | Search content across files in latest release |
| `find --file-pattern "<regex>" -p <project-id>` | Find files by name in latest release |
| `validate --content "<rpml>"` (`-c`) | Validate an inline RPML string **locally** (no network, no token) |
| `validate --id <file-id>` (`-i`) | Validate a released document (remote — reads latest release) |
| `write-document --name "<name>" --content "<rpml>"` | Create/update file (read-write token) |
| `write-document --id <id> --name "<name>" --content "<rpml>"` | Update existing file |
| `delete-document --id <file-id>` | Delete file (read-write token) |
| `delete-documents --ids <id1>,<id2>,...` | Batch delete files (read-write token) |

Short aliases: `ls`, `ls-docs`, `get`, `create`, `write`, `delete`/`rm`, `diff`.
Flags: `-p` project, `-i` id, `-n` name, `-c` content. Project-scoped commands
need `-p` or `.origin.json`.

**CLI output:** data commands print pure JSON on stdout (pipe to `jq`); tips go
to stderr.

All reads default to the **latest published release**. `--read-type workspace`
(or MCP `read_type: "workspace"`) for live pre-release trees.

## Workflows

**A. Understand a project's specs → implement**
1. `get-diff` (read-only). Response includes `summary` + `files[]`. Each change has a unified **`diff`** (+/- markers). Default also embeds to-side `content`. **Implement from `diff` first** — do **not** loop `list-documents` / `get-document` for every file.
2. `get-document` only for an unchanged dependency; prefer `grep`/`find` to locate it. Follow `rpml/prompts/rpml-to-code.md`.
3. `sync` to advance `release_hash` once the code reflects the latest release.
4. **Release badge (optional):** if `.origin.json` has no `sync_readme_badge` yet, follow **Release badge** above — ask the user, then write the flag + README marker block (never silently).

**B. Track a new release → implement the diff (scenario: spec changed)**
1. `get-diff` returns added/modified/renamed/deleted files with **unified `diff` (+/- markers) always**, plus to-side full `content` by default (omit bodies with `--content-mode none`).
2. Classify impact per `rpml/prompts/rpml-diff-impact.md`, then implement only what changed — apply each file's `diff` first; use `content` when you need the full to-side body.
3. `sync` to advance `release_hash` once implemented.
4. If `sync_readme_badge` is `true`, refresh the README badge marker block to the new `release_hash` (see **Release badge**).

**C. Index a codebase → write specs directly to Origin (no local files)**

Judge the project phase by running `list-projects` (check `latest_release`) and,
if a release exists, `list-documents`:

- **Empty project (no release, no documents)** — Initialize **fully** in one
  pass. Write `README.rpml` **first** — it is the product-design document
  (`mode="doc"`), not a prototype screen. Author it from your understanding of
  the codebase, `validate --content`, then `write-document --name "README.rpml"
  --content "<rpml>"` to push it to Origin.

  Then **immediately continue**: for every page/route listed in the README's
  page/route planning, author one `.rpml` prototype screen spec, `validate
  --content`, and `write-document` it to Origin. Do **not** stop and wait after
  the README — drive the whole initialization to completion in this pass. Only
  pause if the user explicitly asks to review the README before screens.

  `README.rpml` must cover: product overview, functional modules, page/route
  planning (complete and self-consistent — include login/signup flow, admin
  screens, and core product logic with no gaps), key interaction flows
  (`<diagram>` with Mermaid), and roles/permissions if applicable. For mobile
  pages, include tab structure and main UX flow descriptions. The page/route
  planning section is the worklist for the screen specs you write next — make
  it exhaustive, because every entry becomes a `.rpml`.

  Skeleton:
  ```html
  <page title="Product Name - Product Design Document" mode="doc">
    <doc-heading level="1">Product Name</doc-heading>
    <doc-paragraph>Overview…</doc-paragraph>
    <doc-list type="bullet">
      <doc-list-item>Product flow</doc-list-item>
    </doc-list>
    <diagram> // core user flow
  graph TD
    A[User login] --> B[Enter home]
    </diagram>
    <diagram> // core feature conversion
  graph TD
    A[User login] --> B[Enter home]
    </diagram>
    <doc-list type="bullet">
      <doc-list-item>Feature breakdown by priority</doc-list-item>
    </doc-list>
  </page>
  ```

  After writing all specs, run `list-documents --read-type workspace` and
  confirm every page/route in the README has a corresponding `.rpml`. Report
  what was written and any gaps to the user, and remind them to publish a
  release in Origin.

- **Only README.rpml exists** — Continue the initialization: author the
  remaining prototype screen specs (one `.rpml` per page/route the README
  planned that hasn't been written yet), validate + write each, until every
  planned page exists in Origin. Don't wait to be asked — drive it to
  completion, then report and remind the user to publish a release.

- **Prototype screens already exist** — Normal editing: create, update, or delete
  specs as needed.

For every spec you author:
1. Read the relevant code; author RPML content following
   `rpml/prompts/generate-rpml.md` and the references.
2. `validate --content "<rpml>"` — **local** check, no network needed. Fix
   every error before writing. Do **not** save `.rpml` files locally; keep the
   content inline and write directly.
3. `write-document --name "<name>.rpml" --content "<rpml>"` (read-write token).
   Use `create-project` first if no project exists yet.
   **This only works before the first release is published.** If the project
   already has a release, `write-document` will return 403 — specs must then be
   edited in the Origin workbench.

After writing, remind the user to **publish a release in Origin** — the default
reads (`list-documents`, `get-diff`, etc.) cannot see workspace content until a
release is published. To read back what you just wrote **before** publishing,
use `list-documents --read-type workspace` / `get-document --read-type workspace
--id <id>`. **Once a release is published, the agent's write access is
permanently closed**; further spec edits happen in the Origin workbench.

**D. Consistency review (scenario: code has behavior not defined in the specs)**
This is guidance for *you, the agent* to perform — Origin does not auto-detect
gaps. When you notice code implementing a feature/behavior:
1. Search the released specs for it: `grep --pattern "<feature>"` and
   `find --file-pattern "<screen>"`.
2. If no spec covers it, treat it as an **undefined product behavior**. Do NOT
   silently invent or assume the intended design.
3. Report a clear analysis to the user: what the code does, which screen/spec it
   would belong to, and why it appears undefined. Ask whether it should be
   specced, changed, or removed.
4. Only after the user confirms the intended behavior, optionally author the
   spec (`rpml/prompts/generate-rpml.md` → `validate` → `write-document`).

Always `validate --content` RPML before `write-document`. Validation runs
**locally** (no network, no token). Never save `.rpml` files locally — author
content inline and write directly to Origin.

