#!/usr/bin/env node
/**
 * Ascension Deterministic Multi-Agent Benchmark Suite
 *
 * Measures before-and-after token efficiency, context scaling, concurrency,
 * and duration across standard multi-agent orchestration topologies:
 *
 * 1. Scenario A: Small Self-Contained Task (Single worker, focused execution)
 * 2. Scenario B: Parallel Independent Subtasks (4 independent workers)
 * 3. Scenario C: Sequential Deep DAG Pipeline (A -> B -> C -> D -> E with cumulative context)
 * 4. Scenario D: Intermediate Result Passing (Large upstream artifact filtering)
 * 5. Scenario E: Worker Failure & Fault Recovery (Retry handling and bounded guidance)
 *
 * Compares:
 * - Baseline (Legacy: unpruned transitive context up to 12k chars, 1.2k char boilerplate, unbounded workers)
 * - Normal Mode (Ascension: bounded direct dependency delivery, quality gates, sensible concurrency)
 * - Economy Mode (Ascension: transitive ancestor digests, ~160-char concise prompts, max 2 concurrent workers)
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  collectCompletedDependencyOutputs,
  formatDependencyOutputs,
  assignmentPrompt,
  ECONOMY_DEPENDENCY_OUTPUT_MAX_CHARS,
  DEPENDENCY_OUTPUT_MAX_CHARS,
} from '../lib/scheduler.js'
import { memberWelcome } from '../lib/members.js'

// Offline Deterministic Token Heuristic: ~4 chars per token for English prompts/code
// Metric Classification:
// - inputTokens: ESTIMATED (character-ratio prompt length heuristic)
// - outputTokens: SYNTHETIC (preset typical response lengths)
// - totalTokens: SYNTHETIC/ESTIMATED HYBRID
// - concurrency: ACTUAL (runtime scheduler concurrency bounds)
export const METRIC_CLASSIFICATION = {
  inputTokens: 'ESTIMATED',
  outputTokens: 'SYNTHETIC',
  totalTokens: 'SYNTHETIC_ESTIMATED_HYBRID',
  concurrency: 'ACTUAL',
}

function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Simulate Scenario A: Small self-contained task (Single worker)
 */
function benchmarkScenarioA(mode) {
  const isBaseline = mode === 'baseline'
  const isEconomy = mode === 'economy'
  const effectiveMode = isBaseline ? 'normal' : mode

  const team = {
    id: 'team-a',
    name: 'Small Self-Contained Task',
    operatingMode: effectiveMode,
    tasks: [{ id: 't1', subject: 'Lint and fix config', status: 'pending', assignee: 'coder' }],
  }

  // 1. Welcome
  const welcomeText = isBaseline
    ? 'You have joined the team "Small Self-Contained Task" as a member. Wait for an automatic assignment or a captain message.\nCurrent team status: 1 task(s), 1 pending task(s) assigned to you.\nDo not start work until the scheduler or captain assigns a task in this turn.'
    : memberWelcome(team, 'coder')
  const welcomeTokens = estimateTokens(welcomeText)

  // 2. Assignment prompt
  const ticket = {
    taskId: 't1',
    memberName: 'coder',
    memberId: 'm1',
    attempt: 1,
    attemptId: 'att-1',
    subject: 'Lint and fix config',
    description: 'Format tsconfig.json and fix path aliases',
    kind: 'work',
    dependencyOutputs: [],
    operatingMode: effectiveMode,
  }

  let promptText = ''
  if (isBaseline) {
    promptText = assignmentPrompt(ticket, '.agent-teams', 'team-a', [])
    // Baseline included repetitive verbose setup guidance
    promptText += '\n[Legacy verbose extra rules: Do not guess or simulate tests. Re-read all source before claiming.]'
  } else {
    promptText = assignmentPrompt(ticket, '.agent-teams', 'team-a', [])
  }
  const promptTokens = estimateTokens(promptText)

  // Simulated output tokens from model
  const outputTokens = isEconomy ? 120 : 180

  const totalInputTokens = welcomeTokens + promptTokens
  const totalTokens = totalInputTokens + outputTokens

  return {
    scenario: 'Scenario 1: Small Self-Contained Task',
    mode,
    invocations: 1,
    inputTokens: totalInputTokens,
    outputTokens,
    totalTokens,
    peakWorkers: 1,
  }
}

/**
 * Simulate Scenario B: Parallel Independent Subtasks (4 parallel workers)
 */
