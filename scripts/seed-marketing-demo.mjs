#!/usr/bin/env node
/**
 * Seeds Application Support with five file-session demos for marketing
 * screenshots (each opened as a standalone file-preview window):
 *   PDF + summary + mermaid
 *   PPTX + modification toolcall
 *   CSV + Vega-Lite + PDF report
 *   DOCX/XLSX + editing
 *   Markdown + modification toolcall
 */
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Local electron-vite / node_modules electron writes to vav-dev.
const profile = process.env.VAV_MARKETING_PROFILE === 'release' ? 'vav' : 'vav-dev'
const dataDir = join(homedir(), 'Library/Application Support', profile)
const convPath = join(dataDir, 'conversations.json')
const settingsPath = join(dataDir, 'settings.json')
const fileSessionsDir = join(dataDir, 'file-sessions')
const fileIndexPath = join(fileSessionsDir, 'index.json')
const samplesDir = join(root, 'docs/marketing-samples')
const now = Date.now()

function id() {
  return randomUUID()
}

function pathHash(path) {
  return createHash('sha256').update(path).digest('hex').slice(0, 24)
}

function identityFor(path) {
  const hash = pathHash(path)
  const info = statSync(path)
  const inodeKey = `${info.dev}:${info.ino}`
  const fileId = `ino-${createHash('sha256').update(inodeKey).digest('hex').slice(0, 20)}`
  return { fileId, inodeKey, pathHash: hash }
}

function baseConv(title, updatedOffset, extras = {}) {
  return {
    id: id(),
    title,
    createdAt: now - updatedOffset - 86_400_000,
    updatedAt: now - updatedOffset,
    workingDirectory: root,
    model: 'deepseek-v4-flash',
    tokensUsed: 12_000,
    tokenLimit: 200_000,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    fileId: null,
    fileReadOnly: false,
    agentBinaryName: null,
    cliHost: null,
    cliResumeCursor: null,
    cliPaneBindings: {},
    focusedFilePath: null,
    compactions: [],
    hostTranscripts: {},
    ...extras
  }
}

function fileSession(path, title, messages, extras = {}) {
  const identity = identityFor(path)
  const a = messages[messages.length - 1]?.id ?? id()
  const conv = baseConv(title, extras.updatedOffset ?? 30 * 60_000, {
    workingDirectory: dirname(path),
    fileId: identity.fileId,
    fileReadOnly: extras.fileReadOnly ?? false,
    focusedFilePath: path,
    activeLeafId: a,
    tokensUsed: extras.tokensUsed ?? 14_000,
    updatedAt: now - (extras.updatedOffset ?? 30 * 60_000) + 60_000,
    messages,
    cacheCreatedAt: now - 10 * 60_000,
    cacheExpiresAt: now + 50 * 60_000
  })
  return { conv, identity, path }
}

const theme = process.env.VAV_MARKETING_THEME === 'dark' ? 'dark' : 'light'

const pptxBuild = spawnSync(
  process.execPath,
  [join(root, 'scripts/generate-marketing-pptx.mjs'), ...(theme === 'dark' ? ['--dark'] : [])],
  { cwd: root, encoding: 'utf8' }
)
if (pptxBuild.status !== 0) {
  console.error(pptxBuild.stderr || pptxBuild.stdout)
  process.exit(pptxBuild.status ?? 1)
}

const pdfPath = join(samplesDir, 'ops-brief.pdf')
const pptxPath = join(samplesDir, 'q3-ops-review.pptx')
const csvPath = join(samplesDir, 'orders.csv')
const xlsxPath = join(samplesDir, 'orders.xlsx')
const docxPath = join(samplesDir, 'partner-brief.docx')
const mdPath = join(samplesDir, 'install-notes.md')
const mmPath = join(samplesDir, 'product-roadmap.mm')
const mmdPath = join(samplesDir, 'auth-flow.mmd')
const clipPath = join(samplesDir, 'restock-board.html')

