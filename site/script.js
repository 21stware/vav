;(() => {
  const catalogs = {
    en: {
      'meta.title': 'VAV — local AI agent workbench',
      'meta.description':
        'Local-first agent workbench: pick a slide or a cell, ask beside it, render Mermaid and Vega-Lite in the thread, pop out an App Clip, or split Swarm for Claude and Codex.',
      'a11y.skip': 'Skip to content',
      'nav.core': 'Why VAV',
      'nav.files': 'Files',
      'nav.formats': 'Formats',
      'nav.download': 'Download',
      'theme.group': 'Appearance',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'hero.title': 'Your agents\' workbench.',
      'hero.lead':
        'Pick a slide, a cell, a node — ask beside it. Charts and App Clips render in the thread. Swarm puts Claude next to Codex.',
      'hero.ctaDownload': 'Download',
      'hero.ctaSource': 'Source',
      'core.title': 'The loops that close',
      'core.lead':
        'Not a chat box with a file picker — pick on the document, draw in the thread, pop out a clip, or split two CLIs.',
      'core.officeLabel': 'Pick on the Office file',
      'core.officeBody':
        'Open a deck, a sheet, or a brief. Click the title, a card, a cell — then ask. The agent writes the same path on disk. Not a Word-style canvas.',
      'core.officeNote': 'Selection is the prompt. The file stays the source of truth.',
      'core.chartsLabel': 'Mermaid + Vega-Lite',
      'core.chartsBody':
        'Flows and charts render in the thread — Mermaid for the path, Vega-Lite for the numbers. Copy, download, or open the source file beside the chat.',
      'core.chartsNote': 'Same turn: a flowchart and a bar chart, both live.',
      'core.clipLabel': 'App Clip',
      'core.clipBody':
        'The agent can write a small interactive app in the thread — a board, a calculator, a teaching aid. Pop it out with View in window. It is a real widget, not a screenshot.',
      'core.clipNote': '<code>```app</code> in chat, or a thin overlay from an HTML file.',
      'core.swarmLabel': 'Swarm',
      'core.swarmBody':
        'Flip the surface and split the pane. Claude on the left, Codex on the right — each a real TUI in its own column. ⌘D splits; arrow keys move.',
      'core.swarmNote': 'Optional under Settings → CLI Agents. Off until you want it.',
      'core.hotkeyLabel': '<kbd>⌘⇧↵</kbd> Quick Ask',
      'core.hotkeyBody':
        'From anywhere on your Mac, <kbd>⌘⇧↵</kbd> opens a narrow companion column. Ask one thing — a path join, a regex, a name — get the answer, close it. No full workspace.',
      'core.hotkeyNote': 'Built for the interrupt: short, local, done.',
      'files.title': 'Open any document window',
      'files.lead': 'Mermaid source, PDF, decks, sheets, Markdown — preview on one side, agent on the other.',
      'files.mmdLabel': 'Mermaid file',
      'files.mmdCaption':
        'Open the .mmd as a canvas, pick a node, ask about the failure branch.',
      'files.pdfLabel': 'PDF',
      'files.pdfCaption':
        'Stand-up summary from the brief, then a Mermaid follow-up flow — same window, same turn.',
      'files.pptxLabel': 'PPTX',
      'files.pptxCaption':
        'Load a deck skill, rename a slide, tighten bullets — tool cards show every write.',
      'files.csvLabel': 'CSV / TSV',
      'files.csvCaption':
        'Ask over the sheet, get Vega-Lite in chat, write a one-page PDF report to disk.',
      'files.xlsxLabel': 'DOCX / XLSX',
      'files.xlsxCaption':
        'Skill-backed edits on workbooks and briefs — add a column, refresh, stay in the window.',
      'files.mdLabel': 'Markdown',
      'files.mdCaption':
        'Read the notes, rewrite install steps — every fs_read / fs_write stays auditable in the transcript.',
      'files.chartsLabel': 'Charts in chat',
      'files.chartsCaption':
        'Mermaid flows and Vega-Lite plots render inline — copy, download, keep moving.',
      'formats.title': 'Format knowledge',
      'formats.lead':
        'What each type can do in a document window — preview, ask beside it, edit in place, or convert first. Capabilities match the app, not a wish list.',
      'formats.cap.preview': 'Preview',
      'formats.cap.previewHint': 'Open in a file window',
      'formats.cap.ask': 'Ask',
      'formats.cap.askHint': 'Chat grounded in the open file',
      'formats.cap.edit': 'Edit',
      'formats.cap.editHint': 'In-place edit / agent write to the same path',
      'formats.cap.convert': 'Convert',
      'formats.cap.convertHint': 'Save As a modern format; original untouched',
      'formats.cap.readonly': 'Read-only',
      'formats.cap.readonlyHint': 'Preview + ask; no in-place write',
      'formats.cap.skill': 'Skill',
      'formats.cap.skillHint': 'Agent loads a format skill to create or edit',
      'formats.col.format': 'Format',
      'formats.col.caps': 'Capabilities',
      'formats.col.note': 'Notes',
      'formats.docx.name': 'Word (OOXML)',
      'formats.docx.note':
        'Opens in Read by default; switch to Edit or use the docx skill to write the open path.',
      'formats.doc.name': 'Word (legacy)',
      'formats.doc.note':
        'Preview via convert to DOCX/HTML (macOS). Edit means Convert → Save As .docx; original stays put.',
      'formats.xlsx.name': 'Excel (OOXML)',
      'formats.xlsx.note':
        'Sheet preview + agent edits through the xlsx skill on the same workbook path.',
      'formats.xls.name': 'Excel (legacy)',
      'formats.xls.note':
        'Opens in the spreadsheet preview. To edit, Convert → Save As .xlsx; original untouched.',
      'formats.pptx.name': 'PowerPoint (OOXML)',
      'formats.pptx.note': 'Slide canvas + pptx skill for renames, bullets, and deck writes.',
      'formats.ppt.name': 'PowerPoint (legacy)',
      'formats.ppt.note':
        'No built-in .ppt converter. Export to .pptx first, or open with the system default app.',
      'formats.pdf.name': 'PDF',
      'formats.pdf.note':
        'Preview and ask only in the window. Create, fill, or reformat via the PDF skill to a new path.',
      'formats.csv.name': 'Tables',
      'formats.csv.note': 'Grid preview, charts in chat, direct text writes back to the sheet.',
      'formats.md.name': 'Markdown & text',
      'formats.md.note': 'Full in-place edit; agent fs_read / fs_write on the open file.',
      'formats.diagram.name': 'Mind maps & diagrams',
      'formats.diagram.note':
        'Rendered canvas with pick-to-ask; source stays editable text on disk.',
      'formats.heic.name': 'HEIC image',
      'formats.heic.note': 'View in-app; Edit converts to JPEG via Save As. Original HEIC unchanged.',
      'formats.zip.name': 'ZIP archive',
      'formats.zip.note': 'Structure preview only — not a full archive utility.',
      'download.title': 'Get VAV',
      'download.lead': 'Latest GitHub Release builds. Follow install notes if your OS warns on open.',
      'download.mac': 'macOS · Apple Silicon',
      'download.win': 'Windows · x64',
      'download.install': 'Install notes',
      'download.version': 'Latest: {tag}',
      'download.detected': 'Matched to your machine: {os}',
      'download.osMac': 'macOS',
      'download.osWin': 'Windows',
      'download.cli':
        'From a terminal, <code>vav .</code> opens a session in the current directory (Settings → vav command).',
      'footer.note':
        'Noncommercial license: <a href="https://github.com/21stware/vav/blob/main/LICENSE">LICENSE</a> · Commercial licensing <a href="mailto:licensing@21stware.com">licensing@21stware.com</a>'
    },
    zh: {
      'meta.title': 'VAV — 本机 AI Agent 工作台',
      'meta.description':
        '本机优先的 Agent 工作台：点选幻灯片或单元格再提问；对话里渲染 Mermaid / Vega-Lite；弹出 App Clip；或把 Swarm 拆成 Claude 与 Codex。',
      'a11y.skip': '跳到正文',
      'nav.core': '为什么是 VAV',
      'nav.files': '文档',
      'nav.formats': '格式',
      'nav.download': '下载',
      'theme.group': '外观',
      'theme.light': '浅色',
      'theme.dark': '深色',
      'hero.title': '你的 Agent 工作台。',
      'hero.lead':
        '点选幻灯片、单元格、节点——在旁边提问。对话里出图和 App Clip。Swarm 让 Claude 和 Codex 并排。',
      'hero.ctaDownload': '下载',
      'hero.ctaSource': '源码',
      'core.title': '真正闭环的几件事',
      'core.lead': '不是带文件选择器的对话框——在文档上点选、在对话里出图、弹出 Clip，或并排两个 CLI。',
      'core.officeLabel': '点选 Office 文件',
      'core.officeBody':
        '打开幻灯片、表格或简报。点标题、卡片、单元格——再提问。Agent 写入磁盘上的同一路径。不是 Word 式画布。',
      'core.officeNote': '选区就是提示。文件仍是真相来源。',
      'core.chartsLabel': 'Mermaid + Vega-Lite',
      'core.chartsBody':
        '流程和图表在对话里渲染——Mermaid 画路径，Vega-Lite 画数字。可复制、下载，或打开源文件并排提问。',
      'core.chartsNote': '同一轮：一张流程图，一张柱状图，都是活的。',
      'core.clipLabel': 'App Clip',
      'core.clipBody':
        'Agent 可以在对话里写出一个小互动应用——看板、计算器、教具。用「在窗口中查看」弹出。是真控件，不是截图。',
      'core.clipNote': '对话里的 <code>```app</code>，或从 HTML 弹出的薄窗。',
      'core.swarmLabel': 'Swarm',
      'core.swarmBody':
        '切到 Swarm 表面再拆分窗格。左边 Claude，右边 Codex——各自是真 TUI。⌘D 拆分，方向键切换。',
      'core.swarmNote': '设置 → CLI Agents 里的可选项。不用时保持关闭。',
      'core.hotkeyLabel': '<kbd>⌘⇧↵</kbd> Quick Ask',
      'core.hotkeyBody':
        '在 Mac 任意处按 <kbd>⌘⇧↵</kbd> 打开一列窄窗。问一件事——路径拼接、正则、命名——拿到答案就关。不必拉起整套工作区。',
      'core.hotkeyNote': '为打断而生：短、本地、问完即走。',
      'files.title': '任意文档，独立窗口',
      'files.lead': 'Mermaid 源文件、PDF、幻灯片、表格、Markdown——一边预览，一边 Agent。',
      'files.mmdLabel': 'Mermaid 文件',
      'files.mmdCaption': '把 .mmd 当画布打开，点选节点，问失败分支。',
      'files.pdfLabel': 'PDF',
      'files.pdfCaption': '从简报生成站会摘要，再画一张 Mermaid 跟进图——同一窗口、同一轮。',
      'files.pptxLabel': 'PPTX',
      'files.pptxCaption': '加载幻灯片技能，改标题、收紧要点——每次写入都有工具卡片。',
      'files.csvLabel': 'CSV / TSV',
      'files.csvCaption': '对着表格提问，对话里出 Vega-Lite，再把一页 PDF 报告写到磁盘。',
      'files.xlsxLabel': 'DOCX / XLSX',
      'files.xlsxCaption': '技能驱动的工作簿与简报编辑——加列、刷新，不离开窗口。',
      'files.mdLabel': 'Markdown',
      'files.mdCaption': '读笔记、改安装步骤——每一次 fs_read / fs_write 都留在可核对的记录里。',
      'files.chartsLabel': '对话里的图',
      'files.chartsCaption': 'Mermaid 流程与 Vega-Lite 图表内联渲染——复制、下载、继续推进。',
      'formats.title': '格式说明',
      'formats.lead':
        '每种类型在文档窗口里能做什么——预览、旁边提问、原地编辑，还是先转换。能力以应用为准，不是愿望清单。',
      'formats.cap.preview': '预览',
      'formats.cap.previewHint': '在文件窗口中打开',
      'formats.cap.ask': '提问',
      'formats.cap.askHint': '基于打开文件的对话',
      'formats.cap.edit': '可编辑',
      'formats.cap.editHint': '原地编辑 / Agent 写入同一路径',
      'formats.cap.convert': '可转换',
      'formats.cap.convertHint': '另存为现代格式；原文件不动',
      'formats.cap.readonly': '只读',
      'formats.cap.readonlyHint': '可预览与提问；不能原地写入',
      'formats.cap.skill': '技能',
      'formats.cap.skillHint': 'Agent 加载对应格式技能以创建或编辑',
      'formats.col.format': '格式',
      'formats.col.caps': '能力',
      'formats.col.note': '说明',
      'formats.docx.name': 'Word（OOXML）',
      'formats.docx.note': '默认以只读打开；可切到编辑，或用 docx 技能写入当前路径。',
      'formats.doc.name': 'Word（旧版）',
      'formats.doc.note':
        '预览时转为 DOCX/HTML（macOS）。编辑即「转换 → 另存为 .docx」；原文件保留。',
      'formats.xlsx.name': 'Excel（OOXML）',
      'formats.xlsx.note': '表格预览；Agent 通过 xlsx 技能编辑同一工作簿路径。',
      'formats.xls.name': 'Excel（旧版）',
      'formats.xls.note': '可在表格预览中打开。要编辑需「转换 → 另存为 .xlsx」；原文件不动。',
      'formats.pptx.name': 'PowerPoint（OOXML）',
      'formats.pptx.note': '幻灯片画布；pptx 技能可改标题、要点并写回。',
      'formats.ppt.name': 'PowerPoint（旧版）',
      'formats.ppt.note': '无内置 .ppt 转换。请先导出为 .pptx，或用系统默认应用打开。',
      'formats.pdf.name': 'PDF',
      'formats.pdf.note': '窗口内仅预览与提问。创建、填表或重排版通过 PDF 技能写到新路径。',
      'formats.csv.name': '表格数据',
      'formats.csv.note': '网格预览、对话出图，文本可直接写回表格。',
      'formats.md.name': 'Markdown 与文本',
      'formats.md.note': '完整原地编辑；Agent 对打开文件做 fs_read / fs_write。',
      'formats.diagram.name': '思维导图与流程图',
      'formats.diagram.note': '渲染画布可点选提问；磁盘上仍是可编辑的源文本。',
      'formats.heic.name': 'HEIC 图像',
      'formats.heic.note': '应用内可查看；编辑时转换为 JPEG 另存。原 HEIC 不变。',
      'formats.zip.name': 'ZIP 压缩包',
      'formats.zip.note': '仅结构预览——不是完整解压工具。',
      'download.title': '获取 VAV',
      'download.lead': '最新 GitHub Release 构建。若系统提示无法打开，按安装说明放行即可。',
      'download.mac': 'macOS · Apple 芯片',
      'download.win': 'Windows · x64',
      'download.install': '安装说明',
      'download.version': '最新：{tag}',
      'download.detected': '已匹配你的系统：{os}',
      'download.osMac': 'macOS',
      'download.osWin': 'Windows',
      'download.cli':
        '终端里可用 <code>vav .</code> 打开当前目录会话（设置 → vav 命令）。',
      'footer.note':
        '非商用许可见 <a href="https://github.com/21stware/vav/blob/main/LICENSE">LICENSE</a> · 商用授权 <a href="mailto:licensing@21stware.com">licensing@21stware.com</a>'
    }
  }

  const KEY = 'vav.site.lang'

  function normalizeLang(value) {
    return value === 'en' || value === 'zh' ? value : null
  }

  // ?lang= wins so a link can pin a language; then the saved choice, then the browser.
  function detectLang() {
    const fromUrl = normalizeLang(new URLSearchParams(location.search).get('lang'))
    if (fromUrl) return fromUrl
    try {
      const saved = normalizeLang(localStorage.getItem(KEY))
      if (saved) return saved
    } catch {
      // ignore
    }
    return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }

  function syncLangUrl(lang) {
    const url = new URL(location.href)
    if (lang === 'zh') url.searchParams.set('lang', 'zh')
    else url.searchParams.delete('lang')
    if (url.href !== location.href) history.replaceState(null, '', url)
  }

  function applyLang(lang) {
    const catalog = catalogs[lang] || catalogs.en
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n')
      const value = catalog[key]
      if (value != null) el.textContent = value
    })

    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html')
      const value = catalog[key]
      if (value != null) el.innerHTML = value
    })

    document.querySelectorAll('[data-i18n-href-en]').forEach((el) => {
      const href = el.getAttribute(lang === 'zh' ? 'data-i18n-href-zh' : 'data-i18n-href-en')
      if (href) el.setAttribute('href', href)
    })

    const title = catalog['meta.title']
    if (title) {
      document.title = title
      document
        .querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]')
        .forEach((el) => el.setAttribute('content', title))
    }
    const description = catalog['meta.description']
    if (description) {
      document
        .querySelectorAll(
          'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]'
        )
        .forEach((el) => el.setAttribute('content', description))
    }

    // hreflang alternates only count when each variant canonicalises to itself.
    const canonical = lang === 'zh' ? 'https://vavapp.com/?lang=zh' : 'https://vavapp.com/'
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical)
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical)
    document
      .querySelector('meta[property="og:locale"]')
      ?.setAttribute('content', lang === 'zh' ? 'zh_CN' : 'en_US')
    document
      .querySelector('meta[property="og:locale:alternate"]')
      ?.setAttribute('content', lang === 'zh' ? 'en_US' : 'zh_CN')

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      const active = btn.getAttribute('data-lang') === lang
      btn.setAttribute('aria-pressed', active ? 'true' : 'false')
      btn.classList.toggle('is-active', active)
    })

    const themeGroup = document.querySelector('.theme')
    if (themeGroup) themeGroup.setAttribute('aria-label', catalog['theme.group'] || 'Appearance')
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      const key = btn.getAttribute('data-theme-set') === 'dark' ? 'theme.dark' : 'theme.light'
      if (catalog[key]) btn.textContent = catalog[key]
    })

    syncLangUrl(lang)

    try {
      localStorage.setItem(KEY, lang)
    } catch {
      // ignore
    }
  }

  /* —— Downloads: platform match, asset size, latest tag —— */

  const RELEASE_KEY = 'vav.site.release'
  const RELEASE_TTL = 6 * 60 * 60 * 1000
  const PLATFORMS = {
    mac: { id: 'download-mac', match: /macos-arm64\.dmg$/i, os: 'download.osMac' },
    win: { id: 'download-win', match: /windows-x64-setup\.exe$/i, os: 'download.osWin' }
  }

  let latestTag = 'latest'
  const assetSizes = {}

  function detectPlatform() {
    const hint = navigator.userAgentData?.platform || navigator.platform || ''
    const ua = navigator.userAgent || ''
    if (/android|iphone|ipod/i.test(ua)) return null
    if (/win/i.test(hint) || /Windows/i.test(ua)) return 'win'
    if (/mac/i.test(hint) || /Mac OS X/i.test(ua)) return 'mac'
    return null
  }

  function formatSize(bytes) {
    return `${Math.round(bytes / 1024 / 1024)} MB`
  }

  function renderDownloads(lang) {
    const catalog = catalogs[lang] || catalogs.en

    const version = document.getElementById('download-version')
    if (version) {
      version.hidden = false
      version.textContent = (catalog['download.version'] || 'Latest: {tag}').replace(
        '{tag}',
        latestTag
      )
    }

    for (const key of Object.keys(PLATFORMS)) {
      const size = document.querySelector(`[data-size-for="${key}"]`)
      if (size) size.textContent = assetSizes[key] ? formatSize(assetSizes[key]) : ''
    }

    const platform = detectPlatform()
    const detected = document.getElementById('download-detected')
    for (const [key, spec] of Object.entries(PLATFORMS)) {
      const btn = document.getElementById(spec.id)
      if (!btn) continue
      const isMatch = platform === key
      btn.classList.toggle('is-detected', isMatch)
      // Only the visitor's own platform gets the filled treatment.
      btn.classList.toggle('primary', !platform || isMatch)
      btn.classList.toggle('ghost', Boolean(platform) && !isMatch)
    }
    if (detected && platform) {
      detected.hidden = false
      detected.textContent = (catalog['download.detected'] || '').replace(
        '{os}',
        catalog[PLATFORMS[platform].os] || ''
      )
    }
  }

  function applyRelease(data) {
    if (data.tag_name) latestTag = data.tag_name
    if (!Array.isArray(data.assets)) return
    for (const [key, spec] of Object.entries(PLATFORMS)) {
      const asset = data.assets.find((a) => spec.match.test(a.name))
      const btn = document.getElementById(spec.id)
      if (!asset) continue
      // Buttons stay on /releases/latest — never a pinned tag URL.
      if (btn) btn.href = 'https://github.com/21stware/vav/releases/latest'
      if (asset.size) assetSizes[key] = asset.size
    }
  }

  function currentLang() {
    return document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'
  }

  function readCachedRelease() {
    try {
      const raw = localStorage.getItem(RELEASE_KEY)
      if (!raw) return null
      const { at, data } = JSON.parse(raw)
      if (!at || Date.now() - at > RELEASE_TTL) return null
      return data
    } catch {
      return null
    }
  }

  // Cached for six hours: the GitHub API is rate-limited per IP, and the
  // hard-coded hrefs in the HTML remain a working fallback either way.
  async function loadLatestDownloads() {
    const cached = readCachedRelease()
    if (cached) {
      applyRelease(cached)
      renderDownloads(currentLang())
      return
    }
    try {
      const res = await fetch('https://api.github.com/repos/21stware/vav/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return
      const data = await res.json()
      applyRelease(data)
      renderDownloads(currentLang())
      try {
        const { tag_name, assets } = data
        localStorage.setItem(
          RELEASE_KEY,
          JSON.stringify({
            at: Date.now(),
            data: {
              tag_name,
              assets: (assets || []).map(({ name, size, browser_download_url }) => ({
                name,
                size,
                browser_download_url
              }))
            }
          })
        )
      } catch {
        // ignore
      }
    } catch {
      // keep HTML fallbacks
    }
  }

  const THEME_KEY = 'vav.site.theme'

  function darkAsset(path) {
    return path.replace(
      /\/(screenshot(?:-[a-z]+)*)(-\d+w)?(\.(?:png|avif|webp))$/i,
      '/$1-dark$2$3'
    )
  }

  function applyThemeShots(theme) {
    document.querySelectorAll('picture[data-shot]').forEach((pic) => {
      pic.querySelectorAll('source').forEach((source) => {
        const original = source.getAttribute('data-srcset-light') || source.getAttribute('srcset') || ''
        if (!source.getAttribute('data-srcset-light')) source.setAttribute('data-srcset-light', original)
        source.setAttribute(
          'srcset',
          theme === 'dark'
            ? original.replace(
                /\/(screenshot(?:-[a-z]+)*)(-\d+w)?(\.(?:png|avif|webp))/gi,
                '/$1-dark$2$3'
              )
            : original
        )
      })
      const img = pic.querySelector('img')
      if (!img) return
      const original = img.getAttribute('data-src-light') || img.getAttribute('src') || ''
      if (!img.getAttribute('data-src-light')) img.setAttribute('data-src-light', original)
      img.setAttribute('src', theme === 'dark' ? darkAsset(original) : original)
    })
  }

  function resolvedTheme() {
    const fromUrl = new URLSearchParams(location.search).get('theme')
    if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl
    const stored = document.documentElement.dataset.theme
    if (stored === 'dark' || stored === 'light') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function applyTheme(theme, persist) {
    const next = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    document.documentElement.style.colorScheme = next
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', next === 'dark' ? '#121213' : '#ececee')
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      const active = btn.getAttribute('data-theme-set') === next
      btn.setAttribute('aria-pressed', active ? 'true' : 'false')
      btn.classList.toggle('is-active', active)
    })
    applyThemeShots(next)
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        // ignore
      }
    }
  }

  const lang = detectLang()
  applyLang(lang)
  applyTheme(resolvedTheme(), false)
  renderDownloads(lang)
  void loadLatestDownloads()

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = normalizeLang(btn.getAttribute('data-lang'))
      if (next) {
        applyLang(next)
        renderDownloads(next)
      }
    })
  })

  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.getAttribute('data-theme-set'), true)
    })
  })

  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', (event) => {
      try {
        if (localStorage.getItem(THEME_KEY)) return
      } catch {
        // fall through
      }
      applyTheme(event.matches ? 'dark' : 'light')
    })
  } catch {
    // ignore
  }

  /* —— Header frosts once the hero lock-up is behind it —— */

  const header = document.querySelector('.top')
  if (header) {
    let ticking = false
    const sync = () => {
      header.classList.toggle('is-stuck', window.scrollY > 32)
      ticking = false
    }
    sync()
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(sync)
      },
      { passive: true }
    )
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const nodes = document.querySelectorAll('.reveal')
  if (reduce || !('IntersectionObserver' in window)) {
    nodes.forEach((el) => el.classList.add('is-in'))
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    )
    nodes.forEach((el) => io.observe(el))
  }
})()
