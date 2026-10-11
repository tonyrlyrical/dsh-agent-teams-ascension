import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeTokenUsage,
  tokenEventKey,
  readTokenLedger,
  writeTokenLedger,
  recordTokenUsageEvent,
  generateTeamTokenReport,
  exportReportToCsv,
  saveTeamTokenReport,
} from '../lib/token-accounting.js'

function makeTempState() {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-token-test-'))
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('normalizeTokenUsage: exact authoritative usage from provider response', () => {
  const raw = {
    inputTokens: 1200,
    outputTokens: 350,
    totalTokens: 1550,
    cacheReadTokens: 400,
    cacheWriteTokens: 100,
    reasoningTokens: 150,
  }
  const norm = normalizeTokenUsage(raw)
  assert.equal(norm.quality, 'exact')
  assert.equal(norm.inputTokens, 1200)
  assert.equal(norm.outputTokens, 350)
  assert.equal(norm.totalTokens, 1550)
  assert.equal(norm.cacheReadTokens, 400)
  assert.equal(norm.cacheWriteTokens, 100)
  assert.equal(norm.reasoningTokens, 150)
})

test('normalizeTokenUsage: missing raw usage marked unknown with zeros', () => {
  const norm = normalizeTokenUsage(undefined)
  assert.equal(norm.quality, 'unknown')
  assert.equal(norm.inputTokens, 0)
  assert.equal(norm.outputTokens, 0)
  assert.equal(norm.totalTokens, 0)
  assert.equal(norm.cacheReadTokens, 0)
  assert.equal(norm.reasoningTokens, 0)
})

test('normalizeTokenUsage: computes totalTokens cleanly when provider omits totalTokens', () => {
  const raw = {
    inputTokens: 500,
    outputTokens: 200,
    cacheReadTokens: 150,
    cacheWriteTokens: 50,
  }
  const norm = normalizeTokenUsage(raw)
  assert.equal(norm.quality, 'exact')
  assert.equal(norm.totalTokens, 900) // 500 + 200 + 150 + 50
})

test('tokenEventKey generates deterministic composite key', () => {
  const key1 = tokenEventKey('session-123', 2, 4)
  const key2 = tokenEventKey('session-123', 2, 4)
  const key3 = tokenEventKey('session-123', 2, 5)
  assert.equal(key1, 'session-123:2:4')
  assert.equal(key1, key2)
  assert.notEqual(key1, key3)
})

test('ledger round-trip and event deduplication', async () => {
  const { root, cleanup } = makeTempState()
  try {
    const emptyLedger = await readTokenLedger(root, 'team-alpha')
    assert.equal(emptyLedger.events.length, 0)

    const event1 = {
      id: 'ev-1',
      teamId: 'team-alpha',
      taskId: 't1',
      attemptId: 'att-1',
      agentId: 'ag-1',
      agentName: 'researcher',
      role: 'Research',
      sessionId: 'sess-worker',
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      turn: 1,
      step: 0,
      timestamp: 1000,
      durationMs: 250,
      outcome: 'completed',
      quality: 'exact',
      inputTokens: 500,
      outputTokens: 100,
      totalTokens: 600,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      toolCallsCount: 1,
      operatingMode: 'normal',
      isRetry: false,
    }

    const first = await recordTokenUsageEvent(root, 'team-alpha', event1)
    assert.equal(first.recorded, true)
    assert.equal(first.duplicate, false)

    // Repeat identical event (same session, turn, step)
    const duplicate = await recordTokenUsageEvent(root, 'team-alpha', event1)
    assert.equal(duplicate.recorded, false)
    assert.equal(duplicate.duplicate, true)

    const ledger = await readTokenLedger(root, 'team-alpha')
    assert.equal(ledger.events.length, 1)
    assert.equal(ledger.events[0].totalTokens, 600)
  } finally {
    cleanup()
  }
})

test('generateTeamTokenReport: aggregates exact tokens, tasks, agents, and limitations without LLM', () => {
  const team = {
    id: 'team-test',
    name: 'Test Team',
    createdAt: 1000,
    operatingMode: 'economy',
    captainSessionId: 'sess-captain',
    members: [
      { name: 'coder', role: 'Engineer', provider: 'deepseek-official', model: 'deepseek-coder', status: 'idle' },
      { name: 'tester', role: 'QA', provider: 'deepseek-official', model: 'deepseek-chat', status: 'idle' },
    ],
    tasks: [
      { id: 't1', subject: 'Implement feature', status: 'completed', assignee: 'coder', attempt: 1 },
      { id: 't2', subject: 'Verify tests', status: 'completed', assignee: 'tester', attempt: 1 },
    ],
  }

  const ledger = {
    schemaVersion: 1,
    teamId: 'team-test',
    deduplicatedKeys: ['sess-coder:1:0', 'sess-tester:1:0', 'sess-captain:1:0'],
    events: [
      {
        id: 'ev-1',
        teamId: 'team-test',
        taskId: 't1',
        attemptId: 'att-1',
        agentId: 'ag-coder',
        agentName: 'coder',
        role: 'Engineer',
        sessionId: 'sess-coder',
        provider: 'deepseek-official',
        model: 'deepseek-coder',
        turn: 1,
        step: 0,
        timestamp: 1200,
        durationMs: 800,
        outcome: 'completed',
        quality: 'exact',
        inputTokens: 1000,
        outputTokens: 400,
        totalTokens: 1400,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
        reasoningTokens: 100,
        toolCallsCount: 2,
        operatingMode: 'economy',
        isRetry: false,
      },
      {
        id: 'ev-2',
        teamId: 'team-test',
        taskId: 't2',
        attemptId: 'att-2',
        agentId: 'ag-tester',
        agentName: 'tester',
        role: 'QA',
        sessionId: 'sess-tester',
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        turn: 1,
        step: 0,
        timestamp: 2100,
        durationMs: 400,
        outcome: 'completed',
        quality: 'exact',
        inputTokens: 600,
        outputTokens: 150,
        totalTokens: 750,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        toolCallsCount: 1,
        operatingMode: 'economy',
        isRetry: false,
      },
      {
        id: 'ev-3',
        teamId: 'team-test',
        agentId: 'ag-captain',
        agentName: 'captain',
        role: 'captain',
        sessionId: 'sess-captain',
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        turn: 1,
        step: 0,
        timestamp: 2500,
        durationMs: 300,
        outcome: 'completed',
        quality: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        toolCallsCount: 1,
        operatingMode: 'economy',
        isRetry: false,
      },
    ],
  }

  const report = generateTeamTokenReport(team, ledger, {
    baselineTotalTokens: 3000,
    peakConcurrentWorkers: 2,
  })

  assert.equal(report.teamId, 'team-test')
  assert.equal(report.operatingMode, 'economy')
  assert.equal(report.finalStatus, 'completed')
  assert.equal(report.totalTasks, 2)
  assert.equal(report.completedTasks, 2)
  assert.equal(report.totalInvocations, 3)
  assert.equal(report.exactInvocations, 2)
  assert.equal(report.unknownInvocations, 1)
  assert.equal(report.exactCoveragePercentage, 66.67)
  assert.equal(report.exactInputTokens, 1600)
  assert.equal(report.exactOutputTokens, 550)
  assert.equal(report.exactTotalTokens, 2150)
  assert.equal(report.exactCacheReadTokens, 300)
  assert.equal(report.exactReasoningTokens, 100)
  assert.equal(report.totalToolCalls, 4)
  assert.equal(report.tokensPerCompletedTask, 1075) // 2150 / 2
  assert.equal(report.peakConcurrentWorkers, 2)

  // Savings vs baseline: (3000 - 2150) / 3000 = 850 / 3000 = 28.33%
  assert.ok(report.savingsVsBaseline !== undefined)
  assert.equal(report.savingsVsBaseline.reductionTokens, 850)
  assert.equal(report.savingsVsBaseline.reductionPercentage, 28.33)

  // Per-agent breakdown verified
  const coder = report.agents.find((a) => a.agentName === 'coder')
  assert.equal(coder.exactTotalTokens, 1400)
  assert.equal(coder.toolCallsCount, 2)

  // Limitations noted
  assert.equal(report.measurementLimitations.length, 1)
  assert.match(report.measurementLimitations[0], /1 invocation\(s\) lacked authoritative usage/)
})

test('exportReportToCsv and saveTeamTokenReport produces valid file outputs', async () => {
  const { root, cleanup } = makeTempState()
  try {
    const team = {
      id: 'team-csv',
      name: 'CSV Export Team',
      createdAt: 1000,
      operatingMode: 'normal',
      captainSessionId: 'sess-c',
      members: [],
      tasks: [],
    }
    const report = generateTeamTokenReport(team, {
      schemaVersion: 1,
      teamId: 'team-csv',
      events: [],
      deduplicatedKeys: [],
    })

    const csv = exportReportToCsv(report)
    assert.match(csv, /# TEAM RUN SUMMARY/)
    assert.match(csv, /"team-csv"/)

    const paths = await saveTeamTokenReport(root, 'team-csv', report)
    assert.ok(existsSync(paths.jsonPath))
    assert.ok(existsSync(paths.csvPath))

    const readJson = JSON.parse(readFileSync(paths.jsonPath, 'utf8'))
    assert.equal(readJson.teamId, 'team-csv')
  } finally {
    cleanup()
  }
})