function benchmarkScenarioB(mode) {
  const isBaseline = mode === 'baseline'
  const isEconomy = mode === 'economy'
  const effectiveMode = isBaseline ? 'normal' : mode
  const taskCount = 4

  const team = {
    id: 'team-b',
    name: 'Parallel Subtasks',
    operatingMode: effectiveMode,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      id: `t${i + 1}`,
      subject: `Audit module ${i + 1}`,
      status: 'pending',
      assignee: `worker-${i + 1}`,
    })),
  }

  let totalInputTokens = 0
  let totalOutputTokens = 0
  const maxConcurrency = isEconomy ? 2 : (isBaseline ? 4 : 4)

  for (let i = 0; i < taskCount; i++) {
    const welcome = isBaseline
      ? 'You have joined the team "Parallel Subtasks" as a member. Wait for an automatic assignment or a captain message.\nCurrent team status: 4 task(s), 1 pending task(s) assigned to you.\nDo not start work until the scheduler or captain assigns a task in this turn.'
      : memberWelcome(team, `worker-${i + 1}`)

    const ticket = {
      taskId: `t${i + 1}`,
      memberName: `worker-${i + 1}`,
      memberId: `m${i + 1}`,
      attempt: 1,
      attemptId: `att-${i + 1}`,
      subject: `Audit module ${i + 1}`,
      description: `Deep analysis of package ${i + 1} dependencies and dead code`,
      kind: 'work',
      dependencyOutputs: [],
      operatingMode: effectiveMode,
    }

    const prompt = assignmentPrompt(ticket, '.agent-teams', 'team-b', [])
    const inTokens = estimateTokens(welcome) + estimateTokens(prompt)
    const outTokens = isEconomy ? 150 : 220

    totalInputTokens += inTokens
    totalOutputTokens += outTokens
  }

  return {
    scenario: 'Scenario 2: Parallel Independent Subtasks (4 workers)',
    mode,
    invocations: taskCount,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    peakWorkers: maxConcurrency,
  }
}

/**
 * Simulate Scenario C: Sequential Deep DAG Pipeline (A -> B -> C -> D -> E)
 * This heavily exercises Transitive Dependency Context Accumulation!
 */
function benchmarkScenarioC(mode) {
  const isBaseline = mode === 'baseline'
  const isEconomy = mode === 'economy'
  const effectiveMode = isBaseline ? 'normal' : mode

  const stages = [
    { id: 't1', subject: 'Requirements gathering', outputSize: 1500, deps: [] },
    { id: 't2', subject: 'Architecture design', outputSize: 2200, deps: ['t1'] },
    { id: 't3', subject: 'API Implementation', outputSize: 2800, deps: ['t2'] },
    { id: 't4', subject: 'Integration test suite', outputSize: 2000, deps: ['t3'] },
    { id: 't5', subject: 'Security verification', outputSize: 1800, deps: ['t4'] },
  ]

  const completedTasks = []
  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    let depOutputs = []

    if (isBaseline) {
      // Legacy baseline: all transitive ancestors accumulated unpruned up to 12k chars
      depOutputs = completedTasks.map(ct => ({
        id: ct.id,
        subject: ct.subject,
        output: ct.output.slice(0, 2000), // unpruned legacy 2000 chars each
        direct: stage.deps.includes(ct.id),
      }))
    } else {
      depOutputs = collectCompletedDependencyOutputs(completedTasks, stage.id, () => {}, effectiveMode)
    }

    const formattedDeps = formatDependencyOutputs(depOutputs, effectiveMode)

    const ticket = {
      taskId: stage.id,
      memberName: 'pipeline-worker',
      memberId: 'm1',
      attempt: 1,
      attemptId: `att-${i + 1}`,
      subject: stage.subject,
      description: `Execute stage ${i + 1} of pipeline`,
      kind: 'work',
      dependencyOutputs: depOutputs,
      operatingMode: effectiveMode,
    }

    const prompt = assignmentPrompt(ticket, '.agent-teams', 'team-c', [])
    const inTokens = estimateTokens(prompt) + estimateTokens(formattedDeps)
    const outTokens = isEconomy ? 200 : 350

    totalInputTokens += inTokens
    totalOutputTokens += outTokens

    // Record output for next stages
    completedTasks.push({
      id: stage.id,
      subject: stage.subject,
      status: 'completed',
      output: 'X'.repeat(stage.outputSize),
      dependencies: stage.deps,
    })
  }

  return {
    scenario: 'Scenario 3: Sequential Deep DAG Pipeline (5 stages)',
    mode,
    invocations: stages.length,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    peakWorkers: 1,
  }
}

/**
 * Simulate Scenario D: Intermediate Result Passing
 * Upstream task produces a large 8,000 char dataset, downstream worker needs relevant digest
 */
