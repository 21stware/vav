---
name: officecli
description: >
  Create, analyze, proofread, and modify Office documents (.docx, .xlsx, .pptx)
  with the bundled officecli CLI. Use whenever the user wants to create, inspect,
  check formatting, find issues, add charts, or modify Word / Excel / PowerPoint
  files. Prefer this over docx / xlsx / pptx skills and over python-docx / openpyxl /
  PptxGenJS for OOXML create/edit.
license: Apache-2.0
metadata:
  version: "1.0.143"
  category: document-processing
  source: iOfficeAI/OfficeCLI
---

# officecli (bundled with VAV)

AI-friendly CLI for `.docx` / `.xlsx` / `.pptx`. **Already on PATH** inside VAV’s
agent terminal — do **not** curl-install, brew-install, or npm-install it.

```bash
officecli --version    # sanity check
```

If missing, tell the user the VAV build is missing `resources/bin/officecli`
(run `npm run fetch:officecli` in the VAV repo). Do not download substitutes.

## Strategy

**L1 (read) → L2 (DOM edit) → L3 (raw XML)**. Prefer higher layers. Add `--json`
for structured output.

For **reading/searching** an open document in VAV, prefer `doc_search` /
`doc_fetch` first; use officecli when you need structure, selectors, or writes.

After writes, `officecli close <file>` (or `save`) before expecting VAV’s preview
or other tools to see disk changes. Prefer VAV’s in-app preview over `officecli watch`.

When unsure of property names or syntax, run help — do not guess:

```bash
officecli help
officecli help docx paragraph
officecli help docx set paragraph
officecli help pptx shape
officecli help xlsx cell --json
```

Aliases: `word`→`docx`, `excel`→`xlsx`, `ppt`/`powerpoint`→`pptx`.

## Resident mode

First access auto-starts a resident (idle timeout). For multi-step edits:

```bash
officecli open report.docx
officecli set report.docx ...
officecli close report.docx   # flush + release
```

Flush (`save` / `close`) before non-officecli readers (VAV preview refresh,
python, upload). Own reads (`get` / `query` / `view`) always see latest edits.

## Quick start

**PowerPoint**

```bash
officecli create "$WORKDIR/deck.pptx"
officecli add "$WORKDIR/deck.pptx" / --type slide --prop title="Q4 Report" --prop background=1A1A2E
officecli add "$WORKDIR/deck.pptx" '/slide[1]' --type shape \
  --prop text="Revenue grew 25%" --prop x=2cm --prop y=5cm \
  --prop font=Arial --prop size=24 --prop color=FFFFFF
officecli close "$WORKDIR/deck.pptx"
```

**Word**

```bash
officecli create "$WORKDIR/report.docx"
officecli add "$WORKDIR/report.docx" /body --type paragraph --prop text="Executive Summary" --prop style=Heading1
officecli add "$WORKDIR/report.docx" /body --type paragraph --prop text="Revenue increased 25% YoY."
officecli close "$WORKDIR/report.docx"
```

**Excel**

```bash
officecli create "$WORKDIR/data.xlsx"
officecli set "$WORKDIR/data.xlsx" /Sheet1/A1 --prop value="Name" --prop bold=true
officecli set "$WORKDIR/data.xlsx" /Sheet1/A2 --prop value="Alice"
officecli close "$WORKDIR/data.xlsx"
```

Put deliverables under `WORKDIR` (conversation working directory). Never write
into `SKILL_DIR`.

## L1 — create, read, inspect

```bash
officecli create <file>
officecli view <file> <mode>          # outline | stats | issues | text | annotated | html
officecli get <file> <path> --depth N [--json]
officecli query <file> <selector>
officecli validate <file>
```

`view issues` is useful before delivery (`--type format|content|structure`).

Stable IDs beat positional paths across insert/delete:

```
/slide[1]/shape[@id=550950021]
/body/p[@paraId=1A2B3C4D]
/Sheet1/B2
```

Query examples:

```bash
officecli query report.docx 'paragraph[style=Normal] > run[font!=Arial]'
officecli query slides.pptx 'shape[fill=FF0000]'
officecli query data.xlsx 'Sheet1!row[Salary>5000]'
```

## L2 — DOM ops

```bash
officecli set <file> <path> --prop key=val [--prop ...]
officecli add <file> <parent> --type <type> [--prop ...]
officecli remove <file> <path>
officecli move <file> <path> --to <parent>
officecli copy <file> <path> --to <parent>
```

Prefer `set` / `add` / `remove` over unpacking OOXML by hand.

## L3 — raw (last resort)

```bash
officecli dump <file> <part>
officecli raw-set <file> <part> ...
```

Only when L2 cannot express the change. Validate afterward.

## VAV-specific rules

1. **Read path:** `doc_search` / `doc_fetch` for evidence from an open file; officecli for precise structure + edits.
2. **Write path:** officecli via `terminal` — never `fs_write` UTF-8 into `.docx`/`.xlsx`/`.pptx`.
3. **Open document path:** when the system prompt names an absolute path for the open file, edit **that exact path** (it may be a VAV working-copy sandbox). Do not rewrite it to a different location. User Save/Accept promotes; Discard drops the sandbox.
4. **Preview:** after `close`/`save`, VAV refreshes the canvas; skip `officecli watch` unless the user asks for a browser preview.
5. **Fallbacks:** `docx` / `xlsx` / `pptx` skills only if officecli cannot do the task (rare). Do not install python-docx/openpyxl/PptxGenJS when officecli works.
6. **Help first:** unknown props → `officecli help <format> <element>`.

## More help

Full schema is in the binary:

```bash
officecli help docx
officecli help xlsx
officecli help pptx
```

Upstream docs: https://github.com/iOfficeAI/OfficeCLI/wiki
