import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_MIN_WIDTH,
  EMPTY_STATE_HIDE_NAME_AT,
  EMPTY_STATE_STACK_MIN,
  EMPTY_STATE_STAGE_MIN,
  FILE_SESSION_AGENT_MIN_WIDTH,
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  PREVIEW_MIN_WIDTH,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  WINDOW_MIN_WIDTH_FLOOR,
  WORKBENCH_COLLAPSED_HEIGHT,
  WORKBENCH_EXPANDED_HEIGHT,
  windowMinHeight,
  windowMinWidth
} from './shellMinSize.ts'

describe('windowMinWidth', () => {
  it('is the agent floor when only the conversation is visible', () => {
    assert.equal(
      windowMinWidth({
        sidebarVisible: false,
        agentVisible: true,
        previewVisible: false
      }),
      WINDOW_MIN_WIDTH_FLOOR
    )
    assert.ok(WINDOW_MIN_WIDTH_FLOOR >= AGENT_MIN_WIDTH)
  })

  it('constructor min includes the default sidebar so the frame cannot shrink past it', () => {
    assert.equal(
      MAIN_WINDOW_MIN_WIDTH,
      windowMinWidth({
        sidebarVisible: true,
        sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
        agentVisible: true,
        previewVisible: false
      })
    )
    assert.ok(MAIN_WINDOW_MIN_WIDTH > WINDOW_MIN_WIDTH_FLOOR)
  })

  it('adds the visible sidebar at its current width, not below the sidebar min', () => {
    const hidden = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      previewVisible: false
    })
    const atMin = windowMinWidth({
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_WIDTH_MIN,
      agentVisible: true,
      previewVisible: false
    })
    const atDefault = windowMinWidth({
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      agentVisible: true,
      previewVisible: false
    })
    assert.ok(atMin > hidden)
    assert.equal(atDefault - atMin, SIDEBAR_WIDTH_DEFAULT - SIDEBAR_WIDTH_MIN)
    assert.equal(
      windowMinWidth({
        sidebarVisible: true,
        sidebarWidth: 80,
        agentVisible: true,
        previewVisible: false
      }),
      atMin
    )
  })

  it('adds the preview floor when the right drawer is open', () => {
    const closed = windowMinWidth({
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      agentVisible: true,
      previewVisible: false
    })
    const open = windowMinWidth({
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      agentVisible: true,
      previewVisible: true
    })
    assert.equal(open - closed, PREVIEW_MIN_WIDTH + 1)
  })

  it('uses the file-session agent floor when that column is the side panel', () => {
    const main = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      previewVisible: true
    })
    const file = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      agentMinWidth: FILE_SESSION_AGENT_MIN_WIDTH,
      previewVisible: true
    })
    assert.equal(main - file, AGENT_MIN_WIDTH - FILE_SESSION_AGENT_MIN_WIDTH)
  })

  it('uses the live agent / preview width when it is wider than the floor', () => {
    const atMin = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      agentMinWidth: FILE_SESSION_AGENT_MIN_WIDTH,
      previewVisible: true
    })
    const live = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      agentMinWidth: FILE_SESSION_AGENT_MIN_WIDTH,
      agentWidth: 380,
      previewVisible: true
    })
    assert.equal(live - atMin, 380 - FILE_SESSION_AGENT_MIN_WIDTH)
    const previewLive = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      previewVisible: true,
      previewWidth: 400
    })
    assert.equal(
      previewLive - windowMinWidth({
        sidebarVisible: false,
        agentVisible: true,
        previewVisible: true
      }),
      400 - PREVIEW_MIN_WIDTH
    )
  })

  it('drops the agent column when a file-session hides it', () => {
    const both = windowMinWidth({
      sidebarVisible: false,
      agentVisible: true,
      agentMinWidth: FILE_SESSION_AGENT_MIN_WIDTH,
      previewVisible: true
    })
    const previewOnly = windowMinWidth({
      sidebarVisible: false,
      agentVisible: false,
      previewVisible: true
    })
    assert.ok(previewOnly < both)
    assert.ok(previewOnly >= PREVIEW_MIN_WIDTH)
  })
})

describe('windowMinHeight', () => {
  it('uses the compact empty-state tier that still shows mark + name', () => {
    assert.ok(EMPTY_STATE_STACK_MIN < EMPTY_STATE_STAGE_MIN)
    assert.equal(EMPTY_STATE_STAGE_MIN, EMPTY_STATE_HIDE_NAME_AT + 1)
    assert.ok(EMPTY_STATE_STAGE_MIN < 280)
  })

  it('constructor min is compact empty-state plus the collapsed workbench', () => {
    const collapsed = windowMinHeight({ workbenchExpanded: false })
    const expanded = windowMinHeight({ workbenchExpanded: true })
    assert.equal(collapsed, MAIN_WINDOW_MIN_HEIGHT)
    assert.equal(expanded - collapsed, WORKBENCH_EXPANDED_HEIGHT - WORKBENCH_COLLAPSED_HEIGHT)
    assert.ok(expanded > collapsed)
  })

  it('companion session omits the main-shell split floor pad', () => {
    const main = windowMinHeight({ workbenchExpanded: false, shell: 'main' })
    const session = windowMinHeight({ workbenchExpanded: false, shell: 'session' })
    assert.ok(session !== main)
  })
})
