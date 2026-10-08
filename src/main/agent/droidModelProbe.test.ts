import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { droidModelsFromSession, removeProbeSession } from './droidModelProbe.ts'

describe('droidModelsFromSession', () => {
  it('keeps exact ACP ids and names, deduped', () => {
    const models = droidModelsFromSession({
      sessionId: 's1',
      models: {
        currentModelId: 'gpt-6-sol',
        availableModels: [
          { modelId: 'auto', name: 'Auto Model', description: '1x Factory token rate' },
          { modelId: 'claude-opus-4-8-fast', name: 'Opus 4.8 Fast' },
          { modelId: 'claude-opus-4-8-fast', name: 'dup' },
          { modelId: 'kimi-k3' }
        ]
      }
    })
    assert.deepEqual(models, [
      { id: 'auto', label: 'Auto Model' },
      { id: 'claude-opus-4-8-fast', label: 'Opus 4.8 Fast' },
      { id: 'kimi-k3', label: 'kimi-k3' }
    ])
  })

  it('returns nothing when models are missing', () => {
    assert.deepEqual(droidModelsFromSession({ sessionId: 's1' }), [])
    assert.deepEqual(droidModelsFromSession(null), [])
  })
})

describe('removeProbeSession', () => {
  it('deletes only the probe session files and the empty probe dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vav-droid-sessions-'))
    const probeDir = join(root, '-private-var-folders-T-vav-droid-models-abc123')
    const userDir = join(root, '-Users-me-repo')
    await mkdir(probeDir)
    await mkdir(userDir)
    await writeFile(join(probeDir, 'sess-1.jsonl'), '{}')
    await writeFile(join(probeDir, 'sess-1.settings.json'), '{}')
    await writeFile(join(userDir, 'sess-1.jsonl'), '{}')
    await writeFile(join(userDir, 'other.jsonl'), '{}')

    await removeProbeSession(root, 'sess-1')

    assert.deepEqual((await readdir(root)).sort(), ['-Users-me-repo'])
    assert.deepEqual((await readdir(userDir)).sort(), ['other.jsonl', 'sess-1.jsonl'])
  })

  it('keeps a probe dir that still holds other files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vav-droid-sessions-'))
    const probeDir = join(root, '-tmp-vav-droid-models-xyz')
    await mkdir(probeDir)
    await writeFile(join(probeDir, 'sess-2.jsonl'), '{}')
    await writeFile(join(probeDir, 'sess-3.jsonl'), '{}')

    await removeProbeSession(root, 'sess-2')

    assert.deepEqual(await readdir(probeDir), ['sess-3.jsonl'])
  })
})
