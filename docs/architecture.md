# DSH Agent Teams — Architecture Specification

## Overview

`@nanmicoder/dsh-agent-teams` is a high-performance multi-agent orchestration plugin designed for DeepSeek Harness (DSH). It enables coordinated multi-agent execution with deterministic task scheduling, dependency resolution, concurrency bounds, and real-time token telemetry accounting.

Project Ascension modernizes the orchestration architecture by establishing explicit boundaries between non-deterministic model operations and deterministic runtime mechanics, eliminating prompt and context redundancies, enforcing global concurrency limits, and implementing an authoritative persistent token accounting ledger.

---

## 1. Multi-Agent Lifecycle Trace

Every multi-agent run progresses through twelve deterministic stages:

```
[ USER REQUEST ]
       │
       ▼
[ CAPTAIN ACTIVATION ]
       │
       ▼
[ TASK PLANNING ]
       │
       ▼
[ WORKER ASSIGNMENT ]
       │
       ▼
[ PROMPT CONSTRUCTION ]
       │
       ▼
[ MODEL INVOCATION ]
       │
       ▼
[ TOOL EXECUTION ]
       │
       ▼
[ RESULT STORAGE ]
       │
       ▼
[ MAILBOX & BROADCAST ]
       │
       ▼
[ DEPENDENCY RESOLUTION ]
       │
       ▼
[ QUALITY GATES ]
       │
       ▼
[ TEAM COMPLETION & AUDIT ]
```

### Detailed Lifecycle Stages

1. **USER REQUEST**
   - The user or external caller initiates a team run via `agent_teams_create` or direct chat interaction.
   - Initial parameters specify team name, member roles/profiles, operating mode (`normal` vs `economy`), token budget, and optional concurrency limits.

2. **CAPTAIN ACTIVATION**
   - The team captain session is initialized or resolved.
   - Captain loads team configuration from persistent state (`teams/<team_name>/config.json`).
   - Token ledger is initialized (`teams/<team_name>/token-ledger.json`).

3. **TASK PLANNING**
   - The captain decomposes the high-level objective into discrete, directed acyclic graph (DAG) tasks via `agent_teams_tasks`.
   - Each task defines: `id`, `title`, `description`, `assignee`, `dependencies` (array of upstream task IDs), and status (`pending`).

4. **WORKER ASSIGNMENT**
   - The scheduler scans task dependencies. Tasks whose dependencies are all `completed` transition from `pending` to `ready`.
   - Ready tasks are assigned to workers. Concurrency check (`maxConcurrentWorkers`) evaluates how many workers are currently in-flight.
   - If concurrency cap is reached, assignment queues remain bounded until active workers yield.

5. **PROMPT CONSTRUCTION**
   - Scheduler constructs member welcome and task assignment prompts:
     - **Normal Mode**: Detailed instructions, task context, full direct and historical ancestor dependency outputs, comprehensive guidance.
     - **Economy Mode**: Ultra-compact welcome (95 chars), lean assignment prompt (~160 chars), bounded direct dependency outputs (max 500 chars), and transitive ancestor summaries (compact 100-char digests marked as `(indirect prerequisite)`).

6. **MODEL INVOCATION**
   - Worker session receives assignment prompt via session prompt delivery or mailbox message.
   - Model processes prompt and determines tool calls or task fulfillment.
   - Provider emits session events (`assistant/message`) containing token consumption telemetry (`inputTokens`, `outputTokens`, `cacheTokens`, `reasoningTokens`).

7. **TOOL EXECUTION**
   - Worker executes authorized tools (e.g., file inspection, editing, command execution).
   - Tool results are captured into the worker's turn context.

8. **RESULT STORAGE**
   - Worker signals completion via `agent_teams_tasks(action='complete', taskId=..., result=...)`.
   - Task result is persisted into team state (`teams/<team_name>/tasks.json`).
   - Summary results are indexed for downstream dependency passing.

9. **MAILBOX & BROADCAST**
   - Inter-agent coordination occurs through the deterministic mailbox system (`agent_teams_mailbox`).
   - Messages can be direct peer-to-peer or broadcast.
   - Workers consume unread messages without querying the model for mailbox polling.

10. **DEPENDENCY RESOLUTION**
    - Completing a task triggers `scheduler.kickTeam()`.
    - Downstream tasks dependent on the completed task verify dependency satisfaction.
    - Eligible downstream tasks transition to `ready`.

11. **QUALITY GATES**
    - Task verification checks ensure required artifacts, exit codes, and deliverables exist.
    - If a task fails verification or encounters an error, it is marked `failed` or rescheduled with retry bounds.

12. **TEAM COMPLETION & AUDIT**
    - When all tasks in the DAG are `completed` or terminal, `agent_teams_status` marks the team as `completed`.
    - Final token accounting report is automatically generated and written to `token-report.json` and `token-report.csv`.
    - The Activity Monitor UI is notified of completion with full audit telemetry.

