/**
 * Smoke test for local web_search / web_fetch services.
 * Run: npx tsx scripts/smoke-web-tools.ts
 */
import { assertPublicHttpUrl, SsrfError } from '../src/main/web/ssrf'
import { WebFetchService } from '../src/main/web/WebFetchService'
import { WebSearchService } from '../src/main/web/WebSearchService'

async function expectFail(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    console.error('FAIL expected block:', label)
    process.exitCode = 1
  } catch (e) {
    if (e instanceof SsrfError) {
      console.log('OK ssrf:', label, '→', e.message.slice(0, 100))
    } else {
      console.error('FAIL wrong error', label, e)
      process.exitCode = 1
    }
  }
}

async function main(): Promise<void> {
  await expectFail('localhost', () => assertPublicHttpUrl('http://localhost/secret'))
  await expectFail('127.0.0.1', () => assertPublicHttpUrl('http://127.0.0.1/'))
  await expectFail('10.x', () => assertPublicHttpUrl('http://10.0.0.1/'))
  await expectFail('file', () => assertPublicHttpUrl('file:///etc/passwd'))
  await expectFail('port 22', () => assertPublicHttpUrl('https://example.com:22/'))

  const ok = await assertPublicHttpUrl('https://example.com/path')
  console.log('OK public:', ok.href)

  const fetchSvc = new WebFetchService()
  const blocked = await fetchSvc.fetch({ url: 'http://127.0.0.1:9/', timeoutMs: 5000 })
  if (blocked.ok) {
    console.error('FAIL fetch should block loopback')
    process.exitCode = 1
  } else {
    console.log('OK fetch ssrf:', blocked.error?.slice(0, 100))
  }

  const page = await fetchSvc.fetch({
    url: 'https://example.com/',
    maxChars: 4000,
    timeoutMs: 20_000
  })
  if (!page.ok) {
    console.error('FAIL fetch example.com', page.error)
    process.exitCode = 1
  } else {
    console.log(
      'OK fetch status',
      page.status,
      'chars',
      page.chars,
      'title',
      page.title,
      'extracted',
      page.extracted
    )
    console.log('body head:', (page.body || '').slice(0, 180).replace(/\n/g, ' '))
  }

  // MDN page — better Readability exercise than example.com
  const mdn = await fetchSvc.fetch({
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    maxChars: 6000,
    timeoutMs: 25_000
  })
  if (!mdn.ok) {
    console.warn('WARN mdn fetch:', mdn.error)
  } else {
    console.log(
      'OK mdn chars',
      mdn.chars,
      'title',
      mdn.title,
      'has fetch?',
      (mdn.body || '').toLowerCase().includes('fetch')
    )
  }

  const search = new WebSearchService()
  const results = await search.search({
    query: 'Electron net module documentation',
    numResults: 5,
    timeoutMs: 25_000
  })
  console.log(
    'search ok=',
    results.ok,
    'via=',
    results.via,
    'hits=',
    results.hits.length,
    'err=',
    results.error,
    'warn=',
    results.warnings
  )
  if (results.hits[0]) {
    console.log('first:', results.hits[0].title, '→', results.hits[0].url)
  }
  if (!results.ok || results.hits.length === 0) {
    console.warn('WARN search returned no hits — DDG may be rate-limited or blocked here')
  }

  // Public sample PDF (W3C)
  const pdf = await fetchSvc.fetch({
    url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    maxChars: 4000,
    timeoutMs: 25_000
  })
  if (!pdf.ok) {
    console.warn('WARN pdf fetch:', pdf.error)
  } else {
    console.log(
      'OK pdf extracted=',
      pdf.extracted,
      'chars=',
      pdf.chars,
      'head=',
      (pdf.body || '').slice(0, 120).replace(/\n/g, ' ')
    )
  }

  console.log('done exit', process.exitCode ?? 0)
}

void main()