for (const p of [pdfPath, pptxPath, csvPath, xlsxPath, docxPath, mdPath, mmPath, mmdPath, clipPath]) {
  if (!existsSync(p)) {
    console.error('missing sample file', p)
    process.exit(1)
  }
}

// 1) PDF + agent summary + mermaid
const pdfU = id()
const pdfA = id()
const pdfSession = fileSession(
  pdfPath,
  'Ops brief → summary + flow',
  [
    {
      id: pdfU,
      parentId: null,
      role: 'user',
      content: 'Summarize this brief for stand-up, then sketch the follow-up flow as Mermaid.',
      blocks: [],
      createdAt: now - 20 * 60_000
    },
    {
      id: pdfA,
      parentId: pdfU,
      role: 'assistant',
      content: 'Stand-up summary and a follow-up flow.',
      createdAt: now - 19 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            '**Stand-up**\n\n' +
            '- APAC led shipped revenue this month.\n' +
            '- Pending: AMER WIDGET-A restock, EMEA WIDGET-C.\n' +
            '- Next: cut a region × SKU list from the live sheet.\n\n' +
            '```mermaid\n' +
            'flowchart LR\n' +
            '  A[Read brief] --> B[Region cut]\n' +
            '  B --> C{Pending?}\n' +
            '  C -->|Yes| D[Restock ticket]\n' +
            '  C -->|No| E[Close loop]\n' +
            '  D --> E\n' +
            '```'
        }
      ]
    }
  ],
  { updatedOffset: 18 * 60_000, fileReadOnly: true, tokensUsed: 8_200 }
)

// 2) PPTX + modification toolcall
const pptxU = id()
const pptxA = id()
const tPptxSkill = id()
const tPptxWrite = id()
const pptxSession = fileSession(
  pptxPath,
  'Where we’re blocked',
  [
    {
      id: pptxU,
      parentId: null,
      role: 'user',
      content:
        'I selected the title on slide 2. Keep “Where we’re blocked”, and make each card one concrete risk.',
      blocks: [],
      createdAt: now - 28 * 60_000
    },
    {
      id: pptxA,
      parentId: pptxU,
      role: 'assistant',
      content: 'Updated slide 2 title and bullets in the PPTX.',
      createdAt: now - 27 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tPptxSkill,
          tool: 'load_skill',
          summary: 'Load skill: pptx',
          input: JSON.stringify({ name: 'pptx' }),
          output: 'Loaded skill “pptx”.\nSKILL_DIR=resources/agent-skills/pptx\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tPptxWrite,
          tool: 'fs_write',
          summary: 'Write q3-ops-review.pptx',
          input: JSON.stringify({
            path: 'q3-ops-review.pptx',
            content: '…slide 2 title → Where we’re blocked…'
          }),
          output: 'Wrote q3-ops-review.pptx (3 slides)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Wrote the three cards on slide 2 of `q3-ops-review.pptx`:\n\n' +
            '- **AMER restock** — WIDGET-A × 200, warehouse confirm.\n' +
            '- **EMEA WIDGET-C** — 22 units, expedite or drop.\n' +
            '- **Cancelled noise** — keep WIDGET-B out of totals.\n\n' +
            'Pick any card and ask again — the next write hits the same path.'
        }
      ]
    }
  ],
  { updatedOffset: 26 * 60_000, fileReadOnly: false, tokensUsed: 11_400 }
)

