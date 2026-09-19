import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFaaaaastSystemPrompt,
  extractFaaaaastStreamText,
  faaaaastLiveSearchQuery,
  faaaaastLooksLikeEnglish,
  faaaaastNeedsLiveSearch,
  faaaaastShouldSearch,
  parseFaaaaastModelText,
  resolveCurrencyCode,
  solveFaaaaastLocal
} from './faaaaast.ts'

describe('solveFaaaaastLocal', () => {
  it('does not invent a currency quote', () => {
    assert.equal(solveFaaaaastLocal('100 USD to CNY'), null)
    assert.equal(solveFaaaaastLocal('100美元'), null)
    assert.equal(solveFaaaaastLocal('$20'), null)
    assert.equal(solveFaaaaastLocal('1万人民币 to usd'), null)
    assert.equal(solveFaaaaastLocal('10000美元现在RMB'), null)
  })

  it('converts units and temperatures', () => {
    const km = solveFaaaaastLocal('100 km to miles')
    assert.equal(km?.kind, 'unit')
    assert.match(km?.answer ?? '', /62\./)

    const temp = solveFaaaaastLocal('32C to F')
    assert.equal(temp?.kind, 'unit')
    assert.match(temp?.answer ?? '', /32/)
    assert.match(temp?.answer ?? '', /89\.6|90/)

    const implicit = solveFaaaaastLocal('10kg')
    assert.equal(implicit?.kind, 'unit')
    assert.match(implicit?.answer ?? '', /lb/)
  })

  it('evaluates arithmetic', () => {
    const sum = solveFaaaaastLocal('2+2*3')
    assert.equal(sum?.kind, 'math')
    assert.equal(sum?.answer, '8')

    const pow = solveFaaaaastLocal('2^10')
    assert.equal(pow?.kind, 'math')
    assert.equal(pow?.answer, '1,024')

    assert.equal(solveFaaaaastLocal('100'), null)
    assert.equal(solveFaaaaastLocal('hello'), null)
  })

  it('encodes and decodes base64 / URLs', () => {
    const encoded = solveFaaaaastLocal('base64 hello')
    assert.equal(encoded?.kind, 'encode')
    assert.equal(encoded?.answer, 'aGVsbG8=')

    const decoded = solveFaaaaastLocal('aGVsbG8=')
    assert.equal(decoded?.kind, 'encode')
    assert.equal(decoded?.answer, 'hello')

    const url = solveFaaaaastLocal('urlencode a b')
    assert.equal(url?.kind, 'encode')
    assert.equal(url?.answer, 'a%20b')
  })
})

describe('faaaaastNeedsLiveSearch', () => {
  it('flags weather, rail, flights, and FX', () => {
    assert.equal(faaaaastNeedsLiveSearch('天气'), true)
    assert.equal(faaaaastShouldSearch('天气'), true)
    assert.equal(faaaaastNeedsLiveSearch('上海天气'), true)
    assert.equal(faaaaastNeedsLiveSearch('今天的高铁'), true)
    assert.equal(faaaaastNeedsLiveSearch('明天北京到上海的机票'), true)
    assert.equal(faaaaastNeedsLiveSearch('10000美元现在RMB'), true)
    assert.equal(faaaaastNeedsLiveSearch('100 USD to CNY'), true)
    assert.equal(faaaaastNeedsLiveSearch('$20'), true)
    assert.equal(faaaaastNeedsLiveSearch('特斯拉股价'), true)
  })

  it('leaves closed-world lines alone', () => {
    assert.equal(faaaaastNeedsLiveSearch('hello'), false)
    assert.equal(faaaaastNeedsLiveSearch('翻译 hello'), false)
    assert.equal(faaaaastNeedsLiveSearch('2+2*3'), false)
    assert.equal(faaaaastNeedsLiveSearch('100 km to miles'), false)
    assert.equal(faaaaastNeedsLiveSearch('单元测试'), false)
    assert.equal(faaaaastNeedsLiveSearch("I'll do it today"), false)
    assert.equal(faaaaastNeedsLiveSearch('today NYC to SFO'), true)
  })
})

describe('currency helpers', () => {
  it('resolves aliases', () => {
    assert.equal(resolveCurrencyCode('美元'), 'USD')
    assert.equal(resolveCurrencyCode('€'), 'EUR')
    assert.equal(resolveCurrencyCode('RMB'), 'CNY')
  })

  it('builds a dated FX search query', () => {
    const q = faaaaastLiveSearchQuery('10000美元现在RMB', {
      now: new Date('2026-09-15T12:00:00')
    })
    assert.match(q, /USD/)
    assert.match(q, /CNY/)
    assert.match(q, /2026-09-15/)
    assert.match(q, /10000美元现在RMB/)
    assert.match(
      faaaaastLiveSearchQuery('青岛明日天气', { now: new Date('2026-09-15T12:00:00') }),
      /天气预报/
    )
  })
})

describe('parseFaaaaastModelText', () => {
  it('reads JSON and falls back to raw text', () => {
    const parsed = parseFaaaaastModelText(
      '```json\n{"kind":"translate","title":"翻译","answer":"hello","note":"en"}\n```'
    )
    assert.deepEqual(parsed, {
      kind: 'translate',
      title: '翻译',
      answer: 'hello',
      note: 'en',
      ipa: undefined,
      local: false
    })
    assert.equal(parseFaaaaastModelText('just text').answer, 'just text')
    assert.equal(parseFaaaaastModelText('just text').kind, 'other')
    assert.equal(
      parseFaaaaastModelText('{"kind":"translate","answer":"hello","ipa":"/həˈloʊ/"}').ipa,
      '/həˈloʊ/'
    )
  })
})

describe('extractFaaaaastStreamText', () => {
  it('surfaces the answer while JSON is still open', () => {
    assert.equal(extractFaaaaastStreamText('{"kind":"translate","answer":"hel'), 'hel')
    assert.equal(extractFaaaaastStreamText('{"kind":"other"'), '')
    assert.equal(extractFaaaaastStreamText('hello world'), 'hello world')
    assert.equal(
      extractFaaaaastStreamText('{"kind":"translate","title":"t","answer":"hi"}'),
      'hi'
    )
  })
})

describe('faaaaastLooksLikeEnglish', () => {
  it('detects English answers and ignores CJK-heavy lines', () => {
    assert.equal(faaaaastLooksLikeEnglish('Hello, how are you?'), true)
    assert.equal(faaaaastLooksLikeEnglish('你好'), false)
    assert.equal(faaaaastLooksLikeEnglish('上海 18°C 晴'), false)
  })
})

describe('faaaaast prompt', () => {
  it('builds a glance-mode agent prompt', () => {
    const prompt = buildFaaaaastSystemPrompt({ locale: 'zh-CN', displayCurrency: 'CNY' })
    assert.match(prompt, /web_search/)
    assert.match(prompt, /web_fetch/)
    assert.match(prompt, /上海呢/)
    assert.match(prompt, /Never invent/)
    assert.match(prompt, /CNY/)
    assert.match(prompt, /ipa/)
  })
})
