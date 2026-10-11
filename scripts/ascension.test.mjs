import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectCompletedDependencyOutputs,
  formatDependencyOutputs,
  assignmentPrompt,
  ECONOMY_DEPENDENCY_OUTPUT_MAX_CHARS,
  ECONOMY_DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS,
} from '../lib/scheduler.js'
import { memberWelcome } from '../lib/members.js'
import {
  readTokenLedger,
  recordTokenUsageEvent,
  generateTeamTokenReport,
  exportReportToCsv,
  saveTeamTokenReport,
} from '../lib/token-accounting.js'

test('Ascension: Operating Mode Prompt & Welcome Compression', async (t) => {
  await t.test('memberWelcome returns concise prompt in economy mode', () => {
    const normalTeam = { id: 'team-1', name: 'engineering-team', tasks: [], operatingMode: 'normal' }
    const economyTeam = { id: 'team-1', name: 'engineering-team', tasks: [], operatingMode: 'economy' }

    const normalWelcome = memberWelcome(normalTeam, 'coder')
    const economyWelcome = memberWelcome(economyTeam, 'coder')

    assert.match(normalWelcome, /You have joined the team/)
    assert.match(economyWelcome, /Joined team "engineering-team" as coder\./)
    assert.ok(economyWelcome.length < normalWelcome.length, 'economy welcome must be shorter than normal welcome')
    assert.ok(economyWelcome.length < 150, 'economy welcome must be under 150 chars')
  })

  await t.test('assignmentPrompt compresses boilerplate in economy mode', () => {
    const normalTicket = {
      taskId: 't-1',
      memberName: 'researcher',
      memberId: 'm-1',
      attempt: 1,
      attemptId: 'att-1',
      subject: 'Analyze memory profile',
      description: 'Check heap allocations and identify bottlenecks',
      kind: 'work',
      dependencyOutputs: [],
      operatingMode: 'normal',
    }
    const economyTicket = {
      ...normalTicket,
      operatingMode: 'economy',
    }

    const normalPrompt = assignmentPrompt(normalTicket, '.agent-teams', 'team-1', [])
    const economyPrompt = assignmentPrompt(economyTicket, '.agent-teams', 'team-1', [])

    assert.ok(economyPrompt.length < normalPrompt.length, 'economy prompt must be shorter than normal prompt')
    assert.match(economyPrompt, /Task: t-1 — Analyze memory profile/)
    assert.match(economyPrompt, /Check heap allocations/)
    // Verify standard repetitive guidance is omitted in economy mode
    assert.doesNotMatch(economyPrompt, /Instructions for executing this task:/)
    assert.doesNotMatch(economyPrompt, /Do not guess or simulate tests/)
  })
})

test('Ascension: Transitive Dependency Pruning & Bounded Delivery', async (t) => {
  const largeOutputA = 'A'.repeat(2000)
  const largeOutputB = 'B'.repeat(2000)
  const largeOutputC = 'C'.repeat(2000)

  // DAG: taskA -> taskB -> taskC -> targetTask
  // targetTask depends directly on taskC. taskA and taskB are indirect transitive ancestors.
  const tasks = [
    { id: 'taskA', subject: 'Architecture design', status: 'completed', output: largeOutputA, dependencies: [] },
    { id: 'taskB', subject: 'Core implementation', status: 'completed', output: largeOutputB, dependencies: ['taskA'] },
    { id: 'taskC', subject: 'Verification tests', status: 'completed', output: largeOutputC, dependencies: ['taskB'] },
    { id: 'targetTask', subject: 'Release build', status: 'pending', dependencies: ['taskC'] },
  ]

  await t.test('Normal mode retains ancestor outputs with normal capping', () => {
    const outputs = collectCompletedDependencyOutputs(tasks, 'targetTask', () => {}, 'normal')
    assert.equal(outputs.length, 3)
    const directC = outputs.find(o => o.id === 'taskC')
    const indirectA = outputs.find(o => o.id === 'taskA')
    assert.ok(directC?.direct)
    assert.ok(!indirectA?.direct)
    // In normal mode, ancestors are included up to normal bounds
    assert.ok((indirectA?.output?.length ?? 0) > 100)
  })

  await t.test('Economy mode truncates transitive ancestors to compact digests', () => {
    const outputs = collectCompletedDependencyOutputs(tasks, 'targetTask', () => {}, 'economy')
    assert.equal(outputs.length, 3)
    const directC = outputs.find(o => o.id === 'taskC')
    const indirectA = outputs.find(o => o.id === 'taskA')
    const indirectB = outputs.find(o => o.id === 'taskB')

    assert.ok(directC?.direct)
    assert.ok(!indirectA?.direct)
    assert.ok(!indirectB?.direct)

    // Transitive ancestors must be compacted to ~100-char summaries
    assert.ok((indirectA?.output?.length ?? 0) <= 170)
    assert.ok((indirectB?.output?.length ?? 0) <= 170)

    const formatted = formatDependencyOutputs(outputs, 'economy')
    assert.match(formatted, /\(indirect prerequisite\)/)
    assert.ok(formatted.length < ECONOMY_DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS)
  })
})

