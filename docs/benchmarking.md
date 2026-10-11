# DSH Agent Teams — Benchmark Methodology & Results

## Overview

Project Ascension includes a standardized, reproducible benchmark suite (`scripts/ascension-benchmark.mjs`) designed to empirically quantify token consumption across multi-agent orchestration patterns.

All benchmarks compare three distinct runtime configurations on identical workloads:
1. **Baseline**: Legacy orchestration behavior (verbose prompts, unpruned transitive dependency contexts, unconstrained concurrency).
2. **Normal Mode**: Modernized Ascension orchestration with structured context bounds and full capability fidelity.
3. **Economy Mode**: Ultra-compressed prompt templates, bounded dependency outputs, transitive ancestor pruning, and concurrency caps.

---

## 1. Benchmark Suite Topologies

The benchmark evaluates five multi-agent topologies representing common production workloads:

| Scenario | Topology Description | Key Stress Factor |
| :--- | :--- | :--- |
| **Scenario 1: Small Task** | Single worker performing an atomic task. | Fixed welcome and assignment prompt overhead. |
| **Scenario 2: Parallel Subtasks** | 4 parallel workers executing independent tasks simultaneously. | Concurrency fan-out and worker onboarding costs. |
| **Scenario 3: Sequential Deep DAG** | 5-stage sequential pipeline ($T_1 \to T_2 \to T_3 \to T_4 \to T_5$). | Transitive dependency context accumulation ($\mathcal{O}(N^2)$ explosion). |
| **Scenario 4: Large Intermediate Result** | Upstream task produces a 2.5 KB raw data payload passed to downstream consumer. | Context envelope bloat from large intermediate outputs. |
| **Scenario 5: Worker Failure & Recovery** | Worker encounters a transient error, requiring retry and follow-up prompt. | Error handling and turn re-dispatch overhead. |

---

## 2. Empirical Benchmark Results

The following measurements were captured via deterministic evaluation in `benchmark-results.json`:

| Benchmark Scenario | Baseline Tokens | Normal Mode Tokens | Economy Mode Tokens | Economy Reduction vs. Baseline |
| :--- | :---: | :---: | :---: | :---: |
| **1. Small Self-Contained Task** | 791 | 767 | **313** | **-60.4%** |
| **2. Parallel Subtasks (4 workers)** | 3,228 | 3,228 | **1,376** | **-57.4%** |
| **3. Sequential Deep DAG (5 stages)** | 13,563 | 4,354 | **1,839** | **-86.4%** |
| **4. Large Intermediate Result** | 1,841 | 1,841 | **618** | **-66.4%** |
| **5. Worker Failure & Recovery** | 1,303 | 1,303 | **517** | **-60.3%** |
| **TOTAL AGGREGATE** | **20,726** | **11,493** | **4,663** | **-77.5%** |

### Visual Comparison

```
Baseline:      ████████████████████ (20,726 tokens)
Normal Mode:   ███████████          (11,493 tokens, -44.5%)
Economy Mode:  ████                 ( 4,663 tokens, -77.5%)
```

---

## 3. Analysis of Reductions

### 1. Sequential Deep DAG (-86.4% reduction)
The largest single reduction occurred in deep sequential dependency chains. In legacy orchestration, each downstream task re-ingested every upstream task's verbatim output. In a 5-stage pipeline, this resulted in 13,563 tokens consumed. By pruning indirect prerequisites to 100-character digests and bounding direct inputs to 500 characters, Economy Mode slashed consumption to **1,839 tokens**, saving **11,724 tokens** on that workload alone.

### 2. Prompt Overhead Elimination (-57.4% to -60.4% reduction)
In small tasks and parallel fan-outs, welcome prompts and task assignment instructions previously consumed over 1,450 characters per agent turn before any productive work occurred. Compressing the welcome prompt from 256 to 95 characters and the assignment prompt from 1,200 to ~160 characters eliminated the majority of static orchestration token waste.

### 3. Large Intermediate Result Passing (-66.4% reduction)
When upstream workers produce large raw datasets (e.g., raw logs or AST dumps), Economy Mode truncates oversized outputs to bounded envelopes (`ECONOMY_DEPENDENCY_OUTPUT_MAX_CHARS` = 500), forcing clean summarization and preventing runaway context costs.

---

## 4. How to Reproduce Benchmarks

### Running the Automated Benchmark
To run the automated benchmark and generate a fresh `benchmark-results.json`:

```bash
pnpm run benchmark:ascension
```

Or execute directly with Node.js:

```bash
node scripts/ascension-benchmark.mjs
```

### Running Verification Tests
The benchmark suite is verified alongside all unit and integration tests:

```bash
pnpm run verify:ascension
pnpm verify
```
