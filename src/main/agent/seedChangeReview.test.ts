import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ChangeSetStore } from './ChangeSetStore.ts'
import { seedChangeReviewTurn } from './seedChangeReview.ts'

describe('seedChangeReviewTurn', () => {
  it('freezes two pending files the inline review can accept', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-seed-review-'))
    try {
      const changeSets = new ChangeSetStore()
      const seeded = await seedChangeReviewTurn({
        conversationId: 'e2e-session',
        workdir: dir,
        changeSets,
        appendMessages: () => undefined
      })
      assert.ok(seeded?.setId)
      assert.equal(seeded?.pendingCount, 2)
      const active = changeSets.activeFor('e2e-session')
      assert.equal(active?.id, seeded.setId)
      assert.ok(active?.files.some((file) => file.filePath.endsWith('existing.ts')))
      assert.ok(active?.files.some((file) => file.filePath.endsWith('added.ts')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
