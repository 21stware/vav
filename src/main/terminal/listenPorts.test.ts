import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  childrenByParent,
  collectTreePids,
  parseLsofListen,
  parsePsRows,
  portsForTree
} from './listenPorts.ts'

describe('listenPorts', () => {
  it('parses lsof LISTEN fields into pid → ports', () => {
    const map = parseLsofListen(
      ['p421', 'n127.0.0.1:5173', 'n*:4173', 'p422', 'n[::1]:3000', 'nnot-a-port'].join('\n')
    )
    assert.deepEqual(map.get(421), [5173, 4173])
    assert.deepEqual(map.get(422), [3000])
  })

  it('walks a process tree and unions listen ports', () => {
    const rows = parsePsRows(
      ['  10  1 /bin/zsh -il', '  11 10 node ./node_modules/vite/bin/vite.js', '  12 11 /usr/bin/node'].join(
        '\n'
      )
    )
    assert.equal(rows.length, 3)
    const byParent = childrenByParent(rows)
    assert.deepEqual(collectTreePids(10, byParent).sort((a, b) => a - b), [10, 11, 12])
    const ports = portsForTree(
      10,
      byParent,
      new Map([
        [11, [5173]],
        [12, [5173, 24678]]
      ])
    )
    assert.deepEqual(ports, [5173, 24678])
  })
})
