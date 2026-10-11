/**
 * Authoritative Token Accounting and Cost Telemetry for AgentTeams.
 *
 * Captures, verifies, deduplicates and persists exact token usage metrics
 * from Harness/provider response telemetry, strictly distinguishing actual,
 * estimated, and unknown usage.
 *
 * @module dsh-agent-teams/token-accounting
 */

import { join } from 'node:path'
import { readFile, writeFile, unlink, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { TeamMember, TeamState, TeamTask } from './types.ts'
import { replaceFileAtomicOrDirect } from './state.ts'

/** Token usage measurement quality. */
export type TokenUsageQuality = 'exact' | 'estimated' | 'unknown'

/** One atomic invocation usage record in the ledger. */
export interface TokenUsageEvent {
  readonly id: string
  readonly teamId: string
  readonly taskId?: string
  readonly attemptId?: string
  readonly agentId: string
  readonly agentName: string
  readonly role: string
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly turn: number
  readonly step: number
  readonly timestamp: number
  readonly durationMs: number
  readonly outcome: 'completed' | 'failed' | 'interrupted'
  readonly quality: TokenUsageQuality
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly toolCallsCount: number
  readonly operatingMode: 'normal' | 'economy'
  readonly isRetry: boolean
  readonly seq?: number
  readonly errorDetails?: string
}

/** Aggregated usage statistics for one participating agent. */
export interface AgentTokenSummary {
  readonly agentName: string
  readonly role: string
  readonly provider: string
  readonly model: string
  readonly tasksHandled: number
  readonly invocationCount: number
  readonly retriesCount: number
  readonly exactInvocations: number
  readonly estimatedInvocations: number
  readonly unknownInvocations: number
  readonly exactInputTokens: number
  readonly exactOutputTokens: number
  readonly exactTotalTokens: number
  readonly cacheReadTokens: number
  readonly reasoningTokens: number
  readonly estimatedTokens: number
  readonly toolCallsCount: number
  readonly totalDurationMs: number
  readonly outcome: 'active' | 'completed' | 'failed' | 'idle'
}

/** Aggregated usage statistics for one task. */
export interface TaskTokenSummary {
  readonly taskId: string
  readonly subject: string
  readonly owner: string
  readonly status: string
  readonly attemptsCount: number
  readonly invocationCount: number
  readonly exactInputTokens: number
  readonly exactOutputTokens: number
  readonly exactTotalTokens: number
  readonly cacheReadTokens: number
  readonly reasoningTokens: number
  readonly estimatedTokens: number
  readonly durationMs: number
}

/** Complete End-of-Run token accounting report. */
export interface TeamTokenReport {
  readonly schemaVersion: 1
  readonly reportId: string
  readonly teamId: string
  readonly teamName: string
  readonly operatingMode: 'normal' | 'economy'
  readonly createdAt: number
  readonly startedAt: number
  readonly finishedAt: number
  readonly totalDurationMs: number
  readonly finalStatus: 'completed' | 'failed' | 'halted' | 'cancelled' | 'in_progress'
  readonly totalTasks: number
  readonly completedTasks: number
  readonly failedTasks: number
  readonly totalInvocations: number
  readonly exactInvocations: number
  readonly estimatedInvocations: number
  readonly unknownInvocations: number
  readonly exactCoveragePercentage: number
  readonly exactInputTokens: number
  readonly exactOutputTokens: number
  readonly exactTotalTokens: number
  readonly exactCacheReadTokens: number
  readonly exactReasoningTokens: number
  readonly estimatedTokensTotal: number
  readonly totalToolCalls: number
  readonly peakConcurrentWorkers: number
  readonly tokensPerCompletedTask: number
  readonly deduplicatedEventCount: number
  readonly agents: readonly AgentTokenSummary[]
  readonly tasks: readonly TaskTokenSummary[]
  readonly measurementLimitations: readonly string[]
  readonly savingsVsBaseline?: {
    readonly baselineTotalTokens: number
    readonly reductionTokens: number
    readonly reductionPercentage: number
  }
}

/** Durable ledger storing raw usage events. */
export interface TokenLedgerState {
  readonly schemaVersion: 1
  readonly teamId: string
  readonly events: TokenUsageEvent[]
  readonly deduplicatedKeys: string[]
}

const fsPrimitives = {
  rename: async (from: string, to: string) => rename(from, to),
  writeFile: async (file: string, content: string) => writeFile(file, content, 'utf8'),
  remove: async (file: string) => unlink(file).catch(() => undefined),
}

/** Compute stable event key for deduplication. */
export function tokenEventKey(
  sessionId: string,
  turn: number,
  step: number,
  seqOrAttempt?: number | string,
): string {
  return seqOrAttempt !== undefined
    ? `${sessionId}:${turn}:${step}:${seqOrAttempt}`
    : `${sessionId}:${turn}:${step}`
}

/** Load the team's token ledger from disk, returning an empty ledger if absent. */
export async function readTokenLedger(stateRoot: string, teamId: string): Promise<TokenLedgerState> {
  const ledgerPath = join(stateRoot, teamId, 'token-ledger.json')
  try {
    if (!existsSync(ledgerPath)) {
      return { schemaVersion: 1, teamId, events: [], deduplicatedKeys: [] }
    }
    const text = await readFile(ledgerPath, 'utf8')
    const parsed = JSON.parse(text) as TokenLedgerState
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.events)) {
      return parsed
    }
  } catch {
    // Corrupt or partial file heals to a fresh ledger
  }
  return { schemaVersion: 1, teamId, events: [], deduplicatedKeys: [] }
}

