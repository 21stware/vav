import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { REMOTE_PHONE_CLIENT_TYPES } from './remoteControl.ts'

const root = join(import.meta.dirname, '../..')

function androidTypes(source: string): Set<string> {
  const found = new Set<string>()
  const re = /encodeLine\(\s*"([a-z-]+)"/g
  for (const match of source.matchAll(re)) found.add(match[1]!)
  return found
}

function iosTypes(source: string): Set<string> {
  const found = new Set<string>()
  const re = /"type":\s*"([a-z-]+)"/g
  for (const match of source.matchAll(re)) found.add(match[1]!)
  return found
}

describe('Android ≈ iOS phone-plane verbs', () => {
  it('emits the same client frame types', () => {
    const android = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt'),
      'utf8'
    )
    const ios = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Models.swift'), 'utf8')
    const androidSet = androidTypes(android)
    const iosSet = iosTypes(ios)
    for (const verb of REMOTE_PHONE_CLIENT_TYPES) {
      assert.ok(androidSet.has(verb), `Android missing encodeLine("${verb}")`)
      assert.ok(iosSet.has(verb), `iOS missing type: "${verb}"`)
    }
  })

  it('paints the same recovery chrome as desktop for a leaked transport turn', () => {
    const androidClient = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt'),
      'utf8'
    )
    const androidModels = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/Models.kt'),
      'utf8'
    )
    const iosClient = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/RemoteClient.swift'),
      'utf8'
    )
    const iosModels = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Models.swift'), 'utf8')
    for (const source of [androidClient, iosClient]) {
      assert.match(source, /recovery/)
    }
    for (const source of [androidModels, iosModels]) {
      assert.match(source, /turnRecoveryLabel/)
      assert.match(source, /恢复中/)
      assert.match(source, /重试中/)
      assert.match(source, /重连中/)
    }
  })

  it('renders GFM agent logs the same way as iOS MarkdownUI', () => {
    const android = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/AgentMarkdown.kt'),
      'utf8'
    )
    const ios = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/AgentMarkdown.swift'),
      'utf8'
    )
    for (const source of [android, ios]) {
      assert.match(source, /withAgentLineBreaks/)
      assert.match(source, /isBlockLine/)
      assert.match(source, /```/)
      assert.match(source, /- \[/)
      assert.match(source, /\|/)
    }
  })

  it('paints the same change-review card as iOS', () => {
    const android = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionDetailScreen.kt'),
      'utf8'
    )
    const ios = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'),
      'utf8'
    )
    for (const source of [android, ios]) {
      assert.match(source, /改动审查/)
      assert.match(source, /全部接受/)
      assert.match(source, /全部拒绝/)
      assert.match(source, /changeSetId/)
      assert.match(source, /file\.name/)
      assert.match(source, /reviews/)
    }
  })

  it('keeps the same reconnect and create-session lifecycle as iOS', () => {
    const android = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt'),
      'utf8'
    )
    const activity = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/VavRemoteActivity.kt'),
      'utf8'
    )
    const ios = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/RemoteClient.swift'), 'utf8')
    const iosApp = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/VAVRemoteApp.swift'), 'utf8')
    for (const source of [android, ios]) {
      assert.match(source, /fun suspend|func suspend/)
      assert.match(source, /scheduleReconnect/)
      assert.match(source, /creating/)
      assert.match(source, /mergeThread/)
      assert.match(source, /local-/)
    }
    assert.match(activity, /client\.suspend\(\)/)
    assert.match(iosApp, /client\.suspend\(\)/)
  })
})
