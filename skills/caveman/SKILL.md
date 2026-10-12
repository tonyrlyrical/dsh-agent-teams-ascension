---
name: caveman
description: Ultra-terse output brevity protocol for AI agents under Economy Mode. Slashes output tokens by stripping conversational filler while strictly preserving technical accuracy, negations, verbatim code, and file paths.
---

# Caveman Output Brevity Skill

Adapted under the Apache License, Version 2.0 from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman).
Copyright (c) Julius Brussee.

## Purpose

When running multi-agent orchestrations with DSH AgentTeams, verbose agent communication and conversational ceremony can consume 30% to 50% of the total output token budget.

The `caveman` skill enforces ultra-terse output formatting for internal subagents and captain reports under Economy Mode without sacrificing reasoning precision.

## Core Directives

1. **Answer First**: State the direct conclusion, status, or key finding on the first line. No greetings, throat-clearing, or introductory preamble.
2. **Zero Fluff**: Eliminate all polite conversational filler (e.g., *"Sure, I can help with that"*, *"Based on the requirements"*, *"Here is my analysis"*, *"In conclusion"*).
3. **Short Words**: Prefer concise vocabulary. Grammatical articles (*a*, *an*, *the*) are optional when context is clear.
4. **Factual Precision**: Strictly preserve all negations (*not*, *no*, *never*, *cannot*, *failed*) and logical operators. Factual and technical meaning must remain 100% faithful.
5. **Verbatim Code & Paths**: NEVER alter, truncate, or paraphrase source code, diffs, file paths, commands, parameters, regular expressions, or error messages.
6. **Quiet Tool Actions**: Execute tools directly without narrating intent beforehand.
7. **Format**: Use compact bullet lists, key-value fragments, or direct diff blocks.

## Examples

### Verbose (Before)
> Hello Captain! I have carefully investigated the failure in `test/auth.test.ts`. After reviewing the execution logs, it appears that the token expiration check in `src/auth.ts` was off by one second due to milliseconds rounding. I have made the necessary correction and re-run the tests. All 42 tests are now passing successfully! Let me know if you would like me to proceed with the next task.

### Caveman (After)
> Auth test fixed. Rounding bug in `src/auth.ts`: added `Math.floor()`. 42/42 tests pass. Ready for next task.

## Structural Proxy Integration

When bundled with the Caveman Proxy engine, large tabular data, test logs, and deep stack traces from tool invocations are automatically summarized and stored in content-addressable storage. Any agent can retrieve the exact byte-for-byte raw payload using the `agent_teams_recover_payload` tool with the provided recovery ID.
