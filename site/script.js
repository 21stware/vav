;(() => {
  const catalogs = {
    en: {
      'meta.title': 'vav — local AI coding agent workstation',
      'meta.description':
        'Local AI coding agent workstation: chat, file tree, and a real terminal in one window. Watch the agent work in your project — data stays on your machine.',
      'nav.download': 'Download',
      'hero.title': 'Watch the agent work in your project',
      'hero.lead':
        'Chat, file tree, and a real terminal — one window. Data stays on your machine, except calls to the model endpoint you configure.',
      'hero.ctaDownload': 'Download',
      'hero.ctaSource': 'Source',
      'product.title': 'One window, three surfaces',
      'product.lead':
        'The agent isn’t narrating what it did — you watch it <code>cd</code>, run tests, and write files on the right.',
      'product.chatLabel': 'Chat',
      'product.chatBody': 'Streaming turns, tool cards, branch retries, and clear context usage.',
      'product.filesLabel': 'Files',
      'product.filesBody': 'On-demand workspace tree, agent edits highlighted, spacebar Quick Look.',
      'product.termLabel': 'Terminal',
      'product.termBody':
        'Real PTY. In the sticky shell, <code>cd</code> and env vars stick around.',
      'gallery.title': 'Inside the window',
      'gallery.lead': 'Same English demo session — chat, files, terminal, and context usage.',
      'gallery.chatLabel': 'Chat',
      'gallery.chatCaption': 'Tool cards, a concrete fix, and the file tree still in view.',
      'gallery.filesLabel': 'Files',
      'gallery.filesCaption': 'Expand the workspace tree while the agent turn stays on the left.',
      'gallery.termLabel': 'Terminal',
      'gallery.termCaption': 'A real PTY tab — status, listing, and search in the same shell.',
      'gallery.contextLabel': 'Context',
      'gallery.contextCaption':
        'Token history for the session — how much cache vs new input you used.',
      'download.title': 'Download',
      'download.lead':
        'Direct downloads from the latest GitHub Release. Unsigned — follow the first-run notes to open them.',
      'download.mac': 'macOS · Apple Silicon',
      'download.win': 'Windows · x64',
      'download.install': 'Install notes',
      'download.version': 'Latest: {tag}',
      'download.cli':
        'From a terminal, <code>vav .</code> opens a new session in the current directory (Settings → vav command).',
      'footer.note':
        'Noncommercial license: <a href="https://github.com/21stware/vav/blob/main/LICENSE">LICENSE</a> · Commercial licensing <a href="mailto:licensing@21stware.com">licensing@21stware.com</a>'
    },
    zh: {
      'meta.title': 'vav — 本机 AI 编程代理工作台',
      'meta.description':
        '对话、文件树、真实终端，一个窗口。看着 Agent 在你的项目里动手——数据留在本机。',
      'nav.download': '下载',
      'hero.title': '看着 Agent 在你的项目里动手',
      'hero.lead':
        '对话、文件树、真实终端，一个窗口。数据留在本机——除了发往你自己配置的模型接口。',
      'hero.ctaDownload': '下载',
      'hero.ctaSource': '源码',
      'product.title': '一个窗口，三件事',
      'product.lead':
        'Agent 不是在描述它做了什么——你在右边直接看着它 <code>cd</code>、跑测试、写文件。',
      'product.chatLabel': '对话',
      'product.chatBody': '流式回合、工具卡片、分支重试，上下文用量一目了然。',
      'product.filesLabel': '文件',
      'product.filesBody': '按需展开的工作区树，agent 改动高亮，空格 Quick Look。',
      'product.termLabel': '终端',
      'product.termBody': '真实 PTY。粘性 shell 里，<code>cd</code> 与环境变量会留下来。',
      'gallery.title': '窗口里有什么',
      'gallery.lead': '同一套英文演示会话：对话、文件树、终端、上下文用量。',
      'gallery.chatLabel': '对话',
      'gallery.chatCaption': '工具卡片、具体修复，右侧文件树仍在视野里。',
      'gallery.filesLabel': '文件',
      'gallery.filesCaption': '展开工作区树，左侧仍是同一轮 Agent 对话。',
      'gallery.termLabel': '终端',
      'gallery.termCaption': '真实 PTY 标签页——状态、目录、搜索都在同一个 shell。',
      'gallery.contextLabel': '上下文',
      'gallery.contextCaption': '会话的 token 历史：缓存命中与新输入各占多少。',
      'download.title': '下载',
      'download.lead': '直接下载最新 GitHub Release 构建。未代码签名，首次打开需按说明放行。',
      'download.mac': 'macOS · Apple 芯片',
      'download.win': 'Windows · x64',
      'download.install': '安装说明',
      'download.version': '最新：{tag}',
      'download.cli':
        '终端里可用 <code>vav .</code> 打开当前目录会话（设置 → vav 命令）。',
      'footer.note':
        '非商用许可见 <a href="https://github.com/21stware/vav/blob/main/LICENSE">LICENSE</a> · 商用授权 <a href="mailto:licensing@21stware.com">licensing@21stware.com</a>'
    }
  }

  const KEY = 'vav.site.lang'

  function detectLang() {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved === 'en' || saved === 'zh') return saved
    } catch {
      // ignore
    }
    const nav = (navigator.language || 'en').toLowerCase()
    return nav.startsWith('zh') ? 'zh' : 'en'
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
    const ogLocale = document.querySelector('meta[property="og:locale"]')
    if (ogLocale) ogLocale.setAttribute('content', lang === 'zh' ? 'zh_CN' : 'en_US')

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      const active = btn.getAttribute('data-lang') === lang
      btn.setAttribute('aria-pressed', active ? 'true' : 'false')
      btn.classList.toggle('is-active', active)
    })

    try {
      localStorage.setItem(KEY, lang)
    } catch {
      // ignore
    }
  }

  let latestTag = 'v1.2.1'

  function renderDownloadVersion(lang) {
    const el = document.getElementById('download-version')
    if (!el) return
    const catalog = catalogs[lang] || catalogs.en
    const template = catalog['download.version'] || 'Latest: {tag}'
    el.hidden = false
    el.textContent = ` · ${template.replace('{tag}', latestTag)}`
  }

  function applyDownloadLinks(assets) {
    const mac = assets.find((a) => /macos-arm64\.dmg$/i.test(a.name))
    const win = assets.find((a) => /windows-x64-setup\.exe$/i.test(a.name))
    const macBtn = document.getElementById('download-mac')
    const winBtn = document.getElementById('download-win')
    if (mac && macBtn) macBtn.href = mac.browser_download_url
    if (win && winBtn) winBtn.href = win.browser_download_url
  }

  async function loadLatestDownloads() {
    try {
      const res = await fetch('https://api.github.com/repos/21stware/vav/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.tag_name) latestTag = data.tag_name
      if (Array.isArray(data.assets)) applyDownloadLinks(data.assets)
      renderDownloadVersion(document.documentElement.lang.startsWith('zh') ? 'zh' : 'en')
    } catch {
      // Keep the hardcoded release hrefs in the HTML.
    }
  }

  const lang = detectLang()
  applyLang(lang)
  renderDownloadVersion(lang)
  void loadLatestDownloads()

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-lang')
      if (next === 'en' || next === 'zh') {
        applyLang(next)
        renderDownloadVersion(next)
      }
    })
  })

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
