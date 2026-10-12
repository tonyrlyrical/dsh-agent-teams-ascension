import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compressPayload,
  recoverPayload,
  compressTestLogs,
  compressStackTrace,
  CavemanPayloadStore,
} from '../src/caveman/proxy-engine.ts'

test('Proxy Engine Audit: compressTestLogs case-insensitivity and multiline preservation across blank lines', () => {
  const mixedCaseTestLog = [
    'Test execution started for suite: user-auth',
    'PASS src/crypto.test.ts (5 tests)',
    'PASS src/jwt.test.ts (3 tests)',
    'FAIL src/auth.test.ts (1 failed, 2 passed)',
    '',
    '  ● Authentication Service › verifySessionToken',
    '',
    '    assertionerror [ERR_ASSERTION]: Expected status 200 to equal 401',
    '',
    '    Difference:',
    '    - 200',
    '    + 401',
    '',
    '      at Object.<anonymous> (src/auth.test.ts:88:12)',
    '      at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '',
    'PASS src/session.test.ts (10 tests)',
    'Test Suites: 1 failed, 3 passed, 4 total',
    'Tests:       1 failed, 20 passed, 21 total',
  ].join('\n')

  const resLogs = compressTestLogs(mixedCaseTestLog)
  const compressed = resLogs.compressed
  // Preserves summary and failure indicators
  assert.ok(compressed.includes('assertionerror [ERR_ASSERTION]'), 'must capture lowercase assertionerror')
  assert.ok(compressed.includes('Authentication Service › verifySessionToken'), 'must capture test header')
  assert.ok(compressed.includes('src/auth.test.ts:88:12'), 'must capture stack line across blank lines')
  assert.ok(compressed.includes('passing test(s) elided'), 'must collapse passing test suites')
})

test('Proxy Engine Audit: compressStackTrace multiline exception header prior to frames', () => {
  const multilineError = [
    'DatabaseConnectionException: Unable to connect to host postgres-primary:5432',
    'Caused by: ConnectionTimeout: Connection attempt timed out after 5000ms',
    'Nested Info: Pool saturation detected (poolSize=50, activeClients=50)',
    '    at PostgresPool.connect (/app/node_modules/pg-pool/index.js:120:15)',
    '    at DatabaseClient.query (/app/src/db.js:45:20)',
    '    at UserService.getUserById (/app/src/user.js:89:12)',
    '    at SessionAuth.validateToken (/app/src/auth.js:33:18)',
    '    at Server.handleRequest (/app/src/server.js:105:22)',
    '    at /app/node_modules/express/lib/router/layer.js:95:5',
    '    at /app/node_modules/express/lib/router/index.js:284:7',
    '    at Immediate.<anonymous> (/app/src/main.js:12:3)',
  ].join('\n')

  const resTrace = compressStackTrace(multilineError)
  const compressed = resTrace.compressed
  assert.ok(compressed.includes('DatabaseConnectionException: Unable to connect to host postgres-primary:5432'))
  assert.ok(compressed.includes('Caused by: ConnectionTimeout: Connection attempt timed out after 5000ms'), 'multiline cause captured')
  assert.ok(compressed.includes('Nested Info: Pool saturation detected'), 'nested multiline header captured')
  assert.ok(compressed.includes('PostgresPool.connect'), 'top frame preserved')
  assert.ok(compressed.includes('runtime frames elided'), 'intermediate frames collapsed')
  assert.ok(compressed.includes('Immediate.<anonymous>'), 'bottom frame preserved')
})

test('Proxy Engine Audit: CavemanPayloadStore single payload > maxTotalBytes guard', () => {
  const smallStore = new CavemanPayloadStore({ maxEntries: 10, maxTotalBytes: 1024 }) // 1 KB maxTotalBytes
  const hugePayload = 'X'.repeat(2048) // 2 KB payload

  const id = smallStore.storePayload(hugePayload, 'text')
  assert.equal(id, null, 'must reject payload exceeding maxTotalBytes to protect heap')
  assert.equal(smallStore.stats().count, 0)
  assert.equal(smallStore.stats().totalBytes, 0)
})

test('Proxy Engine Audit: Disk persistence survives in-memory restart and recaches', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'caveman-audit-'))
  const teamId = 'team-audit-persistence'

  try {
    const store1 = new CavemanPayloadStore({ maxEntries: 50, maxTotalBytes: 10 * 1024 * 1024 })
    const rows = ['timestamp,worker,status,metric_a,metric_b']
    for (let i = 1; i <= 25; i++) {
      rows.push(`2026-10-11T20:00:${i.toString().padStart(2, '0')}.000Z,worker-${i},healthy,${i * 100},${i * 50}`)
    }
    const content = rows.join('\n')

    // Compress & persist to disk
    const comp = compressPayload(content, { minBytes: 100, teamId, stateRoot: tmpDir }, store1)
    assert.equal(comp.wasCompressed, true)
    assert.ok(comp.recoveryId)

    // Simulate complete process crash / restart with fresh empty store
    const store2 = new CavemanPayloadStore({ maxEntries: 50, maxTotalBytes: 10 * 1024 * 1024 })
    assert.equal(store2.has(comp.recoveryId), false, 'new store does not have it in memory')

    // Recovery retrieves it from disk
    const recovered = store2.getPayload(comp.recoveryId, { teamId, stateRoot: tmpDir })
    assert.equal(recovered.ok, true, 'recovered from disk fallback')
    assert.equal(recovered.content, content, 'exact byte content matches')

    // Verify it was re-populated in store2 cache
    assert.equal(store2.has(comp.recoveryId), true, 'recached in memory after disk read')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('Proxy Engine Audit: Multi-team authorization isolation', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'caveman-audit-auth-'))
  const teamA = 'team-alpha'
  const teamB = 'team-bravo'

  try {
    const store = new CavemanPayloadStore({ maxEntries: 50, maxTotalBytes: 10 * 1024 * 1024 })
    const secretData = 'Confidential payload data for Team Alpha only'

    const recoveryId = store.storePayload(secretData, 'text', { teamId: teamA, stateRoot: tmpDir })
    assert.ok(recoveryId)

    // Team Alpha retrieves successfully
    const recAlpha = store.getPayload(recoveryId, { teamId: teamA, stateRoot: tmpDir })
    assert.equal(recAlpha.ok, true)
    assert.equal(recAlpha.content, secretData)

    // Team Bravo attempts to retrieve Team Alpha's payload -> REJECTED
    const recBravo = store.getPayload(recoveryId, { teamId: teamB, stateRoot: tmpDir })
    assert.equal(recBravo.ok, false)
    assert.ok(recBravo.error?.includes('Unauthorized'), 'unauthorized team access must be denied')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