// 3) CSV + vega-lite + PDF report
const csvU = id()
const csvA = id()
const tCsvSkill = id()
const tCsvPdf = id()
const csvSession = fileSession(
  csvPath,
  'Chart regions + PDF report',
  [
    {
      id: csvU,
      parentId: null,
      role: 'user',
      content: 'Plot shipped revenue by region, then write a one-page PDF report.',
      blocks: [],
      createdAt: now - 24 * 60_000
    },
    {
      id: csvA,
      parentId: csvU,
      role: 'assistant',
      content: 'Vega-Lite chart and PDF report written.',
      createdAt: now - 23 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'Shipped-only totals from `orders.csv`:\n\n' +
            '```vega-lite\n' +
            JSON.stringify(
              {
                $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
                data: {
                  values: [
                    { region: 'APAC', revenue: 31312 },
                    { region: 'EMEA', revenue: 10950 },
                    { region: 'AMER', revenue: 13825 }
                  ]
                },
                mark: { type: 'bar', cornerRadiusEnd: 2 },
                encoding: {
                  x: { field: 'region', type: 'nominal', title: null },
                  y: { field: 'revenue', type: 'quantitative', title: 'Shipped $' },
                  color: { value: '#1a1a1a' }
                },
                width: 320,
                height: 160
              },
              null,
              2
            ) +
            '\n```'
        },
        {
          kind: 'toolCall',
          id: tCsvSkill,
          tool: 'load_skill',
          summary: 'Load skill: pdf',
          input: JSON.stringify({ name: 'pdf' }),
          output: 'Loaded skill “pdf”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tCsvPdf,
          tool: 'fs_write',
          summary: 'Write docs/ops-q3.pdf',
          input: JSON.stringify({ path: 'docs/ops-q3.pdf' }),
          output: 'Wrote PDF report to docs/ops-q3.pdf (1 page)',
          status: 'completed'
        },
        {
          kind: 'text',
          text: 'Report saved to `docs/ops-q3.pdf` — open it in a file session to review.'
        }
      ]
    }
  ],
  { updatedOffset: 22 * 60_000, fileReadOnly: true, tokensUsed: 13_800 }
)

// 4) XLSX + editing (DOCX sibling session also seeded)
const xlsxU = id()
const xlsxA = id()
const tXlsxSkill = id()
const tXlsxWrite = id()
const xlsxSession = fileSession(
  xlsxPath,
  'Add restock_units column',
  [
    {
      id: xlsxU,
      parentId: null,
      role: 'user',
      content: 'Add a restock_units column on Orders for pending rows, then refresh By region.',
      blocks: [],
      createdAt: now - 16 * 60_000
    },
    {
      id: xlsxA,
      parentId: xlsxU,
      role: 'assistant',
      content: 'Added restock_units and refreshed By region.',
      createdAt: now - 15 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tXlsxSkill,
          tool: 'load_skill',
          summary: 'Load skill: xlsx',
          input: JSON.stringify({ name: 'xlsx' }),
          output: 'Loaded skill “xlsx”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tXlsxWrite,
          tool: 'fs_write',
          summary: 'Write orders.xlsx',
          input: JSON.stringify({
            path: 'orders.xlsx',
            content: '…Orders.restock_units + By region…'
          }),
          output: 'Wrote orders.xlsx (2 sheets)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Edits applied:\n\n' +
            '- **Orders:** `restock_units` = units when `status=pending`, else blank\n' +
            '- **By region:** shipped totals unchanged; pending units called out\n\n' +
            'Flip sheets in the preview to verify.'
        }
      ]
    }
  ],
  { updatedOffset: 14 * 60_000, fileReadOnly: false, tokensUsed: 12_600 }
)

const docxU = id()
const docxA = id()
const tDocxSkill = id()
const tDocxWrite = id()
const docxSession = fileSession(
  docxPath,
  'Rewrite section 2 for FAQ',
  [
    {
      id: docxU,
      parentId: null,
      role: 'user',
      content: 'Rewrite section 2 as partner-facing FAQ bullets.',
      blocks: [],
      createdAt: now - 12 * 60_000
    },
    {
      id: docxA,
      parentId: docxU,
      role: 'assistant',
      content: 'Rewrote section 2 in the DOCX.',
      createdAt: now - 11 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tDocxSkill,
          tool: 'load_skill',
          summary: 'Load skill: docx',
          input: JSON.stringify({ name: 'docx' }),
          output: 'Loaded skill “docx”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tDocxWrite,
          tool: 'fs_write',
          summary: 'Write partner-brief.docx',
          input: JSON.stringify({ path: 'partner-brief.docx' }),
          output: 'Wrote partner-brief.docx',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Section 2 is now FAQ-style:\n\n' +
            '- **Q: What’s pending in AMER?** A: WIDGET-A × 200 — confirm with warehouse.\n' +
            '- **Q: EMEA WIDGET-C?** A: 22 units — expedite or drop from Q3 target.\n' +
            '- **Q: Cancelled rows?** A: Exclude AMER WIDGET-B from fulfillment totals.'
        }
      ]
    }
  ],
  { updatedOffset: 10 * 60_000, fileReadOnly: false, tokensUsed: 9_800 }
)

