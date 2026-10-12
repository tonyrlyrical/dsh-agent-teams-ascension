import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compressPayload,
  recoverPayload,
  CavemanPayloadStore,
} from '../src/caveman/proxy-engine.ts'
import {
  CAVEMAN_PROMPT_INSTRUCTIONS,
  formatCavemanInstruction,
  applySyntheticCavemanVoice,
} from '../src/caveman/rules.ts'

test('Caveman Rules: instructions and synthetic voice compression', () => {
  assert.ok(CAVEMAN_PROMPT_INSTRUCTIONS.includes('Answer First'))
  assert.ok(CAVEMAN_PROMPT_INSTRUCTIONS.includes('Zero Fluff'))

  const formatted = formatCavemanInstruction('Custom task instruction.')
  assert.ok(formatted.startsWith('Custom task instruction.'))
  assert.ok(formatted.includes('[Economy Mode - Caveman Output Brevity Protocol]'))

  const verbose = 'Hello dear user! As requested, here is the result. It is important to remember that we did not fail. In order to complete the test, please check the function:\n```ts\nfunction calculate(a: number): number {\n  return a * 2;\n}\n```\nI hope this helps! Have a great day!'
  const compressed = applySyntheticCavemanVoice(verbose)

  // Filler stripped
  assert.ok(!compressed.includes('Hello dear user'))
  assert.ok(!compressed.includes('I hope this helps'))
  assert.ok(!compressed.includes('Have a great day'))

  // Negation preserved
  assert.ok(compressed.includes('did not fail'))

  // Code block preserved verbatim
  assert.ok(compressed.includes('function calculate(a: number): number {\n  return a * 2;\n}'))
})

test('Caveman Proxy: CSV compression and exact byte-for-byte recovery', () => {
  const store = new CavemanPayloadStore()
  const rows = ['id,agent_name,role,status,tasks_count,tokens_used,latency_ms']
  for (let i = 1; i <= 25; i++) {
    rows.push(`${i},worker-${i},role-${i},active,${i * 2},${i * 1500},${300 + i * 20}`)
  }
  const csvData = rows.join('\n')

  const res = compressPayload(csvData, { minBytes: 100 }, store)
  assert.equal(res.wasCompressed, true)
  assert.equal(res.category, 'csv')
  assert.ok(res.recoveryId)
  assert.ok(res.savingsPercent >= 30)
  assert.ok(res.text.includes('CSV: 25 rows, 7 columns'))
  assert.ok(res.text.includes('Full payload recoverable with tool agent_teams_recover_payload'))

  // Exact byte-for-byte recovery
  const recovered = recoverPayload(res.recoveryId, store)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.content, csvData)
  assert.equal(recovered.originalBytes, Buffer.byteLength(csvData, 'utf8'))
})

test('Caveman Proxy: Test logs compression and exact recovery', () => {
  const store = new CavemanPayloadStore()
  const testLogs = [
    '▶ Ascension Suite: Token Telemetry Tests',
    '  ✔ test 1: verifies ledger deduplication (0.2ms)',
    '  ✔ test 2: verifies attempt retry separation (0.3ms)',
    '  ✔ test 3: verifies budget hard stop (0.4ms)',
    '  ✔ test 4: verifies non-overlapping formula (0.1ms)',
    '  ✔ test 5: verifies provider attribution (0.2ms)',
    '  ✔ test 6: verifies host billing rate (0.3ms)',
    '  ✔ test 7: verifies zero-claim tasks (0.1ms)',
    '  ✖ test 8: unexpected connection drop in worker gamma',
    '    AssertionError: expected true but got false',
    '        at Context.<anonymous> (test/telemetry.test.ts:42:12)',
    '        at callFn (node_modules/cordis/dist/index.js:15:20)',
    '  ✔ test 9: verifies fallback recovery (0.2ms)',
    '  ✔ test 10: verifies session handoff (0.1ms)',
    'ℹ tests 10',
    'ℹ pass 9',
    'ℹ fail 1',
    'ℹ duration_ms 45.2',
  ].join('\n')

  const res = compressPayload(testLogs, { minBytes: 100 }, store)
  assert.equal(res.wasCompressed, true)
  assert.equal(res.category, 'test_logs')
  assert.ok(res.recoveryId)
  assert.ok(res.text.includes('9 passing test(s) elided'))
  assert.ok(res.text.includes('test 8: unexpected connection drop in worker gamma'))
  assert.ok(res.text.includes('ℹ fail 1'))

  // Exact recovery
  const recovered = recoverPayload(res.recoveryId, store)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.content, testLogs)
})