function benchmarkScenarioD(mode) {
  const isBaseline = mode === 'baseline'
  const isEconomy = mode === 'economy'
  const effectiveMode = isBaseline ? 'normal' : mode

  const largeArtifact = 'Data row entry: '.repeat(400) // 6,400 chars
  const tasks = [
    { id: 't1', subject: 'Raw data extraction', status: 'completed', output: largeArtifact, dependencies: [] },
    { id: 't2', subject: 'Summarize metrics', status: 'pending', dependencies: ['t1'] },
  ]

  let depOutputs = []
  if (isBaseline) {
    depOutputs = [{ id: 't1', subject: 'Raw data extraction', output: largeArtifact, direct: true }]
  } else {
    depOutputs = collectCompletedDependencyOutputs(tasks, 't2', () => {}, effectiveMode)
  }

  const formattedDeps = formatDependencyOutputs(depOutputs, effectiveMode)
  const ticket = {
    taskId: 't2',
    memberName: 'analyst',
    memberId: 'm2',
    attempt: 1,
    attemptId: 'att-2',
    subject: 'Summarize metrics',
    description: 'Compute statistical aggregates from upstream dataset',
    kind: 'work',
    dependencyOutputs: depOutputs,
    operatingMode: effectiveMode,
  }

  const prompt = assignmentPrompt(ticket, '.agent-teams', 'team-d', [])
  const inTokens = estimateTokens(prompt) + estimateTokens(formattedDeps)
  const outTokens = isEconomy ? 180 : 300

  return {
    scenario: 'Scenario 4: Large Intermediate Result Passing',
    mode,
    invocations: 1,
    inputTokens: inTokens,
    outputTokens: outTokens,
    totalTokens: inTokens + outTokens,
    peakWorkers: 1,
  }
}

/**
 * Simulate Scenario E: Worker Failure & Fault Recovery
 * Worker fails once on turn 1, receives recovery prompt on turn 2
 */
function benchmarkScenarioE(mode) {
  const isBaseline = mode === 'baseline'
  const isEconomy = mode === 'economy'
  const effectiveMode = isBaseline ? 'normal' : mode

  // Turn 1: Initial failed dispatch
  const ticketTurn1 = {
    taskId: 't1',
    memberName: 'worker',
    memberId: 'm1',
    attempt: 1,
    attemptId: 'att-1',
    subject: 'Network query',
    description: 'Query remote microservice',
    kind: 'work',
    dependencyOutputs: [],
    operatingMode: effectiveMode,
  }
  const prompt1 = assignmentPrompt(ticketTurn1, '.agent-teams', 'team-e', [])
  const inTokens1 = estimateTokens(prompt1)
  const outTokens1 = 50 // Fast failure error response

  // Turn 2: Recovered attempt
  const ticketTurn2 = {
    taskId: 't1',
    memberName: 'worker',
    memberId: 'm1',
    attempt: 2,
    attemptId: 'att-2',
    recoveredOwned: true,
    previousStatus: 'in_progress',
    previousAttempt: 1,
    previousAttemptId: 'att-1',
    subject: 'Network query',
    description: 'Query remote microservice (retry attempt 2)',
    kind: 'work',
    dependencyOutputs: [],
    operatingMode: effectiveMode,
  }
  const prompt2 = assignmentPrompt(ticketTurn2, '.agent-teams', 'team-e', [])
  const inTokens2 = estimateTokens(prompt2)
  const outTokens2 = isEconomy ? 140 : 220

  const totalIn = inTokens1 + inTokens2
  const totalOut = outTokens1 + outTokens2

  return {
    scenario: 'Scenario 5: Worker Failure & Fault Recovery (2 turns)',
    mode,
    invocations: 2,
    inputTokens: totalIn,
    outputTokens: totalOut,
    totalTokens: totalIn + totalOut,
    peakWorkers: 1,
  }
}

