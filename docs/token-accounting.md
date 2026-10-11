# DSH Agent Teams — Authoritative Token Accounting Specification

## Overview

Project Ascension introduces an authoritative, persistent, and verifiable token accounting system for `@nanmicoder/dsh-agent-teams`. The system records input, output, cache-read, and reasoning tokens consumed across all agent sessions without relying on synthetic approximations or secondary LLM queries.

---

## 1. Accounting Architecture & Telemetry Pipeline

Token telemetry flows asynchronously from the DeepSeek Harness runtime into a persistent, transactional ledger:

```
┌─────────────────────────────────┐
│     Harness Session Runtime     │
│   (assistant/message events)    │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     ctx.on('session/event')     │
│   - extracts provider usage     │
│   - normalizes usage fields     │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Token Accounting Engine     │
│   - Deduplication Check         │
│   - Quality Level Tagging       │
│   - Ledger State Update         │
│   - Budget Threshold Check      │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│    Persistent Storage on Disk   │
│   teams/<name>/token-ledger.json│
│   teams/<name>/token-report.json│
│   teams/<name>/token-report.csv │
└─────────────────────────────────┘
```

### Telemetry Capture via `session/event`

The plugin registers a runtime event listener on plugin startup (`src/index.ts`):

```typescript
ctx.on('session/event', async (eventData: any) => {
  // Filters for assistant messages and provider completions
  // Extracts usage: inputTokens, outputTokens, cacheTokens, reasoningTokens
  // Invokes recordTokenUsageEvent(teamName, event)
});
```

### Deduplication Guarantee

To prevent duplicate counting from retried streams, replayed events, or repeated status queries, every token event is indexed by a deterministic composite key:

$$\text{dedupKey} = \text{sessionId} : \text{turn} : \text{step}$$

If an event with the same composite key has already been recorded in `recordedEventKeys`, the ledger skips processing immediately, guaranteeing idempotent accumulation.

---

## 2. Quality Classifications: Exact vs. Estimated vs. Unknown

Every recorded event and aggregated report tracks the measurement provenance:

- **`exact`**: Authoritative telemetry directly provided by the underlying model provider or Harness runtime in the `usage` payload.
- **`estimated`**: Derived using character-ratio heuristics (e.g., approximately $\sim 4$ characters per token) when the host provider does not return raw token metrics.
- **`unknown`**: Recorded when usage fields are null, undefined, or unsupported by the runtime environment.

### Normalization Logic

The `normalizeTokenUsage()` function maps diverse provider schema variants (e.g., `prompt_tokens`, `completion_tokens`, `cached_tokens`, `inputTokens`, `outputTokens`, `cacheTokens`, `reasoningTokens`) into a unified canonical structure:

```typescript
export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costEstimateUsd?: number;
  quality: 'exact' | 'estimated' | 'unknown';
}
```

---

## 3. Persistent Ledger Schema

The state is persisted atomically in `teams/<team_name>/token-ledger.json`:

```typescript
export interface TokenLedgerState {
  version: 1;
  teamName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCostEstimateUsd: number;
  recordedEventKeys: string[];
  events: TokenUsageEvent[];
  agents: Record<string, AgentTokenSummary>;
  tasks: Record<string, TaskTokenSummary>;
  budget?: {
    tokenBudget?: number;
    budgetWarningThreshold?: number;
    budgetExceeded: boolean;
  };
  lastUpdated: string;
}
```

### Event Record Schema

Each individual event stored in `events` contains:

```typescript
export interface TokenUsageEvent {
  id: string;
  teamName: string;
  agentId: string;
  role: string;
  sessionId: string;
  turn: number;
  step: number;
  timestamp: string;
  taskId?: string;
  usage: NormalizedTokenUsage;
}
```

---

## 4. Token Budget Controls & Hard Stops

When configuring a team via `agent_teams_create`:
- `token_budget` (number, optional): Maximum allowed total tokens for the entire team run.
- `budget_warning_threshold` (number, optional, defaults to 0.8 / 80%): Threshold fraction at which warning banners are rendered.

### Hard-Stop Enforcement

Upon recording every token event:
1. The ledger calculates $\text{totalTokens} = \text{totalInputTokens} + \text{totalOutputTokens}$.
2. If `token_budget` is set and $\text{totalTokens} \ge \text{token_budget}$:
   - `budgetExceeded` is set to `true`.
   - Scheduler halts dispatching new `pending` or `ready` tasks.
   - Activity Panel displays a persistent `[Budget Exceeded]` alert banner.
   - Status queries output a warning indicating that the budget cap has been reached.

---

## 5. Reporting Formats & Export Channels

### 1. Automatic On-Completion Reports
When `agent_teams_status` detects that all tasks in the DAG are finished (`teamStatus === 'completed'`), it automatically saves:
- `teams/<team_name>/token-report.json`
- `teams/<team_name>/token-report.csv`

### 2. On-Demand Tool Query
`agent_teams_status` accepts the optional parameter `token_report`:
- `agent_teams_status({ team_name: "my-team", token_report: "summary" })`: Returns high-level team token summary, budget status, and per-agent totals.
- `agent_teams_status({ team_name: "my-team", token_report: "detailed" })`: Returns full agent breakdown and per-task token consumption.
- `agent_teams_status({ team_name: "my-team", token_report: "csv" })`: Returns the complete RFC-4180 CSV export as a formatted text block.

### 3. HTTP API Endpoint
External CI/CD pipelines, dashboards, and automated verification suites can fetch reports directly via HTTP:

```http
GET /plugins/dsh-agent-teams/token-report?team=my-team&format=json
GET /plugins/dsh-agent-teams/token-report?team=my-team&format=csv
```

### 4. CSV Schema
The exported CSV provides row-level granularity for spreadsheet analysis and cost accounting:

```csv
RecordType,Identifier,RoleOrTitle,InputTokens,OutputTokens,CacheTokens,ReasoningTokens,TotalTokens,Quality
Team,my-team,all,12000,3200,4500,800,15200,exact
Agent,researcher,investigator,6500,1800,2200,400,8300,exact
Agent,coder,developer,5500,1400,2300,400,6900,exact
Task,task-1,Scout Architecture,4000,1100,1500,200,5100,exact
Task,task-2,Implement Module,8000,2100,3000,600,10100,exact
```
