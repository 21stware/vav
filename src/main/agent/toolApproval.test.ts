import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  approvalPromptCopy,
  parseEditedApprovalText,
  readonlyApprovalBlock,
  shouldAutoAcceptChangeSet,
  shouldPauseForApproval,
  shouldSkipToolGate,
  terminalCommandFromArgs
} from './toolApproval.ts'

describe('shouldSkipToolGate / terminalCommandFromArgs', () => {
  it('skips interactive and wait tools', () => {
    assert.equal(shouldSkipToolGate('ask_user_question'), true)
    assert.equal(shouldSkipToolGate('plan'), true)
    assert.equal(shouldSkipToolGate('wait'), true)
    assert.equal(shouldSkipToolGate('fs_write'), false)
  })

  it('reads a terminal command from args', () => {
    assert.equal(terminalCommandFromArgs('terminal', { command: 'ls' }), 'ls')
    assert.equal(terminalCommandFromArgs('fs_write', { command: 'ls' }), '')
  })
})

describe('shouldAutoAcceptChangeSet', () => {
  it('auto-accepts only bypass', () => {
    assert.equal(shouldAutoAcceptChangeSet('bypass'), true)
    assert.equal(shouldAutoAcceptChangeSet('auto'), false)
    assert.equal(shouldAutoAcceptChangeSet('edit'), false)
    assert.equal(shouldAutoAcceptChangeSet(undefined), false)
  })
})

describe('readonlyApprovalBlock / shouldPauseForApproval', () => {
  it('hard-blocks writes and mutating shell in Read mode', () => {
    assert.match(readonlyApprovalBlock('fs_write', '')?.reason ?? '', /switch_mode/)
    assert.match(readonlyApprovalBlock('terminal', 'rm file')?.reason ?? '', /refused: rm file/)
    assert.equal(readonlyApprovalBlock('fs_read', ''), null)
    assert.equal(readonlyApprovalBlock('terminal', 'ls'), null)
  })

  it('pauses auto high-risk and edit-mode tools, not bypass', () => {
    assert.equal(
      shouldPauseForApproval({
        mode: 'bypass',
        name: 'fs_write',
        command: '',
        autoApproveReadonly: false
      }),
      false
    )
    assert.equal(
      shouldPauseForApproval({
        mode: 'auto',
        name: 'fs_read',
        command: '',
        autoApproveReadonly: true
      }),
      false
    )
    assert.equal(
      shouldPauseForApproval({
        mode: 'auto',
        name: 'terminal',
        command: 'npm run dev',
        autoApproveReadonly: true
      }),
      true
    )
    assert.equal(
      shouldPauseForApproval({
        mode: 'edit',
        name: 'fs_read',
        command: '',
        autoApproveReadonly: true
      }),
      true
    )
  })
})

describe('parseEditedApprovalText', () => {
  const isApprove = (text: string) => text === 'Approve' || text.startsWith('Approve\n')

  it('strips the approve label or keeps a free-form edit', () => {
    assert.equal(parseEditedApprovalText('Approve\nls -la', 'Approve', isApprove), 'ls -la')
    assert.equal(parseEditedApprovalText('Approve', 'Approve', isApprove), '')
    assert.equal(parseEditedApprovalText('cat README', 'Approve', isApprove), 'cat README')
  })
})

describe('approvalPromptCopy', () => {
  const auto = { approve: 'Approve', deny: 'Deny', title: 'Run fs_write?' }
  const edit = { approve: 'Approve and run', deny: 'Skip', title: 'Edit fs_write' }

  it('uses Auto vs Edit labels and only Edit is editable', () => {
    const autoCopy = approvalPromptCopy({ mode: 'auto', summary: 'write a.ts', auto, edit })
    assert.equal(autoCopy.approveLabel, 'Approve')
    assert.equal(autoCopy.denyLabel, 'Deny')
    assert.equal(autoCopy.editable, '')
    assert.equal(autoCopy.prompt, 'Run fs_write?\nwrite a.ts')

    const editCopy = approvalPromptCopy({ mode: 'edit', summary: 'write a.ts', auto, edit })
    assert.equal(editCopy.approveLabel, 'Approve and run')
    assert.equal(editCopy.denyLabel, 'Skip')
    assert.equal(editCopy.editable, 'write a.ts')
    assert.equal(editCopy.prompt, 'Edit fs_write\nwrite a.ts')
  })
})