test('Caveman Proxy: Deep stack trace compression', () => {
  const store = new CavemanPayloadStore()
  const stackTrace = [
    'Error: Database connection pool exhausted',
    '    at ConnectionPool.acquire (src/db/pool.ts:45:11)',
    '    at QueryRunner.execute (src/db/runner.ts:22:9)',
    '    at UserService.getUser (src/services/user.ts:88:17)',
    '    at AuthController.login (src/controllers/auth.ts:34:25)',
    '    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)',
    '    at next (node_modules/express/lib/router/route.js:144:13)',
    '    at Route.dispatch (node_modules/express/lib/router/route.js:114:3)',
    '    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)',
    '    at node_modules/express/lib/router/index.js:284:15',
    '    at Function.process_params (node_modules/express/lib/router/index.js:346:12)',
    '    at next (node_modules/express/lib/router/index.js:280:10)',
    '    at expressInit (node_modules/express/lib/middleware/init.js:40:5)',
  ].join('\n')

  const res = compressPayload(stackTrace, { minBytes: 100 }, store)
  assert.equal(res.wasCompressed, true)
  assert.equal(res.category, 'stack_trace')
  assert.ok(res.text.includes('internal runtime frames elided'))
  assert.ok(res.text.includes('ConnectionPool.acquire'))

  const recovered = recoverPayload(res.recoveryId, store)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.content, stackTrace)
})

test('Caveman Proxy: Source code guard: source code is NOT compressed', () => {
  const store = new CavemanPayloadStore()
  const sourceCode = `
import { readFile, writeFile } from 'node:fs/promises'
import type { TeamState, TeamTask } from './types.ts'

export class TaskManager {
  private tasks: TeamTask[] = []

  async executeTask(task: TeamTask): Promise<void> {
    const data = await readFile('config.json', 'utf8')
    console.log(data)
  }
}
`.trim()

  const res = compressPayload(sourceCode, { minBytes: 100 }, store)
  assert.equal(res.wasCompressed, false)
  assert.equal(res.text, sourceCode)
  assert.equal(res.recoveryId, undefined)
})

test('Caveman Proxy: Threshold guard: text < minBytes is NOT compressed', () => {
  const shortText = 'Small message under threshold.'
  const res = compressPayload(shortText, { minBytes: 300 })
  assert.equal(res.wasCompressed, false)
  assert.equal(res.text, shortText)
})

test('Caveman Proxy: TTL and capacity eviction in store', () => {
  // Store with capacity of 2 items
  const store = new CavemanPayloadStore({ maxEntries: 2, ttlMs: 1000 })
  const id1 = store.storePayload('payload-1-data-here-123', 'test')
  const id2 = store.storePayload('payload-2-data-here-456', 'test')

  assert.equal(store.has(id1), true)
  assert.equal(store.has(id2), true)

  // Adding 3rd item evicts oldest (id1)
  const id3 = store.storePayload('payload-3-data-here-789', 'test')
  assert.equal(store.has(id1), false)
  assert.equal(store.has(id2), true)
  assert.equal(store.has(id3), true)

  const rec = recoverPayload(id1, store)
  assert.equal(rec.ok, false)
  assert.ok(rec.error?.includes('not found or expired'))
})
