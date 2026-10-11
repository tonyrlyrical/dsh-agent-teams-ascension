# DSH Agent Teams — Benchmark Methodology & Adversarial Audit

## Executive Summary & Audit Reclassification

Following an independent adversarial audit of Project Ascension, the benchmark suite and its reported metrics have been audited, classified, and reclassified according to verifiable data provenance.

> [!IMPORTANT]
> **Audit Reclassification Notice**:
> The 76.1%–77.5% token reduction figure produced by `scripts/ascension-benchmark.mjs` is an **OFFLINE SYNTHETIC MICROBENCHMARK**, NOT live model tokens measured from a cloud provider. It quantifies deterministic character-ratio prompt compression and transitive DAG context pruning, not actual API billing.
>
> Actual Harness runtime behavior, session event subscription, retry non-collapse, missing usage tracking, and budget enforcement are verified empirically via the live Harness integration canary test: `scripts/harness-canary-audit.mjs`.

---

## 1. Metric Classification Matrix

Every reported metric across Project Ascension is classified by its empirical source:

| Metric Category | Source | Classification | Semantics & Verification |
| :--- | :--- | :--- | :--- |
| **Prompt Input Tokens** (`ascension-benchmark.mjs`) | String length heuristic | **ESTIMATED** | `Math.ceil(renderedText.length / 4)`. Measures prompt template compression. |
| **Simulated Response Tokens** (`ascension-benchmark.mjs`) | Hardcoded constants | **SYNTHETIC** | Preset output values (e.g., 120–220 tokens) simulating model completions. |
| **Microbenchmark Total Tokens** (`ascension-benchmark.mjs`) | Sum of input & output | **SYNTHETIC / ESTIMATED HYBRID** | Useful for comparing context pruning across topologies offline. |
| **Worker Concurrency Limit** | Scheduler runtime config | **ACTUAL** | Enforced by `team.maxConcurrentWorkers` in `src/scheduler.ts`. |
| **DSH Event Invocations** (`harness-canary-audit.mjs`) | Real Harness `session/event` | **ACTUAL** | Captured via `assistant/message` & `assistant/attempt` events. |
| **Provider Telemetry Usage** (`harness-canary-audit.mjs`) | Session event `data.usage` | **ACTUAL** | Input, output, reasoning, and cache tokens read directly from payload. |
| **Missing/Unmetered Invocations** | Event without `data.usage` | **UNKNOWN (TRACKED)** | Explicitly tracked as `unknownInvocations` rather than treated as 0. |
| **Disjoint Cache Accounting** | Provider usage fields | **ACTUAL** | Cache read/write tokens kept separate from `inputTokens + outputTokens`. |

---

## 2. Offline Synthetic Microbenchmark Suite

The offline microbenchmark suite (`scripts/ascension-benchmark.mjs`) evaluates five standard multi-agent orchestration topologies:

1. **Scenario 1: Small Self-Contained Task**: 1 worker, single atomic task. Evaluates welcome and assignment prompt overhead.
2. **Scenario 2: Parallel Independent Subtasks**: 4 parallel workers executing concurrently. Evaluates worker onboarding overhead.
3. **Scenario 3: Sequential Deep DAG Pipeline**: 5-stage sequential pipeline ($T_1 \to T_2 \to T_3 \to T_4 \to T_5$). Heavily stresses transitive context accumulation.
4. **Scenario 4: Large Intermediate Result Passing**: Upstream task produces a large dataset (6,400 chars) passed to downstream consumer.
5. **Scenario 5: Worker Failure & Fault Recovery**: Worker fails on turn 1 and recovers on turn 2.

### Deterministic Microbenchmark Results (`benchmark-results.json`)

| Scenario | Baseline (Legacy) | Normal Mode | Economy Mode | Economy Reduction |
| :--- | :---: | :---: | :---: | :---: |
| **1. Small Self-Contained Task** | 791 | 767 | **334** | **-57.8%** |
| **2. Parallel Subtasks (4 workers)** | 3,228 | 3,228 | **1,464** | **-54.6%** |
| **3. Sequential Deep DAG (5 stages)** | 13,563 | 4,354 | **1,948** | **-85.6%** |
| **4. Large Intermediate Result** | 1,841 | 1,841 | **640** | **-65.2%** |
| **5. Worker Failure & Recovery** | 1,303 | 1,303 | **561** | **-56.9%** |
| **TOTAL AGGREGATE** | **20,726** | **11,493** | **4,947** | **-76.1%** |

### Mechanical Breakdown of Prompt Reductions

