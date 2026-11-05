import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../deploy/cloud/systemd/', import.meta.url)
const read = name => readFile(new URL(name, root), 'utf8')

test('aggregate slice has one explicit memory and swap boundary', async () => {
  const text = await read('flymind.slice')
  assert.match(text, /^\[Slice\]$/m)
  for (const line of ['MemoryAccounting=yes', 'MemoryHigh=1000M', 'MemoryMax=1024M', 'MemorySwapMax=0']) {
    assert.equal(text.split(/\r?\n/).filter(item => item === line).length, 1, line)
  }
  const high=Number(/^MemoryHigh=(\d+)M$/m.exec(text)?.[1])
  const max=Number(/^MemoryMax=(\d+)M$/m.exec(text)?.[1])
  assert.ok(Number.isFinite(high)&&Number.isFinite(max)&&high>max-128, 'soft limit must exceed the 128 MiB pressure boundary')
  assert.ok(high<max, 'soft limit must remain below the hard limit')
  assert.doesNotMatch(text, /^\s*(?:MemoryLimit|TasksMax|CPUQuota|OOMPolicy)=/m)
})

test('all three fixed services join the same slice without changing service semantics', async () => {
  for (const service of ['flymind-application', 'flymind-gateway', 'flymind-control-plane']) {
    const text = await read(`${service}.service.d/10-flymind-slice.conf`)
    assert.equal(text.replace(/\r\n/g, '\n'), '[Service]\nSlice=flymind.slice\n', service)
  }
})