/** Persist the token ledger atomically to disk. */
export async function writeTokenLedger(
  stateRoot: string,
  teamId: string,
  ledger: TokenLedgerState,
): Promise<void> {
  const dir = join(stateRoot, teamId)
  await mkdir(dir, { recursive: true })
  const ledgerPath = join(dir, 'token-ledger.json')
  const tempPath = join(dir, `token-ledger.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  const content = JSON.stringify(ledger, null, 2) + '\n'
  await replaceFileAtomicOrDirect(tempPath, ledgerPath, content, fsPrimitives)
}

/** Append an invocation event to the ledger with deduplication. */
export async function recordTokenUsageEvent(
  stateRoot: string,
  teamId: string,
  event: TokenUsageEvent,
): Promise<{ recorded: boolean; duplicate: boolean }> {
  const ledger = await readTokenLedger(stateRoot, teamId)
  const dedupQualifier = event.seq ?? event.attemptId ?? (event.isRetry ? event.timestamp : undefined)
  const key = tokenEventKey(event.sessionId, event.turn, event.step, dedupQualifier)
  const legacyKey = tokenEventKey(event.sessionId, event.turn, event.step)
  if (ledger.deduplicatedKeys.includes(key) || (dedupQualifier === undefined && ledger.deduplicatedKeys.includes(legacyKey))) {
    return { recorded: false, duplicate: true }
  }
  ledger.events.push(event)
  ledger.deduplicatedKeys.push(key)
  await writeTokenLedger(stateRoot, teamId, ledger)
  return { recorded: true, duplicate: false }
}

/** Extract exact TokenUsage from an adapter response payload or normalize missing usage. */
export function normalizeTokenUsage(rawUsage?: TokenUsage): {
  quality: TokenUsageQuality
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
} {
  if (rawUsage === undefined || typeof rawUsage !== 'object') {
    return {
      quality: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    }
  }

  const inputTokens = Math.max(0, Number(rawUsage.inputTokens) || 0)
  const outputTokens = Math.max(0, Number(rawUsage.outputTokens) || 0)
  const cacheReadTokens = Math.max(0, Number(rawUsage.cacheReadTokens) || 0)
  const cacheWriteTokens = Math.max(0, Number(rawUsage.cacheWriteTokens) || 0)
  const reasoningTokens = Math.max(0, Number(rawUsage.reasoningTokens) || 0)
  const rawTotal = rawUsage.totalTokens !== undefined ? Number(rawUsage.totalTokens) : undefined
  const totalTokens = rawTotal !== undefined && !Number.isNaN(rawTotal)
    ? Math.max(0, rawTotal)
    : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens

  return {
    quality: 'exact',
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  }
}

/**
 * Generate an aggregated End-of-Run report from the ledger and team state.
 * Strictly ordinary program logic: NO LLM requests are invoked.
 */
export function generateTeamTokenReport(
  team: TeamState,
  ledger: TokenLedgerState,
  options?: {
    baselineTotalTokens?: number
    peakConcurrentWorkers?: number
  },
): TeamTokenReport {
  const events = ledger.events
  let exactInvocations = 0
  let estimatedInvocations = 0
  let unknownInvocations = 0
  let exactInputTokens = 0
  let exactOutputTokens = 0
  let exactTotalTokens = 0
  let exactCacheReadTokens = 0
  let exactReasoningTokens = 0
  let estimatedTokensTotal = 0
  let totalToolCalls = 0

  const agentMap = new Map<string, {
    name: string
    role: string
    provider: string
    model: string
    tasks: Set<string>
    invocations: number
    retries: number
    exactInv: number
    estInv: number
    unkInv: number
    input: number
    output: number
    total: number
    cache: number
    reasoning: number
    estimated: number
    toolCalls: number
    durationMs: number
  }>()

  // Initialize captain entry
  agentMap.set('captain', {
    name: 'captain',
    role: 'captain',
    provider: team.members[0]?.provider ?? 'captain',
    model: team.members[0]?.model ?? 'captain',
    tasks: new Set(),
    invocations: 0,
    retries: 0,
    exactInv: 0,
    estInv: 0,
    unkInv: 0,
    input: 0,
    output: 0,
    total: 0,
    cache: 0,
    reasoning: 0,
    estimated: 0,
    toolCalls: 0,
    durationMs: 0,
  })

  // Initialize member entries
  for (const m of team.members) {
    agentMap.set(m.name, {
      name: m.name,
      role: m.role ?? 'worker',
      provider: m.activeProvider ?? m.provider ?? 'unknown',
      model: m.activeModel ?? m.model ?? 'unknown',
      tasks: new Set(),
      invocations: 0,
      retries: 0,
      exactInv: 0,
      estInv: 0,
      unkInv: 0,
      input: 0,
      output: 0,
      total: 0,
      cache: 0,
      reasoning: 0,
      estimated: 0,
      toolCalls: 0,
      durationMs: 0,
    })
  }

  const taskMap = new Map<string, {
    task: TeamTask
    invocations: number
    attempts: number
    input: number
    output: number
    total: number
    cache: number
    reasoning: number
    estimated: number
    durationMs: number
  }>()

  for (const t of team.tasks) {
    taskMap.set(t.id, {
      task: t,
      invocations: 0,
      attempts: t.attempt ?? 1,
      input: 0,
      output: 0,
      total: 0,
      cache: 0,
      reasoning: 0,
      estimated: 0,
      durationMs: 0,
    })
  }

  for (const ev of events) {
    totalToolCalls += ev.toolCallsCount

    if (ev.quality === 'exact') {
      exactInvocations += 1
      exactInputTokens += ev.inputTokens
      exactOutputTokens += ev.outputTokens
      exactTotalTokens += ev.totalTokens
      exactCacheReadTokens += ev.cacheReadTokens
      exactReasoningTokens += ev.reasoningTokens
    } else if (ev.quality === 'estimated') {
      estimatedInvocations += 1
      estimatedTokensTotal += ev.totalTokens
    } else {
      unknownInvocations += 1
    }

    // Agent aggregation
    let agentSummary = agentMap.get(ev.agentName)
    if (agentSummary === undefined) {
      agentSummary = {
        name: ev.agentName,
        role: ev.role,
        provider: ev.provider,
        model: ev.model,
        tasks: new Set(),
        invocations: 0,
        retries: 0,
        exactInv: 0,
        estInv: 0,
        unkInv: 0,
        input: 0,
        output: 0,
        total: 0,
        cache: 0,
        reasoning: 0,
        estimated: 0,
        toolCalls: 0,
        durationMs: 0,
      }
      agentMap.set(ev.agentName, agentSummary)
    }

    agentSummary.invocations += 1
    if (ev.isRetry) agentSummary.retries += 1
    agentSummary.durationMs += ev.durationMs
    agentSummary.toolCalls += ev.toolCallsCount
    if (ev.taskId) agentSummary.tasks.add(ev.taskId)

    if (ev.quality === 'exact') {
      agentSummary.exactInv += 1
      agentSummary.input += ev.inputTokens
      agentSummary.output += ev.outputTokens
      agentSummary.total += ev.totalTokens
      agentSummary.cache += ev.cacheReadTokens
      agentSummary.reasoning += ev.reasoningTokens
    } else if (ev.quality === 'estimated') {
      agentSummary.estInv += 1
      agentSummary.estimated += ev.totalTokens
    } else {
      agentSummary.unkInv += 1
    }

    // Task aggregation
    if (ev.taskId && taskMap.has(ev.taskId)) {
      const taskSummary = taskMap.get(ev.taskId)!
      taskSummary.invocations += 1
      taskSummary.durationMs += ev.durationMs
      if (ev.quality === 'exact') {
        taskSummary.input += ev.inputTokens
        taskSummary.output += ev.outputTokens
        taskSummary.total += ev.totalTokens
        taskSummary.cache += ev.cacheReadTokens
        taskSummary.reasoning += ev.reasoningTokens
      } else if (ev.quality === 'estimated') {
        taskSummary.estimated += ev.totalTokens
      }
    }
  }

  const totalInvocations = events.length
  const exactCoveragePercentage = totalInvocations > 0
    ? Math.round((exactInvocations / totalInvocations) * 10000) / 100
    : 100

  const completedTasks = team.tasks.filter((t) => t.status === 'completed').length
  const failedTasks = team.tasks.filter((t) => t.status === 'failed').length
  const tokensPerCompletedTask = completedTasks > 0
    ? Math.round(exactTotalTokens / completedTasks)
    : 0

  const agentSummaries: AgentTokenSummary[] = Array.from(agentMap.values()).map((a) => {
    const mem = team.members.find((m) => m.name === a.name)
    const outcome = a.name === 'captain'
      ? 'completed'
      : mem?.status === 'working' ? 'active' : mem?.status === 'removed' ? 'failed' : 'completed'
    return {
      agentName: a.name,
      role: a.role,
      provider: a.provider,
      model: a.model,
      tasksHandled: a.tasks.size,
      invocationCount: a.invocations,
      retriesCount: a.retries,
      exactInvocations: a.exactInv,
      estimatedInvocations: a.estInv,
      unknownInvocations: a.unkInv,
      exactInputTokens: a.input,
      exactOutputTokens: a.output,
      exactTotalTokens: a.total,
      cacheReadTokens: a.cache,
      reasoningTokens: a.reasoning,
      estimatedTokens: a.estimated,
      toolCallsCount: a.toolCalls,
      totalDurationMs: a.durationMs,
      outcome,
    }
  })

  const taskSummaries: TaskTokenSummary[] = Array.from(taskMap.values()).map((ts) => ({
    taskId: ts.task.id,
    subject: ts.task.subject,
    owner: ts.task.assignee ?? '(unassigned)',
    status: ts.task.status,
    attemptsCount: ts.task.attempt ?? 1,
    invocationCount: ts.invocations,
    exactInputTokens: ts.input,
    exactOutputTokens: ts.output,
    exactTotalTokens: ts.total,
    cacheReadTokens: ts.cache,
    reasoningTokens: ts.reasoning,
    estimatedTokens: ts.estimated,
    durationMs: ts.durationMs,
  }))

  const limitations: string[] = []
  if (unknownInvocations > 0) {
    limitations.push(`${unknownInvocations} invocation(s) lacked authoritative usage telemetry from the provider response.`)
  }
  if (estimatedInvocations > 0) {
    limitations.push(`${estimatedInvocations} invocation(s) used estimated counts instead of provider response metadata.`)
  }
  if (team.budgetExceeded === true && unknownInvocations > 0) {
    limitations.push('Budget tracking is based on partial telemetry because some invocations lacked token counters.')
  }

  let finalStatus: TeamTokenReport['finalStatus'] = 'in_progress'
  if (team.halted === true) finalStatus = 'halted'
  else if (failedTasks > 0 && completedTasks + failedTasks === team.tasks.length) finalStatus = 'failed'
  else if (completedTasks === team.tasks.length && team.tasks.length > 0) finalStatus = 'completed'

  let savingsVsBaseline: TeamTokenReport['savingsVsBaseline'] | undefined
  if (options?.baselineTotalTokens !== undefined && options.baselineTotalTokens > 0) {
    const reduction = options.baselineTotalTokens - exactTotalTokens
    const percentage = Math.round((reduction / options.baselineTotalTokens) * 10000) / 100
    savingsVsBaseline = {
      baselineTotalTokens: options.baselineTotalTokens,
      reductionTokens: reduction,
      reductionPercentage: percentage,
    }
  }

  const startedAt = events.length > 0 ? events[0]!.timestamp : team.createdAt
  const finishedAt = events.length > 0 ? events[events.length - 1]!.timestamp : Date.now()

  return {
    schemaVersion: 1,
    reportId: `report-${team.id}-${Date.now()}`,
    teamId: team.id,
    teamName: team.name,
    operatingMode: (team as { operatingMode?: 'normal' | 'economy' }).operatingMode ?? 'normal',
    createdAt: Date.now(),
    startedAt,
    finishedAt,
    totalDurationMs: Math.max(0, finishedAt - startedAt),
    finalStatus,
    totalTasks: team.tasks.length,
    completedTasks,
    failedTasks,
    totalInvocations,
    exactInvocations,
    estimatedInvocations,
    unknownInvocations,
    exactCoveragePercentage,
    exactInputTokens,
    exactOutputTokens,
    exactTotalTokens,
    exactCacheReadTokens,
    exactReasoningTokens,
    estimatedTokensTotal,
    totalToolCalls,
    peakConcurrentWorkers: options?.peakConcurrentWorkers ?? 1,
    tokensPerCompletedTask,
    deduplicatedEventCount: ledger.deduplicatedKeys.length,
    agents: agentSummaries,
    tasks: taskSummaries,
    measurementLimitations: limitations,
    ...(savingsVsBaseline ? { savingsVsBaseline } : {}),
  }
}

/** Serialize report to CSV format for independent audit and spreadsheet analysis. */
export function exportReportToCsv(report: TeamTokenReport): string {
  const lines: string[] = []
  lines.push('# TEAM RUN SUMMARY')
  lines.push('TeamId,TeamName,OperatingMode,Status,TotalTasks,CompletedTasks,ExactCoveragePct,ExactTotalTokens,EstimatedTokens,TotalInvocations,TotalDurationMs')
  lines.push(`"${report.teamId}","${report.teamName}","${report.operatingMode}","${report.finalStatus}",${report.totalTasks},${report.completedTasks},${report.exactCoveragePercentage}%,${report.exactTotalTokens},${report.estimatedTokensTotal},${report.totalInvocations},${report.totalDurationMs}`)
  lines.push('')
  lines.push('# PER-AGENT BREAKDOWN')
  lines.push('AgentName,Role,Provider,Model,TasksHandled,Invocations,ExactTotalTokens,CacheTokens,ReasoningTokens,ToolCalls,Outcome')
  for (const a of report.agents) {
    lines.push(`"${a.agentName}","${a.role}","${a.provider}","${a.model}",${a.tasksHandled},${a.invocationCount},${a.exactTotalTokens},${a.cacheReadTokens},${a.reasoningTokens},${a.toolCallsCount},"${a.outcome}"`)
  }
  lines.push('')
  lines.push('# PER-TASK BREAKDOWN')
  lines.push('TaskId,Subject,Owner,Status,Attempts,Invocations,ExactTotalTokens,DurationMs')
  for (const t of report.tasks) {
    lines.push(`"${t.taskId}","${t.subject.replace(/"/g, '""')}","${t.owner}","${t.status}",${tsSanitize(t.attemptsCount)},${t.invocationCount},${t.exactTotalTokens},${t.durationMs}`)
  }
  return lines.join('\n') + '\n'
}

function tsSanitize(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** Save report as JSON and CSV in the team's state directory. */
export async function saveTeamTokenReport(
  stateRoot: string,
  teamId: string,
  report: TeamTokenReport,
): Promise<{ jsonPath: string; csvPath: string }> {
  const dir = join(stateRoot, teamId)
  await mkdir(dir, { recursive: true })
  const jsonPath = join(dir, 'token-report.json')
  const jsonTemp = join(dir, `token-report.${Date.now()}.tmp`)
  await replaceFileAtomicOrDirect(jsonTemp, jsonPath, JSON.stringify(report, null, 2) + '\n', fsPrimitives)

  const csvPath = join(dir, 'token-report.csv')
  const csvTemp = join(dir, `token-report.${Date.now()}.csv.tmp`)
  await replaceFileAtomicOrDirect(csvTemp, csvPath, exportReportToCsv(report), fsPrimitives)

  return { jsonPath, csvPath }
}