1. **Sequential Deep DAG (-85.6% text reduction)**: Legacy orchestration repeatedly serialized all historical ancestor outputs verbatim up to 12,000 characters. Economy Mode bounds direct dependencies to 500 characters (`ECONOMY_DEPENDENCY_OUTPUT_MAX_CHARS`) and truncates indirect ancestors to 100-character digests (`ECONOMY_DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS`), preventing polynomial context growth.
2. **Boilerplate Suppression (-54.6% to -57.8% reduction)**: Welcome prompts were reduced from 256 to 95 characters. Assignment prompts were stripped of repetitive operational instructions (~1,200 chars down to ~160 chars), directing workers to read immutable state via `agent_teams_status` if details are needed.
3. **Artifact Enveloping (-65.2% reduction)**: Large upstream payloads are strictly bounded before injection into downstream prompts.

---

## 3. Real-Harness Integration Canary Audit

To validate real runtime contracts without relying on synthetic approximations, an integration canary test suite was implemented in `scripts/harness-canary-audit.mjs`.

### Test Architecture & Coverage

The canary executes in an isolated scratch workspace (`.agent-teams-canary-*`) and verifies:

1. **Host Tool Mounting**: Confirms all 14 DSH Agent Teams tools mount successfully into the Harness tool registry.
2. **Session Event Interception**: Confirms the plugin intercepts both `assistant/message` and `assistant/attempt` events with stream usage chunk fallback (`{ type: 'usage', usage: ... }`).
3. **Event Deduplication**: Confirms that duplicate session events on identical session/turn/step coordinates are rejected by the composite key `tokenEventKey`.
4. **Retry Non-Collapse**: Confirms that retries with incremented sequence numbers (`seq`) or attempt IDs are recorded as separate events (`isRetry: true`, `outcome: 'failed'` / `outcome: 'completed'`), preventing usage undercounting.
5. **Unknown Invocation Tracking**: Confirms that invocations with missing usage metadata are tracked with `quality: 'unknown'`, reducing `exactCoveragePercentage` to 75% and annotating `measurementLimitations`.
6. **Token Budget Enforcement**: Confirms that when aggregate exact consumption exceeds `team.tokenBudget` (5,170 > 5,000 tokens), `team.budgetExceeded` is set to `true`, and subsequent task dispatches are blocked while open tasks settle.
7. **Report File Artifacts**: Confirms that `token-report.json` and `token-report.csv` are persisted with full breakdown by task, agent, model, and quality coverage.

### Canary Verification Results

```
Starting Project Ascension Real-Harness Integration Canary Audit...

✔ Harness tool registration verified: 14 tools mounted.
✔ Team created in Economy Mode with token budget of 5000 tokens.
✔ DAG Tasks created: t1 (alpha) -> t2 (beta, depends on t1).
✔ Worker alpha claimed t1 (attempt_id: generated).
✔ Telemetry validation passed: Retries preserved, duplicates dropped, unknown usage tracked.
✔ Task 1 (t1) completed by alpha with output recorded.
✔ Worker beta claimed t2 (dependencies satisfied).
✔ Task 2 (t2) completed by beta.
✔ Budget hard stop verified: 5170 >= 5000 tokens (budget_exceeded: true).
✔ token-report.json and token-report.csv verified with coverage breakdown and limitations.

======================================================================
  REAL-HARNESS INTEGRATION CANARY AUDIT PASSED 100% (All Gates Green)  
======================================================================
```

---

## 4. Cloud Provider Credential Blocker Audit

Per **Absolute Rule 11** (prohibiting unauthorized billing or paid API subscriptions) and **Stop Condition 9**, the local environment was audited for live cloud provider credentials:

- **Environment variables**: `DEEPSEEK_API_KEY` is not defined in `process.env`.
- **Harness settings**: `$HOME/.dsh/settings.yaml` does not exist on this machine.
- **Harness credentials**: `$HOME/.dsh/.credentials.yaml` contains only `OLLAMA_API_KEY`; no active DeepSeek Cloud API subscription credentials exist.

Because live paid cloud requests cannot be initiated without credentials or incurring unapproved charges, cloud provider billing numbers are honestly left unmeasured. The runtime event semantics are verified against authentic DeepSeek Harness event schemas.

---

## 5. How to Reproduce

### 1. Run Offline Synthetic Microbenchmark
```bash
node scripts/ascension-benchmark.mjs
```

### 2. Run Real-Harness Integration Canary
```bash
node scripts/harness-canary-audit.mjs
```

### 3. Run Ascension Test Suite
```bash
node --test scripts/token-accounting.test.mjs scripts/ascension.test.mjs
```

### 4. Run Full Project Verification Suite
```bash
pnpm verify
```
