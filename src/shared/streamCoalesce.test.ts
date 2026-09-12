import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coalesceStreamChunk, foldSnapshotText, streamTextCovers } from './streamCoalesce.ts'

describe('coalesceStreamChunk', () => {
  it('appends a true token delta', () => {
    assert.equal(coalesceStreamChunk('用户要求', '操作日历'), '用户要求操作日历')
  })

  it('replaces a growing snapshot', () => {
    assert.equal(
      coalesceStreamChunk('用户要求操作日历', '用户要求操作日历至12月。'),
      '用户要求操作日历至12月。'
    )
  })

  it('keeps the later rewrite that restates the earlier draft', () => {
    const early = '用户要求操作日历至12月。'
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    assert.equal(coalesceStreamChunk(early, later), later)
  })

  it('drops a duplicate snapshot', () => {
    const thought =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    assert.equal(coalesceStreamChunk(thought, thought), thought)
    assert.equal(coalesceStreamChunk(`${thought}\n\n`, thought), thought)
  })

  it('ignores a stale shorter snapshot', () => {
    const full = '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。'
    assert.equal(coalesceStreamChunk(full, '正在检查工作区环境'), full)
  })
})

describe('foldSnapshotText', () => {
  it('keeps the covering paragraph when snapshots were joined with blank lines', () => {
    const early = '用户要求操作日历至12月。'
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    assert.equal(foldSnapshotText([early, later, later, later].join('\n\n')), later)
  })

  it('strips a concatenated repeated suffix', () => {
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    assert.equal(foldSnapshotText(later + later + later), later)
  })
})

describe('streamTextCovers', () => {
  it('treats a restated sentence as covered', () => {
    assert.equal(
      streamTextCovers(
        '正在检查工作区环境。用户要求操作日历至12月份。',
        '用户要求操作日历至12月。'
      ),
      true
    )
  })
})
