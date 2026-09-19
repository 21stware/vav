import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatPortMark,
  isListenPort,
  isLoopbackProxyTarget,
  listenPortsEqual,
  loopbackHttpUrl,
  normalizeListenPorts,
  portForwardKey,
  portForwardsEqual
} from './ptyPorts.ts'

describe('ptyPorts', () => {
  it('normalizes, sorts, and de-dupes listen ports', () => {
    assert.deepEqual(normalizeListenPorts([5173, 0, 5173, 3000, 99_999]), [3000, 5173])
    assert.equal(isListenPort(5173), true)
    assert.equal(isListenPort(0), false)
  })

  it('compares port lists and forward rows', () => {
    assert.equal(listenPortsEqual([3000, 5173], [3000, 5173]), true)
    assert.equal(listenPortsEqual([3000], [5173]), false)
    assert.equal(listenPortsEqual(undefined, []), true)
    assert.equal(
      portForwardsEqual(
        [{ remotePort: 5173, localPort: 5173, status: 'forwarding' }],
        [{ remotePort: 5173, localPort: 5173, status: 'forwarding' }]
      ),
      true
    )
    assert.equal(
      portForwardsEqual(
        [{ remotePort: 5173, localPort: 5173, status: 'forwarding' }],
        [{ remotePort: 5173, localPort: 0, status: 'conflict' }]
      ),
      false
    )
  })

  it('formats marks and only allows loopback proxy targets', () => {
    assert.equal(formatPortMark(5173), ':5173')
    assert.equal(loopbackHttpUrl(5173), 'http://127.0.0.1:5173')
    assert.equal(portForwardKey('box-1', 5173), 'box-1:5173')
    assert.equal(isLoopbackProxyTarget('127.0.0.1'), true)
    assert.equal(isLoopbackProxyTarget('localhost'), true)
    assert.equal(isLoopbackProxyTarget(''), true)
    assert.equal(isLoopbackProxyTarget('10.0.0.4'), false)
  })
})