// 5) Markdown + modification toolcall
const mdU = id()
const mdA = id()
const tMdRead = id()
const tMdWrite = id()
const mdSession = fileSession(
  mdPath,
  'Clarify Gatekeeper steps',
  [
    {
      id: mdU,
      parentId: null,
      role: 'user',
      content: 'Clarify the macOS Gatekeeper steps and add a one-line tip under CLI.',
      blocks: [],
      createdAt: now - 8 * 60_000
    },
    {
      id: mdA,
      parentId: mdU,
      role: 'assistant',
      content: 'Updated install-notes.md.',
      createdAt: now - 7 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tMdRead,
          tool: 'fs_read',
          summary: 'Read install-notes.md',
          input: JSON.stringify({ path: 'install-notes.md' }),
          output: '# Install notes\n\n## macOS\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tMdWrite,
          tool: 'fs_write',
          summary: 'Write install-notes.md',
          input: JSON.stringify({ path: 'install-notes.md' }),
          output: 'Wrote install-notes.md (42 lines)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Changes:\n\n' +
            '- macOS: spelled out **Privacy & Security → Open Anyway** after the first block.\n' +
            '- CLI: tip — `vav .` uses the folder you’re already in.\n\n' +
            'Preview should show the new wording under **macOS** and **CLI**.'
        }
      ]
    }
  ],
  { updatedOffset: 6 * 60_000, fileReadOnly: false, tokensUsed: 7_400 }
)

const mmU = id()
const mmA = id()
const mmSession = fileSession(
  mmPath,
  'Priorities on the map',
  [
    {
      id: mmU,
      parentId: null,
      role: 'user',
      content: 'What should we ship first? Point at the nodes that unblock the rest.',
      blocks: [],
      createdAt: now - 36 * 60_000
    },
    {
      id: mmA,
      parentId: mmU,
      role: 'assistant',
      content: 'Ship file sessions, then charts.',
      createdAt: now - 35 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'From the map, the critical path is **File sessions → Inline charts**.\n\n' +
            '1. **PDF / Office** — ask beside the open file; that is the loop people demo.\n' +
            '2. **CSV / DuckDB** — same window, then a Vega-Lite in chat.\n' +
            '3. **Mind maps** — pick a node, ask, keep the canvas as source of truth.\n\n' +
            'Agent core (streaming, tool cards) already holds. Do not start Swarm until this path is obvious.'
        }
      ]
    }
  ],
  { updatedOffset: 34 * 60_000, fileReadOnly: true, tokensUsed: 6_200 }
)

const mmdU = id()
const mmdA = id()
const mmdSession = fileSession(
  mmdPath,
  'Where does unlock fail?',
  [
    {
      id: mmdU,
      parentId: null,
      role: 'user',
      content: 'Walk the happy path and call out the unlock failure branch.',
      blocks: [],
      createdAt: now - 48 * 60_000
    },
    {
      id: mmdA,
      parentId: mmdU,
      role: 'assistant',
      content: 'Happy path and the locked-keychain branch.',
      createdAt: now - 47 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'Happy path: **Open vav → Keychain unlocked → Bootstrap → Main shell**.\n\n' +
            'Failure branch: if Keychain is locked, we show onboarding, wait for authorize, unlock secrets, then rejoin bootstrap.\n\n' +
            'Nothing after `Bootstrap settings` depends on the Keychain UI — failures stay on the onboarding screen.'
        }
      ]
    }
  ],
  { updatedOffset: 46 * 60_000, fileReadOnly: false, tokensUsed: 5_100 }
)

