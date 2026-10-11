/**
 * Authoritative Token Accounting and Cost Telemetry for AgentTeams.
 *
 * Captures, verifies, deduplicates and persists exact token usage metrics
 * from Harness/provider response telemetry, strictly distinguishing actual,
 * estimated, and unknown usage.
 *
 * @module dsh-agent-teams/token-accounting
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import type { TeamState } from './types.ts';
/** Token usage measurement quality. */
export type TokenUsageQuality = 'exact' | 'estimated' | 'unknown';
/** One atomic invocation usage record in the ledger. */
export interface TokenUsageEvent {
    readonly id: string;
    readonly teamId: string;
    readonly taskId?: string;
    readonly attemptId?: string;
    readonly agentId: string;
    readonly agentName: string;
    readonly role: string;
    readonly sessionId: string;
    readonly provider: string;
    readonly model: string;
    readonly turn: number;
    readonly step: number;
    readonly timestamp: number;
    readonly durationMs: number;
    readonly outcome: 'completed' | 'failed' | 'interrupted';
    readonly quality: TokenUsageQuality;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly reasoningTokens: number;
    readonly toolCallsCount: number;
    readonly operatingMode: 'normal' | 'economy';
    readonly isRetry: boolean;
    readonly seq?: number;
    readonly errorDetails?: string;
}
/** Aggregated usage statistics for one participating agent. */
export interface AgentTokenSummary {
    readonly agentName: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly tasksHandled: number;
    readonly invocationCount: number;
    readonly retriesCount: number;
    readonly exactInvocations: number;
    readonly estimatedInvocations: number;
    readonly unknownInvocations: number;
    readonly exactInputTokens: number;
    readonly exactOutputTokens: number;
    readonly exactTotalTokens: number;
    readonly cacheReadTokens: number;
    readonly reasoningTokens: number;
    readonly estimatedTokens: number;
    readonly toolCallsCount: number;
    readonly totalDurationMs: number;
    readonly outcome: 'active' | 'completed' | 'failed' | 'idle';
}
/** Aggregated usage statistics for one task. */
export interface TaskTokenSummary {
    readonly taskId: string;
    readonly subject: string;
    readonly owner: string;
    readonly status: string;
    readonly attemptsCount: number;
    readonly invocationCount: number;
    readonly exactInputTokens: number;
    readonly exactOutputTokens: number;
    readonly exactTotalTokens: number;
    readonly cacheReadTokens: number;
    readonly reasoningTokens: number;
    readonly estimatedTokens: number;
    readonly durationMs: number;
}
/** Complete End-of-Run token accounting report. */
export interface TeamTokenReport {
    readonly schemaVersion: 1;
    readonly reportId: string;
    readonly teamId: string;
    readonly teamName: string;
    readonly operatingMode: 'normal' | 'economy';
    readonly createdAt: number;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly totalDurationMs: number;
    readonly finalStatus: 'completed' | 'failed' | 'halted' | 'cancelled' | 'in_progress';
    readonly totalTasks: number;
    readonly completedTasks: number;
    readonly failedTasks: number;
    readonly totalInvocations: number;
    readonly exactInvocations: number;
    readonly estimatedInvocations: number;
    readonly unknownInvocations: number;
    readonly exactCoveragePercentage: number;
    readonly exactInputTokens: number;
    readonly exactOutputTokens: number;
    readonly exactTotalTokens: number;
    readonly exactCacheReadTokens: number;
    readonly exactReasoningTokens: number;
    readonly estimatedTokensTotal: number;
    readonly totalToolCalls: number;
    readonly peakConcurrentWorkers: number;
    readonly tokensPerCompletedTask: number;
    readonly deduplicatedEventCount: number;
    readonly agents: readonly AgentTokenSummary[];
    readonly tasks: readonly TaskTokenSummary[];
    readonly measurementLimitations: readonly string[];
    readonly savingsVsBaseline?: {
        readonly baselineTotalTokens: number;
        readonly reductionTokens: number;
        readonly reductionPercentage: number;
    };
}
/** Durable ledger storing raw usage events. */
export interface TokenLedgerState {
    readonly schemaVersion: 1;
    readonly teamId: string;
    readonly events: TokenUsageEvent[];
    readonly deduplicatedKeys: string[];
}
/** Compute stable event key for deduplication. */
export declare function tokenEventKey(sessionId: string, turn: number, step: number, seqOrAttempt?: number | string): string;
/** Load the team's token ledger from disk, returning an empty ledger if absent. */
export declare function readTokenLedger(stateRoot: string, teamId: string): Promise<TokenLedgerState>;
/** Persist the token ledger atomically to disk. */
export declare function writeTokenLedger(stateRoot: string, teamId: string, ledger: TokenLedgerState): Promise<void>;
/** Append an invocation event to the ledger with deduplication. */
export declare function recordTokenUsageEvent(stateRoot: string, teamId: string, event: TokenUsageEvent): Promise<{
    recorded: boolean;
    duplicate: boolean;
}>;
/** Extract exact TokenUsage from an adapter response payload or normalize missing usage. */
export declare function normalizeTokenUsage(rawUsage?: TokenUsage): {
    quality: TokenUsageQuality;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
};
/**
 * Generate an aggregated End-of-Run report from the ledger and team state.
 * Strictly ordinary program logic: NO LLM requests are invoked.
 */
export declare function generateTeamTokenReport(team: TeamState, ledger: TokenLedgerState, options?: {
    baselineTotalTokens?: number;
    peakConcurrentWorkers?: number;
}): TeamTokenReport;
/** Serialize report to CSV format for independent audit and spreadsheet analysis. */
export declare function exportReportToCsv(report: TeamTokenReport): string;
/** Save report as JSON and CSV in the team's state directory. */
export declare function saveTeamTokenReport(stateRoot: string, teamId: string, report: TeamTokenReport): Promise<{
    jsonPath: string;
    csvPath: string;
}>;