---

## 2. Deterministic vs. Non-Deterministic Boundaries

A core tenet of Project Ascension is strict separation of concerns: **never spend LLM tokens on logic that can be computed deterministically**.

| Architecture Layer | Deterministic (Runtime Code) | Non-Deterministic (LLM Reasoning) |
| :--- | :--- | :--- |
| **Team Lifecycle** | State machine, session creation, profile resolution | Role delegation, persona reasoning |
| **Task DAG** | Dependency graph validation, cycle detection, topological sorting, ready-state evaluation | Task decomposition, domain problem solving |
| **Worker Concurrency** | In-flight worker counting, slot queuing, FIFO dispatch | Work execution within active slots |
| **Dependency Context** | Transitive ancestor identification, string truncation, digest generation, total byte budgeting | Synthesis of upstream findings into new deliverables |
| **Token Accounting** | Event ingestion, deduplication keying, sum accumulation, budget checking, CSV serialization | *None* (Zero LLM tokens required for telemetry) |
| **Mailbox Routing** | Message queues, read/unread states, recipient dispatch | Drafting message contents (when peer consultation is needed) |
| **Quality Gates** | Schema validation, file existence checks, lint/build exit codes | Code review, subjective output critique |

---

## 3. Subsystem Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DeepSeek Harness Host                            │
│   ┌───────────────────────────┐         ┌───────────────────────────────┐   │
│   │   Runtime Session API     │         │   ctx.on('session/event')     │   │
│   └─────────────┬─────────────┘         └───────────────┬───────────────┘   │
└─────────────────┼───────────────────────────────────────┼───────────────────┘
                  │                                       │
┌─────────────────▼───────────────────────────────────────▼───────────────────┐
│                          dsh-agent-teams Plugin                             │
│                                                                             │
│   ┌─────────────────────────────┐        ┌──────────────────────────────┐   │
│   │      Tools Interface        │        │   Token Accounting Ledger    │   │
│   │   • agent_teams_create      │        │   • Deduplication Store      │   │
│   │   • agent_teams_status      │◄───────┤   • Live Telemetry Collector │   │
│   │   • agent_teams_tasks       │        │   • Budget Hard-Stop Engine  │   │
│   │   • (14 Total Tools)        │        │   • JSON / CSV Exporters     │   │
│   └─────────────┬───────────────┘        └──────────────┬───────────────┘   │
│                 │                                       │                   │
│   ┌─────────────▼───────────────┐                       │                   │
│   │    Scheduler Engine         │                       │                   │
│   │   • Operating Modes (N / E) │                       │                   │
│   │   • Concurrency Limiter     │                       │                   │
│   │   • Transitive DAG Pruner   │                       │                   │
│   │   • Compact Prompt Engine   │                       │                   │
│   └─────────────┬───────────────┘                       │                   │
│                 │                                       │                   │
│   ┌─────────────▼───────────────┐        ┌──────────────▼───────────────┐   │
│   │      Team & State Store     │        │   Web UI & Activity Panel    │   │
│   │   • config.json             │        │   • Operating Mode Badge     │   │
│   │   • tasks.json              │───────►│   • Live Token Counters      │   │
│   │   • mailbox.json            │        │   • Budget Status Banner     │   │
│   │   • token-ledger.json       │        │   • One-Click CSV Export     │   │
│   └─────────────────────────────┘        └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Roles

- **Tools Interface (`src/tools.ts`, `src/tool-names.ts`)**: Exposes exactly 14 standard tools adhering to Harness runtime contracts (`agent_teams_create`, `agent_teams_status`, `agent_teams_tasks`, etc.). Supports on-demand token reporting via `agent_teams_status({ token_report: 'summary' | 'detailed' | 'csv' })`.
- **Token Accounting Ledger (`src/token-accounting.ts`)**: Listens to runtime telemetry events via `session/event`, deduplicates events using `${sessionId}:${turn}:${step}`, records exact/estimated tokens, tracks task/agent summaries, and executes budget checks.
- **Scheduler Engine (`src/scheduler.ts`)**: Manages task progression, enforces `maxConcurrentWorkers`, compresses welcome/assignment prompts in economy mode, and prunes transitive ancestor outputs to prevent quadratic context blowup.
- **State Store (`src/state.ts`)**: Atomic filesystem-backed persistence for team configuration, task DAGs, mailbox messages, and the token ledger.
- **Activity Panel UI (`src/client/ActivityPanel.tsx`, `src/client/activity-monitor.ts`)**: Real-time web interface providing visibility into active agents, task states, operating mode badges (`[Normal]` / `[Economy]`), budget warnings, and one-click token report downloads.
- **HTTP Endpoint (`src/index.ts`)**: `/plugins/dsh-agent-teams/token-report?team=<name>&format=json|csv` allows external tools and CI pipelines to retrieve authoritative token accounting reports.