const clipU = id()
const clipA = id()
const clipSession = fileSession(
  clipPath,
  'Restock board clip',
  [
    {
      id: clipU,
      parentId: null,
      role: 'user',
      content: 'Turn the three region risks into a small interactive board I can pop out.',
      blocks: [],
      createdAt: now - 42 * 60_000
    },
    {
      id: clipA,
      parentId: clipU,
      role: 'assistant',
      content: 'App clip for the restock board.',
      createdAt: now - 41 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'An App Clip in the thread — tap a region, then **View in window** to pop it out.\n\n' +
            '```app\n' +
            readFileSync(clipPath, 'utf8') +
            '\n```'
        }
      ]
    }
  ],
  { updatedOffset: 40 * 60_000, fileReadOnly: false, tokensUsed: 4_800 }
)

const heroU = id()
const heroA = id()
const tList = id()
const tRead = id()
const heroId = id()
const heroConv = baseConv('Summarize what just changed', 4 * 60_000, {
  id: heroId,
  pinned: true,
  pinTime: now - 30_000,
  tokensUsed: 9_400,
  activeLeafId: heroA,
  focusedFilePath: mdPath,
  messages: [
    {
      id: heroU,
      parentId: null,
      role: 'user',
      content: 'Summarize what just changed in this folder.',
      blocks: [],
      createdAt: now - 5 * 60_000,
      contextFile: mdPath
    },
    {
      id: heroA,
      parentId: heroU,
      role: 'assistant',
      content: 'Install notes and the ops brief moved; deck still pending.',
      createdAt: now - 4 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tList,
          tool: 'fs_list',
          summary: 'List marketing-samples',
          input: JSON.stringify({ path: 'docs/marketing-samples' }),
          output:
            'install-notes.md\nops-brief.pdf\norders.csv\norders.xlsx\npartner-brief.docx\nproduct-roadmap.mm\nq3-ops-review.pptx',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tRead,
          tool: 'fs_read',
          summary: 'Read install-notes.md',
          input: JSON.stringify({ path: 'docs/marketing-samples/install-notes.md' }),
          output: '# Install notes\n\n## macOS\n…Gatekeeper…\n## CLI\nvav .',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'In `docs/marketing-samples`:\n\n' +
            '- **install-notes.md** — Gatekeeper steps spelled out; `vav .` tip under CLI.\n' +
            '- **ops-brief.pdf** — stand-up summary + follow-up flow still current.\n' +
            '- **q3-ops-review.pptx** — slide 2 retitled *Where we’re blocked*.\n\n' +
            '```mermaid\n' +
            'flowchart LR\n' +
            '  A[Open folder] --> B[Pick a file]\n' +
            '  B --> C[Ask beside it]\n' +
            '  C --> D[Accept the write]\n' +
            '```'
        }
      ]
    }
  ]
})

const askU = id()
const askA = id()
const askId = id()
const askConv = baseConv('Name this helper', 90_000, {
  id: askId,
  tokensUsed: 2_400,
  activeLeafId: askA,
  messages: [
    {
      id: askU,
      parentId: null,
      role: 'user',
      content: 'Name a function that joins two paths and normalizes `..`.',
      blocks: [],
      createdAt: now - 80_000
    },
    {
      id: askA,
      parentId: askU,
      role: 'assistant',
      content: 'joinResolved',
      createdAt: now - 70_000,
      blocks: [
        {
          kind: 'text',
          text:
            '**`joinResolved(...parts)`** — `path.join` then `path.normalize`.\n\n' +
            'Reads as “join, then resolve dots,” and stays next to `join` / `resolve` in the file.'
        }
      ]
    }
  ]
})

