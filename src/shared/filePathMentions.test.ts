import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findFilePathMentions,
  looksLikeFilePath,
  trimPathCandidate
} from './filePathMentions.ts'

function pathsIn(text: string): string[] {
  return findFilePathMentions(text).map((m) => m.path)
}

describe('looksLikeFilePath', () => {
  it('accepts real absolute / home / relative paths', () => {
    assert.equal(looksLikeFilePath('/Users/oboo/repo/vav/src/main/index.ts'), true)
    assert.equal(looksLikeFilePath('/tmp/out.log'), true)
    assert.equal(looksLikeFilePath('~/Documents/note.md'), true)
    assert.equal(looksLikeFilePath('./src/foo.ts'), true)
    assert.equal(looksLikeFilePath('../pkg/bar.tsx'), true)
    assert.equal(looksLikeFilePath('src/lib/filePathLinks.ts'), true)
    assert.equal(looksLikeFilePath('C:\\Users\\oboo\\app\\main.ts'), true)
  })

  it('rejects bare filenames, packages, URLs, and host-shaped paths', () => {
    assert.equal(looksLikeFilePath('package.json'), false)
    assert.equal(looksLikeFilePath('vega-lite-spec-v5.json'), false)
    assert.equal(looksLikeFilePath('@scope/pkg'), false)
    assert.equal(looksLikeFilePath('https://example.com/a.ts'), false)
    assert.equal(looksLikeFilePath('//cdn.example.com/app.js'), false)
    assert.equal(looksLikeFilePath('example.io/docs/readme.md'), false)
    assert.equal(looksLikeFilePath('mailto:hi@example.com'), false)
  })

  it('rejects IPA / slash-wrapped phonetic tokens', () => {
    assert.equal(looksLikeFilePath('/pæl/'), false)
    assert.equal(looksLikeFilePath('/pɔːl/'), false)
    assert.equal(looksLikeFilePath('/ˈhɛloʊ/'), false)
    assert.equal(looksLikeFilePath('/pæl'), false)
  })

  it('rejects lone non-ASCII absolute segments (CJK particles)', () => {
    assert.equal(looksLikeFilePath('/还原面板'), false)
    assert.equal(looksLikeFilePath('/朋友/'), false)
  })

  it('rejects strings that still contain CJK punctuation', () => {
    assert.equal(looksLikeFilePath('/pæl/，意思'), false)
    assert.equal(looksLikeFilePath('/pɔːl/）发音'), false)
  })
})

describe('trimPathCandidate', () => {
  it('strips trailing sentence punctuation', () => {
    assert.equal(trimPathCandidate('./src/foo.ts.'), './src/foo.ts')
    assert.equal(trimPathCandidate('/tmp/out.log，'), '/tmp/out.log')
    assert.equal(trimPathCandidate('~/a.md）'), '~/a.md')
    assert.equal(trimPathCandidate('src/a.ts"'), 'src/a.ts')
  })
})

describe('findFilePathMentions — regression corpus', () => {
  it('does not link IPA phonetics inside Chinese prose (pal / Paul)', () => {
    const text =
      '对，就是 **pal**，三个字母：**P-A-L**。\n\n' +
      '发音 /pæl/，意思"哥们、朋友、兄弟"，和 "buddy"、"dude"、"mate" 一个路子的口语词。\n\n' +
      '顺带一提，它跟人名 **Paul**（P-A-U-L，四个字母，/pɔːl/）发音很像，所以容易听混。' +
      '但你要找的那个"哥们"就是 **pal** ✅'
    assert.deepEqual(pathsIn(text), [])
  })

  it('does not treat CJK slash compounds as absolute paths', () => {
    assert.deepEqual(pathsIn('点击最大化/还原面板即可'), [])
    assert.deepEqual(pathsIn('支持 打开/关闭 切换'), [])
  })

  it('does not link bare JSON / schema ids that previously false-positived', () => {
    assert.deepEqual(pathsIn('See vega-lite-spec-v5.json for the schema.'), [])
    assert.deepEqual(pathsIn('Install @scope/pkg and retry.'), [])
    assert.deepEqual(pathsIn('The file is package.json in the root.'), [])
  })

  it('does not treat https hosts as Unix paths', () => {
    assert.deepEqual(pathsIn('Open https://example.com/docs/readme.md please'), [])
    assert.deepEqual(pathsIn('CDN //cdn.example.com/app.js'), [])
    assert.deepEqual(pathsIn('See example.io/docs/readme.md'), [])
  })

  it('still finds real paths next to Chinese punctuation', () => {
    assert.deepEqual(pathsIn('请打开 /Users/oboo/repo/vav/src/main/index.ts。'), [
      '/Users/oboo/repo/vav/src/main/index.ts'
    ])
    assert.deepEqual(pathsIn('修改 ./src/foo.ts，然后重跑。'), ['./src/foo.ts'])
    // Spaces end a mention (PATH_END includes whitespace); prefer contiguous paths.
    assert.deepEqual(pathsIn('配置在 ~/.config/vav/settings.json。'), [
      '~/.config/vav/settings.json'
    ])
  })

  it('finds workspace-relative paths with extensions', () => {
    assert.deepEqual(pathsIn('Touch src/shared/filePathMentions.ts next.'), [
      'src/shared/filePathMentions.ts'
    ])
    assert.deepEqual(pathsIn('Both a/b.ts and c/d/e.tsx changed.'), ['a/b.ts', 'c/d/e.tsx'])
  })

  it('reports index/raw for a single mention without swallowing neighbors', () => {
    const text = '发音 /pæl/，然后看 ./src/app.ts 即可'
    const mentions = findFilePathMentions(text)
    assert.equal(mentions.length, 1)
    assert.equal(mentions[0]?.path, './src/app.ts')
    assert.equal(text.slice(mentions[0]!.index, mentions[0]!.index + mentions[0]!.raw.length), './src/app.ts')
  })
})
