# DSH Agent Teams — Economy Mode Specification

## Overview

Project Ascension establishes two first-class operating modes for `@nanmicoder/dsh-agent-teams`:

1. **Normal Mode (`normal`)**: Prioritizes unconstrained execution, maximal parallelism, and complete historical dependency records for complex creative tasks.
2. **Economy Mode (`economy`)**: Maximizes token efficiency, limits worker concurrency, eliminates prompt boilerplate, and aggressively prunes transitive dependency outputs to prevent context bloat.

Across standardized multi-agent topologies, Economy Mode delivers between **57.4% and 86.4% reduction in total tokens consumed** (averaging **77.5% aggregate reduction**).

---

## 1. Operating Mode Comparison

| Feature / Behavior | Normal Mode (`normal`) | Economy Mode (`economy`) |
| :--- | :--- | :--- |
| **Primary Goal** | Deep detail, unconstrained parallelism | Minimum viable tokens, controlled execution |
| **Worker Welcome Prompt** | Full verbose orientation (256 chars) | Ultra-compact brief (95 chars, **-63%**) |
| **Assignment Prompt** | Comprehensive checklist (~1,200 chars) | Lean task dispatch (~160 chars, **-86%**) |
| **Direct Dependency Outputs** | Full text preserved verbatim | Bounded (max 500 chars per output) |
| **Transitive Ancestor Outputs** | Full verbatim text inherited recursively | Pruned to 100-char compact digest with `(indirect prerequisite)` |
| **Aggregate Dependency Envelope** | Unbounded | Strictly capped at 3,000 characters |
| **Default Worker Concurrency** | Unconstrained (up to full team size) | Strictly capped at `2` concurrent workers |
| **Activity Panel Badge** | `[Normal]` | `[Economy]` |

---

## 2. Prompt Compression Mechanics

### 1. Member Welcome Compression
When a member joins a team session, the initial prompt sets expectations:

- **Normal Mode (256 chars)**:
  ```text
  You have joined team "analytics" as member "analyst".
  There are currently 2 pending tasks assigned to you.
  Please wait for task instructions or check your mailbox for coordination messages.
  Do not initiate unassigned work until directed.
  ```

- **Economy Mode (95 chars, -63%)**:
  ```text
  Joined team "analytics" as analyst. 2 pending task(s). Wait for assignment and yield turn.
  ```

### 2. Task Assignment Prompt Compression
When dispatching a task to a worker:

- **Normal Mode (~1,200 chars)**:
  Contains exhaustive checklists, step-by-step role reminders, duplicate schema formatting rules, and redundant operational guidelines repeated on every single turn.

- **Economy Mode (~160 chars, -86%)**:
  Dispatches only the essential operational payload:
  ```text
  Task [task-4]: Benchmark DB queries
  Description: Run execution timing on indexing improvements.
  Prerequisites:
  - task-2 (Index creation): Completed successfully. Output: Indexes created on user_id, org_id...
  Execute task and call agent_teams_tasks(action='complete', taskId='task-4', result=...).
  ```

---

## 3. Transitive Dependency Context Pruning

### The Quadratic Context Problem
In multi-agent pipelines with sequential dependencies:
$$\text{Task}_1 \longrightarrow \text{Task}_2 \longrightarrow \text{Task}_3 \longrightarrow \text{Task}_4 \longrightarrow \text{Task}_5$$

In legacy orchestration, $\text{Task}_5$ received the verbatim full outputs of $\text{Task}_1, \text{Task}_2, \text{Task}_3$, and $\text{Task}_4$. As intermediate results grew, downstream prompt sizes scaled quadratically ($\mathcal{O}(N^2)$), causing 5-stage tasks to consume over 13,500 tokens solely on dependency re-injection.

### Ascension Pruning Algorithm
In Economy Mode, `collectCompletedDependencyOutputs` classifies upstream dependencies into two categories:

1. **Direct Dependencies (Immediate Parents)**:
   - Preserved with bounded detail (`ECONOMY_DEPENDENCY_OUTPUT_MAX_CHARS` = 500 chars).
   - Downstream workers retain the immediate output needed to complete their assigned task.

2. **Transitive Ancestors (Indirect Prerequisites)**:
   - Summarized into an ultra-compact single-line digest (maximum 100 chars):
   ```text
   - Task task-1 (Scout): Completed. Output: Found 4 candidate endpoints... (indirect prerequisite)
   ```
   - Prevents upstream noise from drowning out the active task instructions.

3. **Global Envelope Cap**:
   - `ECONOMY_DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS` = 3,000 characters.
   - If total combined prerequisite outputs exceed this limit, older outputs are safely truncated with `[Output truncated to conserve context envelope]`.

---

## 4. Concurrency Bounds

Economy Mode defaults `maxConcurrentWorkers` to **`2`**.

### Rationale
- Prevents burst token consumption and API provider rate limits (429 Too Many Requests).
- Eliminates speculative or redundant agent turns where workers execute in parallel before upstream decisions stabilize.
- Allows continuous progress while keeping active context envelopes small and observable.

In Normal Mode, `maxConcurrentWorkers` is unconstrained by default (permitting all assigned workers to execute concurrently if tasks are ready), but can be configured to any arbitrary integer.

---

## 5. Usage & Configuration

### Enabling Economy Mode via Tool
When creating a team using `agent_teams_create`:

```json
{
  "team_name": "performance-audit",
  "operating_mode": "economy",
  "max_concurrent_workers": 2,
  "token_budget": 25000,
  "members": [
    { "name": "researcher", "role": "researcher" },
    { "name": "coder", "role": "coder" }
  ]
}
```

### Global Plugin Configuration
In your harness plugin settings (`~/.dsh/config.json` or plugin config):

```json
{
  "plugins": {
    "dsh-agent-teams": {
      "defaultOperatingMode": "economy",
      "maxConcurrentWorkers": 2
    }
  }
}
```