const chartsU = id()
const chartsA = id()
const chartsId = id()
const chartsConv = baseConv('Mermaid + Vega-Lite in the thread', 3 * 60_000, {
  id: chartsId,
  pinned: true,
  pinTime: now - 20_000,
  tokensUsed: 8_100,
  activeLeafId: chartsA,
  messages: [
    {
      id: chartsU,
      parentId: null,
      role: 'user',
      content: 'Draw the follow-up flow, then plot shipped revenue by region.',
      blocks: [],
      createdAt: now - 3 * 60_000
    },
    {
      id: chartsA,
      parentId: chartsU,
      role: 'assistant',
      content: 'Mermaid flow and Vega-Lite bars.',
      createdAt: now - 2 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'Follow-up, then the shipped cut:\n\n' +
            '```mermaid\n' +
            'flowchart LR\n' +
            '  A[Read brief] --> B[Region cut]\n' +
            '  B --> C{Pending?}\n' +
            '  C -->|Yes| D[Restock ticket]\n' +
            '  C -->|No| E[Close loop]\n' +
            '  D --> E\n' +
            '```\n\n' +
            '```vega-lite\n' +
            JSON.stringify(
              {
                $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
                data: {
                  values: [
                    { region: 'APAC', revenue: 31312 },
                    { region: 'EMEA', revenue: 10950 },
                    { region: 'AMER', revenue: 13825 }
                  ]
                },
                mark: { type: 'bar', cornerRadiusEnd: 3 },
                encoding: {
                  x: { field: 'region', type: 'nominal', title: null },
                  y: { field: 'revenue', type: 'quantitative', title: 'Shipped $' },
                  color: { value: '#6b5bc0' }
                },
                width: 360,
                height: 140
              },
              null,
              2
            ) +
            '\n```'
        }
      ]
    }
  ]
})

const swarmU = id()
const swarmA = id()
const swarmId = id()
const swarmConv = baseConv('Swarm · Claude + Codex', 2 * 60_000, {
  id: swarmId,
  pinned: true,
  pinTime: now - 10_000,
  tokensUsed: 0,
  activeLeafId: swarmA,
  messages: [
    {
      id: swarmU,
      parentId: null,
      role: 'user',
      content: 'Claude reviews install-notes.md. Codex sketches the Keychain unlock fix.',
      blocks: [],
      createdAt: now - 90_000
    },
    {
      id: swarmA,
      parentId: swarmU,
      role: 'assistant',
      content: 'Split the surface — one CLI per pane.',
      createdAt: now - 80_000,
      blocks: [
        {
          kind: 'text',
          text: 'Flip to Swarm (⌘⇧C), then ⌘D for a second pane. Pick Claude on the left, Codex on the right.'
        }
      ]
    }
  ]
})

const sessions = [
  pdfSession,
  pptxSession,
  csvSession,
  xlsxSession,
  docxSession,
  mdSession,
  mmSession,
  mmdSession,
  clipSession
]
const conversations = [heroConv, askConv, chartsConv, swarmConv, ...sessions.map((s) => s.conv)]

const fileIndex = { version: 1, byId: {}, byInode: {}, byPathHash: {} }
for (const session of sessions) {
  const { identity, path, conv } = session
  fileIndex.byId[identity.fileId] = {
    fileId: identity.fileId,
    inodeKey: identity.inodeKey,
    path,
    pathHash: identity.pathHash,
    activeSessionId: conv.id,
    sessionIds: [conv.id]
  }
  fileIndex.byInode[identity.inodeKey] = identity.fileId
  fileIndex.byPathHash[identity.pathHash] = identity.fileId
}

mkdirSync(dataDir, { recursive: true })
mkdirSync(fileSessionsDir, { recursive: true })
const convDir = join(dataDir, 'conversations')
if (existsSync(convPath)) copyFileSync(convPath, `${convPath}.bak-marketing`)
if (existsSync(fileIndexPath)) copyFileSync(fileIndexPath, `${fileIndexPath}.bak-marketing`)
if (existsSync(convDir)) {
  const bakDir = `${convDir}.bak-marketing`
  rmSync(bakDir, { recursive: true, force: true })
  cpSync(convDir, bakDir, { recursive: true })
  rmSync(convDir, { recursive: true, force: true })
}
mkdirSync(convDir, { recursive: true })
for (const conversation of conversations) {
  writeFileSync(join(convDir, `${conversation.id}.json`), JSON.stringify(conversation, null, 2))
}
writeFileSync(
  join(convDir, 'index.json'),
  JSON.stringify({ version: 2, ids: conversations.map((c) => c.id) }, null, 2)
)
writeFileSync(fileIndexPath, JSON.stringify(fileIndex, null, 2))

