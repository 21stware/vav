import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampKeepAwakeBatteryFloor,
  grantListedInSudoL,
  hasActiveAgentWork,
  KEEP_AWAKE_BATTERY_FLOOR_DEFAULT,
  KEEP_AWAKE_BATTERY_FLOOR_MAX,
  KEEP_AWAKE_BATTERY_FLOOR_MIN,
  keepAwakeSafetyHold,
  parseBatteryStatus,
  parseLowPowerMode,
  parseSleepDisabled,
  shouldBlockIdleSleep,
  shouldBlockLidSleep,
  sudoersGrantLine
} from './sleepBlocker.ts'

describe('hasActiveAgentWork', () => {
  it('is false with no turns or panes', () => {
    assert.equal(hasActiveAgentWork({}), false)
    assert.equal(hasActiveAgentWork({ turns: [], cliAgentStatuses: [] }), false)
  })

  it('is true when any structured turn is running', () => {
    assert.equal(hasActiveAgentWork({ turns: ['paused', 'running'] }), true)
  })

  it('ignores paused turns (awaiting the user)', () => {
    assert.equal(hasActiveAgentWork({ turns: ['paused'] }), false)
  })

  it('is true when a CLI agent PTY is classified running', () => {
    assert.equal(hasActiveAgentWork({ cliAgentStatuses: ['idle', 'running'] }), true)
  })

  it('ignores idle and exited CLI panes', () => {
    assert.equal(hasActiveAgentWork({ cliAgentStatuses: ['idle', 'exited'] }), false)
  })
})

describe('shouldBlockIdleSleep', () => {
  it('requires the setting and active work', () => {
    assert.equal(shouldBlockIdleSleep(false, true), false)
    assert.equal(shouldBlockIdleSleep(true, false), false)
    assert.equal(shouldBlockIdleSleep(true, true), true)
  })

  it('drops the assertion on a safety hold', () => {
    assert.equal(shouldBlockIdleSleep(true, true, 'battery'), false)
    assert.equal(shouldBlockIdleSleep(true, true, 'low-power'), false)
  })
})

describe('shouldBlockLidSleep', () => {
  it('also requires the sudoers grant', () => {
    assert.equal(shouldBlockLidSleep(true, true, false), false)
    assert.equal(shouldBlockLidSleep(true, true, true), true)
    assert.equal(shouldBlockLidSleep(true, true, true, 'battery'), false)
  })
})

describe('clampKeepAwakeBatteryFloor', () => {
  it('defaults junk and clamps the Sleepless range', () => {
    assert.equal(clampKeepAwakeBatteryFloor(undefined), KEEP_AWAKE_BATTERY_FLOOR_DEFAULT)
    assert.equal(clampKeepAwakeBatteryFloor(1), KEEP_AWAKE_BATTERY_FLOOR_MIN)
    assert.equal(clampKeepAwakeBatteryFloor(90), KEEP_AWAKE_BATTERY_FLOOR_MAX)
    assert.equal(clampKeepAwakeBatteryFloor(20.4), 20)
  })
})

describe('keepAwakeSafetyHold', () => {
  it('ignores AC and charging', () => {
    assert.equal(
      keepAwakeSafetyHold({
        onBattery: false,
        discharging: false,
        percent: 5,
        lowPowerMode: true,
        floorPercent: 15
      }),
      null
    )
    assert.equal(
      keepAwakeSafetyHold({
        onBattery: true,
        discharging: false,
        percent: 5,
        lowPowerMode: true,
        floorPercent: 15
      }),
      null
    )
  })

  it('battery floor wins over Low Power Mode', () => {
    assert.equal(
      keepAwakeSafetyHold({
        onBattery: true,
        discharging: true,
        percent: 10,
        lowPowerMode: true,
        floorPercent: 15
      }),
      'battery'
    )
  })

  it('Low Power Mode holds when the floor is clear', () => {
    assert.equal(
      keepAwakeSafetyHold({
        onBattery: true,
        discharging: true,
        percent: 40,
        lowPowerMode: true,
        floorPercent: 15
      }),
      'low-power'
    )
  })
})

describe('sudoersGrantLine', () => {
  it('emits the two exact pmset commands', () => {
    assert.equal(
      sudoersGrantLine('oboo'),
      'oboo ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1'
    )
  })

  it('rejects names that could widen the grant', () => {
    assert.equal(sudoersGrantLine('foo ALL=(root) NOPASSWD: /bin/sh'), null)
    assert.equal(sudoersGrantLine('a;b'), null)
  })
})

describe('grantListedInSudoL', () => {
  it('requires both disablesleep vectors', () => {
    assert.equal(
      grantListedInSudoL(
        '(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1'
      ),
      true
    )
    assert.equal(grantListedInSudoL('(root) NOPASSWD: /usr/bin/pmset'), false)
  })
})

describe('pmset parsers', () => {
  it('reads SleepDisabled and lowpowermode from pmset -g', () => {
    const sample = `
 sleep             1
 displaysleep      10
 lowpowermode      0
 SleepDisabled        1
`
    assert.equal(parseSleepDisabled(sample), true)
    assert.equal(parseLowPowerMode(sample), false)
    assert.equal(parseSleepDisabled('displaysleep 10\n'), false)
    assert.equal(parseLowPowerMode('lowpowermode         1\n'), true)
  })

  it('reads battery power, discharge, and percent', () => {
    const batt = `Now drawing from 'Battery Power'
 -InternalBattery-0\t82%; discharging; 5:23 remaining present: true`
    assert.deepEqual(parseBatteryStatus(batt), {
      onBattery: true,
      discharging: true,
      percent: 82
    })
    const ac = `Now drawing from 'AC Power'
 -InternalBattery-0\t100%; charged; 0:00 remaining present: true`
    assert.deepEqual(parseBatteryStatus(ac), {
      onBattery: false,
      discharging: false,
      percent: 100
    })
  })
})
