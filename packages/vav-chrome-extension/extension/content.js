;(() => {
  if (window.__vavContentReady) return
  window.__vavContentReady = true

  const CHIP_ID = 'vav-ask-chip'

  function meta(name) {
    return (
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
      document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
      ''
    )
  }

  function extract() {
    const selection = window.getSelection()?.toString() || ''
    const headings = [...document.querySelectorAll('h1, h2')]
      .map((el) => (el.innerText || '').trim())
      .filter(Boolean)
      .slice(0, 12)
    const root = document.querySelector('article, main, [role="main"]') || document.body
    const excerpt = (root?.innerText || '').trim().slice(0, 12_000)
    return {
      url: location.href,
      title: document.title || '',
      selection,
      description: meta('description') || meta('og:description'),
      siteName: meta('og:site_name'),
      headings,
      excerpt
    }
  }

  function firstTextNode(query) {
    const needle = query.trim()
    if (!needle) return null
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const idx = node.nodeValue.indexOf(needle.slice(0, Math.min(80, needle.length)))
      if (idx >= 0) return { node, idx, len: Math.min(needle.length, node.nodeValue.length - idx) }
    }
    return null
  }

  function highlight(text) {
    clearHighlight()
    const hit = firstTextNode(text)
    if (!hit) return false
    const range = document.createRange()
    range.setStart(hit.node, hit.idx)
    range.setEnd(hit.node, hit.idx + hit.len)
    const mark = document.createElement('mark')
    mark.className = 'vav-hl'
    try {
      range.surroundContents(mark)
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return true
    } catch {
      hit.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return false
    }
  }

  function clearHighlight() {
    for (const mark of [...document.querySelectorAll('mark.vav-hl')]) {
      const parent = mark.parentNode
      if (!parent) continue
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
      parent.normalize()
    }
  }

  function scrollToText(text) {
    const hit = firstTextNode(text)
    if (!hit) return false
    hit.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return true
  }

  function fillField(selector, value) {
    const el = document.querySelector(selector)
    if (!el) return false
    if ('value' in el) {
      el.focus()
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    if (el.isContentEditable) {
      el.focus()
      el.textContent = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    return false
  }

  function clickSelector(selector) {
    const el = document.querySelector(selector)
    if (!el) return false
    el.click()
    return true
  }

  function chip() {
    let el = document.getElementById(CHIP_ID)
    if (el) return el
    el = document.createElement('button')
    el.id = CHIP_ID
    el.type = 'button'
    el.innerHTML = '<span class="vav-ask-mark">V</span> Ask VAV'
    el.addEventListener('mousedown', (event) => event.preventDefault())
    el.addEventListener('click', () => {
      const page = extract()
      hideChip()
      void chrome.runtime.sendMessage({ type: 'ask-selection', page })
    })
    document.documentElement.appendChild(el)
    return el
  }

  function hideChip() {
    const el = document.getElementById(CHIP_ID)
    if (el) el.style.display = 'none'
  }

  function placeChip() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !String(sel).trim()) {
      hideChip()
      return
    }
    if (sel.anchorNode && chip().contains(sel.anchorNode)) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      hideChip()
      return
    }
    const el = chip()
    el.style.display = 'inline-flex'
    el.style.top = `${window.scrollY + rect.top - 36}px`
    el.style.left = `${window.scrollX + rect.left + rect.width / 2 - 44}px`
  }

  document.addEventListener('selectionchange', () => {
    window.clearTimeout(placeChip.t)
    placeChip.t = window.setTimeout(placeChip, 120)
  })
  document.addEventListener('scroll', hideChip, true)

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') {
      sendResponse({ ok: true })
      return
    }
    if (msg?.type === 'extract') {
      sendResponse(extract())
      return
    }
    if (msg?.type === 'highlight') {
      sendResponse({ ok: highlight(String(msg.text || '')) })
      return
    }
    if (msg?.type === 'clear-highlight') {
      clearHighlight()
      sendResponse({ ok: true })
      return
    }
    if (msg?.type === 'scroll-to-text') {
      sendResponse({ ok: scrollToText(String(msg.text || '')) })
      return
    }
    if (msg?.type === 'fill') {
      sendResponse({ ok: fillField(String(msg.selector || ''), String(msg.value || '')) })
      return
    }
    if (msg?.type === 'click') {
      sendResponse({ ok: clickSelector(String(msg.selector || '')) })
      return
    }
  })
})()