test('Ascension: Token Budget Hard Stops and Telemetry Accounting', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'ascension-budget-test-'))
  const stateRoot = join(tmp, '.agent-teams')
  const teamId = 'ascension-budget-team'

  try {
    const ledger = await readTokenLedger(stateRoot, teamId)
    assert.equal(ledger.events.length, 0)

    // Record invocation 1
    const ev1 = {
      id: 's1:1:1',
      teamId,
      agentId: 'captain-session',
      agentName: 'captain',
      role: 'captain',
      sessionId: 's1',
      provider: 'test-prov',
      model: 'test-model',
      turn: 1,
      step: 1,
      timestamp: Date.now(),
      durationMs: 50,
      outcome: 'completed',
      quality: 'exact',
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      reasoningTokens: 50,
      toolCallsCount: 2,
      operatingMode: 'economy',
      isRetry: false,
    }

    const { recorded: r1 } = await recordTokenUsageEvent(stateRoot, teamId, ev1)
    assert.ok(r1)

    // Record duplicate event - must be deduplicated
    const { recorded: rDup, duplicate } = await recordTokenUsageEvent(stateRoot, teamId, ev1)
    assert.ok(!rDup)
    assert.ok(duplicate)

    // Record invocation 2
    const ev2 = {
      ...ev1,
      id: 's2:1:1',
      agentId: 'member-session',
      agentName: 'coder',
      role: 'engineer',
      sessionId: 's2',
      turn: 1,
      step: 2,
      totalTokens: 3000,
      inputTokens: 2500,
      outputTokens: 500,
    }
    const { recorded: r2 } = await recordTokenUsageEvent(stateRoot, teamId, ev2)
    assert.ok(r2)

    const updatedLedger = await readTokenLedger(stateRoot, teamId)
    assert.equal(updatedLedger.events.length, 2)
    assert.equal(updatedLedger.deduplicatedKeys.length, 2)

    // Generate report
    const dummyTeam = {
      id: teamId,
      name: 'Budget Team',
      captainSessionId: 's1',
      createdAt: Date.now() - 5000,
      operatingMode: 'economy',
      tokenBudget: 4000,
      members: [
        { id: 's2', name: 'coder', role: 'engineer', provider: 'test-prov', model: 'test-model', status: 'idle' },
      ],
      tasks: [
        { id: 'task-1', subject: 'Implement feature', status: 'completed', assignee: 'coder', dependencies: [] },
      ],
      taskSeq: 1,
    }

    const report = generateTeamTokenReport(dummyTeam, updatedLedger)
    assert.equal(report.exactTotalTokens, 4200) // 1200 + 3000
    assert.equal(report.exactInputTokens, 3500) // 1000 + 2500
    assert.equal(report.exactOutputTokens, 700)  // 200 + 500
    assert.equal(report.totalInvocations, 2)
    assert.equal(report.exactCoveragePercentage, 100)
    assert.equal(report.agents.length, 2)
    assert.equal(report.tasks.length, 1)

    // Save report and export CSV
    await saveTeamTokenReport(stateRoot, teamId, report)
    const csv = exportReportToCsv(report)
    assert.match(csv, /TEAM RUN SUMMARY/)
    assert.match(csv, /4200/)
    assert.match(csv, /PER-AGENT BREAKDOWN/)
    assert.match(csv, /coder/)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
})
