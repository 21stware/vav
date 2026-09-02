import assert from 'node:assert/strict'
import type { NetworkInterfaceInfo } from 'node:os'
import { describe, it } from 'node:test'
import {
  advertisedPairingAddresses,
  collectDialTargets,
  lanAddresses,
  mdnsName,
  visibleLanPeers
} from './lanAnnounce.ts'

function nic(
  address: string,
  extra: Partial<NetworkInterfaceInfo> = {}
): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
    ...extra
  }
}

describe('lanAddresses', () => {
  it('prefers en0 over bridge / VPN and skips link-local', () => {
    const found = lanAddresses({
      bridge100: [nic('192.168.50.1')],
      utun0: [nic('100.64.1.2')],
      awdl0: [nic('169.254.3.4')],
      en0: [nic('192.168.1.10')]
    })
    assert.deepEqual(found, ['192.168.1.10', '100.64.1.2'])
  })
})

describe('mdnsName', () => {
  it('keeps an existing .local hostname', () => {
    assert.equal(mdnsName('Mac-mini-2.local', 'ignored'), 'Mac-mini-2.local')
  })

  it('appends .local to a short hostname', () => {
    assert.equal(mdnsName('office-mac'), 'office-mac.local')
  })
})

describe('advertisedPairingAddresses', () => {
  it('leads with the physical LAN IP and includes Bonjour', () => {
    const advertised = advertisedPairingAddresses({
      interfaces: {
        en0: [nic('10.0.0.8')],
        bridge100: [nic('192.168.50.18')]
      },
      hostname: 'Mac-mini-2.local'
    })
    assert.equal(advertised.host, '10.0.0.8')
    assert.deepEqual(advertised.addresses, ['10.0.0.8', 'Mac-mini-2.local'])
  })
})

describe('collectDialTargets', () => {
  it('tries the multicast source before a stale pairing IP', () => {
    const targets = collectDialTargets({
      host: '192.168.50.18',
      port: 55950,
      addresses: ['192.168.50.18'],
      name: 'Mac-mini-2.local',
      machineId: 'mini',
      discovered: [{ machineId: 'mini', address: '192.168.1.10', port: 55950 }],
      localAddresses: ['192.168.1.20']
    })
    assert.equal(targets[0]?.host, '192.168.1.10')
    assert.ok(targets.some((row) => row.host === 'Mac-mini-2.local'))
  })

  it('skips this machine’s own addresses from the pairing line', () => {
    const targets = collectDialTargets({
      host: '198.18.0.1',
      port: 4750,
      addresses: ['192.168.1.13', '198.18.0.1', 'Mac-mini-2.local'],
      name: 'Mac-mini-2.local',
      localAddresses: ['192.168.1.8', '198.18.0.1']
    })
    assert.deepEqual(
      targets.map((row) => row.host),
      ['192.168.1.13', 'Mac-mini-2.local']
    )
  })

  it('ranks a same-subnet IPv4 ahead of Bonjour', () => {
    const targets = collectDialTargets({
      host: '10.8.0.2',
      port: 4750,
      addresses: ['10.8.0.2'],
      name: 'box.local',
      localAddresses: ['10.8.0.9']
    })
    assert.equal(targets[0]?.host, '10.8.0.2')
    assert.equal(targets.at(-1)?.host, 'box.local')
  })
})

describe('visibleLanPeers', () => {
  it('drops this machine by id, local IP, and Bonjour name', () => {
    const peers = visibleLanPeers(
      [
        { machineId: 'self', address: '10.0.0.2', seenAt: 2 },
        { machineId: 'other', address: '10.0.0.3', seenAt: 2 },
        { machineId: 'loop', address: '127.0.0.1', seenAt: 2 },
        { machineId: 'mdns', address: 'office-mac.local', seenAt: 2 },
        { machineId: 'dup', address: '10.0.0.8', seenAt: 1 },
        { machineId: 'dup', address: '10.0.0.9', seenAt: 3 }
      ],
      {
        machineId: 'self',
        localAddresses: ['10.0.0.2'],
        mdns: 'office-mac.local'
      }
    )
    assert.deepEqual(
      peers.map((p) => `${p.machineId}@${p.address}`),
      ['dup@10.0.0.9', 'other@10.0.0.3']
    )
  })
})