const workingCopies = join(dataDir, 'working-copies')
if (existsSync(workingCopies)) {
  rmSync(workingCopies, { recursive: true, force: true })
  console.log('cleared working-copies')
}

if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings.theme = theme
  settings.locale = 'en'
  settings.fileViewMode = 'tree'
  settings.sidebarGroupingMode = 'workspace'
  settings.defaultModel = 'deepseek-v4-flash'
  settings.defaultAgentId = null
  settings.skipCliAgentPickerWhenSingle = false
  settings.swarmModeEnabled = true
  settings.removedCliAgentIds = []
  settings.cliAgents = [
    { id: 'claude', name: 'Claude Code', binaryPath: 'claude', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
    { id: 'codex', name: 'Codex', binaryPath: 'codex', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
    { id: 'cursor', name: 'Cursor', binaryPath: 'agent', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
    { id: 'grok', name: 'Grok', binaryPath: 'grok', defaultArgs: [], envVars: {}, enabled: true, builtin: true }
  ]
  settings.githubTrayEnabled = false
  settings.cloudflareTrayEnabled = false
  settings.supabaseTrayEnabled = false
  settings.surfacePattern = 'none'
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
} else {
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        theme,
        locale: 'en',
        fileViewMode: 'tree',
        sidebarGroupingMode: 'workspace',
        defaultModel: 'deepseek-v4-flash',
        defaultAgentId: null,
        skipCliAgentPickerWhenSingle: false,
        swarmModeEnabled: true,
        removedCliAgentIds: [],
        cliAgents: [
          { id: 'claude', name: 'Claude Code', binaryPath: 'claude', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
          { id: 'codex', name: 'Codex', binaryPath: 'codex', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
          { id: 'cursor', name: 'Cursor', binaryPath: 'agent', defaultArgs: [], envVars: {}, enabled: true, builtin: true },
          { id: 'grok', name: 'Grok', binaryPath: 'grok', defaultArgs: [], envVars: {}, enabled: true, builtin: true }
        ],
        githubTrayEnabled: false,
        cloudflareTrayEnabled: false,
        supabaseTrayEnabled: false,
        surfacePattern: 'none'
      },
      null,
      2
    )
  )
}

const manifest = {
  theme,
  main: {
    hero: { sessionId: heroId, title: heroConv.title },
    ask: { sessionId: askId, title: askConv.title },
    charts: { sessionId: chartsId, title: chartsConv.title },
    swarm: { sessionId: swarmId, title: swarmConv.title },
    clip: { sessionId: clipSession.conv.id, title: clipSession.conv.title }
  },
  previews: {
    pdf: { path: pdfPath, title: pdfSession.conv.title, sessionId: pdfSession.conv.id },
    pptx: { path: pptxPath, title: pptxSession.conv.title, sessionId: pptxSession.conv.id },
    csv: { path: csvPath, title: csvSession.conv.title, sessionId: csvSession.conv.id },
    xlsx: { path: xlsxPath, title: xlsxSession.conv.title, sessionId: xlsxSession.conv.id },
    docx: { path: docxPath, title: docxSession.conv.title, sessionId: docxSession.conv.id },
    md: { path: mdPath, title: mdSession.conv.title, sessionId: mdSession.conv.id },
    mindmap: { path: mmPath, title: mmSession.conv.title, sessionId: mmSession.conv.id },
    mermaid: { path: mmdPath, title: mmdSession.conv.title, sessionId: mmdSession.conv.id },
    clip: { path: clipPath, title: clipSession.conv.title, sessionId: clipSession.conv.id }
  }
}
writeFileSync(join(samplesDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log('profile', profile)
console.log('userData', dataDir)
console.log('fileSessions', sessions.length)
console.log('manifest', join(samplesDir, 'manifest.json'))
