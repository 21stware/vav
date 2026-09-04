import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dialogAlertOptions,
  dialogConfirmOptions,
  dialogMessageBoxOptions,
  revealSecretBoxOptions
} from './dialogOptions.ts'

describe('dialogOptions', () => {
  it('puts cancel as default on destructive confirms and indexes the OK button', () => {
    const alert = dialogAlertOptions({ title: 'Hi', message: 'Body' }, 'OK')
    assert.deepEqual(alert.buttons, ['OK'])
    assert.equal(alert.detail, 'Body')
    const danger = dialogConfirmOptions(
      { title: 'Delete', message: 'Sure?', destructive: true },
      { confirm: 'Delete', cancel: 'Cancel' }
    )
    assert.equal(danger.type, 'warning')
    assert.equal(danger.defaultId, 1)
    assert.equal(danger.cancelId, 1)
    const box = dialogMessageBoxOptions(
      { title: 'Q', message: '', buttons: [] },
      'OK'
    )
    assert.deepEqual(box.buttons, ['OK'])
    assert.equal(box.cancelId, 0)
    const reveal = revealSecretBoxOptions({
      cancel: 'Cancel',
      confirm: 'Show',
      title: 'Key',
      detail: 'Visible'
    })
    assert.equal(reveal.defaultId, 0)
    assert.deepEqual(reveal.buttons, ['Cancel', 'Show'])
    const lan = dialogConfirmOptions(
      { title: 'Pair', message: 'Allow studio?', preferCancel: true },
      { confirm: 'Allow', cancel: 'Deny' }
    )
    assert.equal(lan.type, 'question')
    assert.equal(lan.defaultId, 1)
    assert.deepEqual(lan.buttons, ['Allow', 'Deny'])
  })
})
