import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { drivesNativeWindowTheme } from './nativeWindowTheme.ts'

describe('drivesNativeWindowTheme', () => {
  it('lets the main shell and Settings drive native chrome', () => {
    assert.equal(drivesNativeWindowTheme(''), true)
    assert.equal(drivesNativeWindowTheme('?'), true)
    assert.equal(drivesNativeWindowTheme('?view=settings'), true)
  })

  it('keeps companion windows from overriding nativeTheme', () => {
    assert.equal(drivesNativeWindowTheme('?view=session&conversationId=1'), false)
    assert.equal(drivesNativeWindowTheme('?view=file-preview&path=/tmp/a'), false)
    assert.equal(drivesNativeWindowTheme('?view=token-usage'), false)
    assert.equal(drivesNativeWindowTheme('?view=remote-folder'), false)
  })
})