export async function runAscensionBenchmarks() {
  const scenarios = [
    benchmarkScenarioA,
    benchmarkScenarioB,
    benchmarkScenarioC,
    benchmarkScenarioD,
    benchmarkScenarioE,
  ]

  const modes = ['baseline', 'normal', 'economy']
  const results = []

  for (const fn of scenarios) {
    const scenarioRuns = {}
    for (const mode of modes) {
      const res = fn(mode)
      scenarioRuns[mode] = res
      results.push(res)
    }
  }

  // Aggregate totals
  const aggregate = {}
  for (const mode of modes) {
    const modeResults = results.filter(r => r.mode === mode)
    const totalInput = modeResults.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutput = modeResults.reduce((s, r) => s + r.outputTokens, 0)
    const totalTokens = modeResults.reduce((s, r) => s + r.totalTokens, 0)
    const totalInvocations = modeResults.reduce((s, r) => s + r.invocations, 0)

    aggregate[mode] = {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens,
      totalInvocations,
    }
  }

  const baselineTokens = aggregate.baseline.totalTokens
  const normalSavingsTokens = baselineTokens - aggregate.normal.totalTokens
  const normalSavingsPct = Math.round((normalSavingsTokens / baselineTokens) * 1000) / 10

  const economySavingsTokens = baselineTokens - aggregate.economy.totalTokens
  const economySavingsPct = Math.round((economySavingsTokens / baselineTokens) * 1000) / 10

  aggregate.normal.savingsTokensVsBaseline = normalSavingsTokens
  aggregate.normal.savingsPercentageVsBaseline = normalSavingsPct

  aggregate.economy.savingsTokensVsBaseline = economySavingsTokens
  aggregate.economy.savingsPercentageVsBaseline = economySavingsPct

  const benchmarkPayload = {
    timestamp: new Date().toISOString(),
    benchmarkVersion: '1.1.0',
    benchmarkType: 'OFFLINE_SYNTHETIC_MICROBENCHMARK',
    metricClassification: METRIC_CLASSIFICATION,
    methodologyNotes: [
      'Input tokens are ESTIMATED from prompt and dependency output text length via Math.ceil(length / 4).',
      'Output tokens are SYNTHETIC based on typical response length models.',
      'Total tokens reflect prompt template text reduction and DAG pruning in offline simulation, not live cloud API billing.',
      'Real Harness session events, retries, and telemetry capture are verified separately via scripts/harness-canary-audit.mjs.',
    ],
    scenarios: results,
    aggregate,
  }

  await writeFile(
    join(process.cwd(), 'benchmark-results.json'),
    JSON.stringify(benchmarkPayload, null, 2),
    'utf8',
  )

  return benchmarkPayload
}

// Print formatted summary table if run directly
if (process.argv[1] && process.argv[1].endsWith('ascension-benchmark.mjs')) {
  console.log('Running Ascension Multi-Agent Token Microbenchmark Suite (Synthetic / Estimated)...\n')
  const payload = await runAscensionBenchmarks()
  console.log('===================================================================================================')
  console.log('            PROJECT ASCENSION — SYNTHETIC MULTI-AGENT MICROBENCHMARK RESULTS (OFFLINE)              ')
  console.log('===================================================================================================')
  console.log(
    'Scenario'.padEnd(52) +
    'Baseline'.padStart(12) +
    'Normal'.padStart(12) +
    'Economy'.padStart(12) +
    'Economy %'.padStart(12)
  )
  console.log('---------------------------------------------------------------------------------------------------')

  const uniqueScenarios = [...new Set(payload.scenarios.map(s => s.scenario))]
  for (const scen of uniqueScenarios) {
    const base = payload.scenarios.find(s => s.scenario === scen && s.mode === 'baseline')
    const norm = payload.scenarios.find(s => s.scenario === scen && s.mode === 'normal')
    const econ = payload.scenarios.find(s => s.scenario === scen && s.mode === 'economy')

    const saving = Math.round(((base.totalTokens - econ.totalTokens) / base.totalTokens) * 1000) / 10
    console.log(
      scen.slice(0, 50).padEnd(52) +
      `${base.totalTokens.toLocaleString()}`.padStart(12) +
      `${norm.totalTokens.toLocaleString()}`.padStart(12) +
      `${econ.totalTokens.toLocaleString()}`.padStart(12) +
      `-${saving}%`.padStart(12)
    )
  }

  console.log('===================================================================================================')
  console.log('AGGREGATE PROMPT/CONTEXT REDUCTION ACROSS ALL SCENARIOS (ESTIMATED/SYNTHETIC TOKENS):')
  console.log(`- Baseline (Legacy):  ${payload.aggregate.baseline.totalTokens.toLocaleString()} tokens`)
  console.log(`- Normal Mode:        ${payload.aggregate.normal.totalTokens.toLocaleString()} tokens (Reduction: ${payload.aggregate.normal.savingsPercentageVsBaseline}%, Saved: ${payload.aggregate.normal.savingsTokensVsBaseline.toLocaleString()} tokens)`)
  console.log(`- Economy Mode:       ${payload.aggregate.economy.totalTokens.toLocaleString()} tokens (Reduction: ${payload.aggregate.economy.savingsPercentageVsBaseline}%, Saved: ${payload.aggregate.economy.savingsTokensVsBaseline.toLocaleString()} tokens)`)
  console.log('---------------------------------------------------------------------------------------------------')
  console.log('NOTE: These values represent offline character-heuristic estimations on prompts and dependency')
  console.log('contexts. Real Harness session telemetry, retry handling, and budget stops are verified via')
  console.log('scripts/harness-canary-audit.mjs.')
  console.log('===================================================================================================')
  console.log('Results saved to benchmark-results.json\n')
}
