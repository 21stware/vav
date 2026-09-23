import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countWritingUnits, joinListFacts } from './writingStats.ts'

describe('countWritingUnits', () => {
  it('counts nothing in empty or marker-only text', () => {
    assert.equal(countWritingUnits(''), 0)
    assert.equal(countWritingUnits(' \n\t'), 0)
    assert.equal(countWritingUnits('# \n---'), 0)
  })

  it('counts Latin words and keeps contractions together', () => {
    assert.equal(countWritingUnits('hello world'), 2)
    assert.equal(countWritingUnits("don't stop"), 2)
    assert.equal(countWritingUnits('v2 release'), 2)
  })

  it('counts each CJK character and mixes with Latin words', () => {
    assert.equal(countWritingUnits('你好'), 2)
    assert.equal(countWritingUnits('你好 world'), 3)
    assert.equal(countWritingUnits('# 标题\n\nHello, world!'), 4)
  })
})

describe('joinListFacts', () => {
  it('joins present facts and keeps a zero count', () => {
    assert.equal(
      joinListFacts([
        { label: '创建', value: '刚刚' },
        { label: '更新', value: null },
        { label: '字数', value: 0 }
      ]),
      '创建 刚刚 · 字数 0'
    )
    assert.equal(joinListFacts([{ label: '创建', value: '' }]), '')
  })
})
