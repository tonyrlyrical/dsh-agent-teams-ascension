/**
 * Caveman Output Brevity Rules for AgentTeams Ascension.
 *
 * Provides concise prompt guidance and terse output constraints for
 * multi-agent orchestration under Economy Mode.
 *
 * Adapted under the Apache License, Version 2.0.
 * Original project: JuliusBrussee/caveman (https://github.com/JuliusBrussee/caveman)
 * Copyright (c) Julius Brussee.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @module dsh-agent-teams/caveman/rules
 */
/** Detailed system instructions for Caveman terse output formatting. */
export const CAVEMAN_PROMPT_INSTRUCTIONS = `
[Economy Mode - Caveman Output Brevity Protocol]
1. Answer First: State conclusion, key fact or status directly on the first line. No greetings, no preamble.
2. Zero Fluff: Eliminate conversational filler, pleasantries, throat-clearing, and polite closings.
3. Short Words: Prefer short, direct words. Articles (a, an, the) are optional when context is clear.
4. Factual Precision: Strictly preserve all negations (not, no, never, cannot, failed) and technical accuracy.
5. Verbatim Code & Paths: NEVER truncate or alter source code snippets, file paths, commands, parameters, identifiers, or error messages.
6. Quiet Tool Actions: Do not announce tool invocations in advance. Execute tools directly.
7. Format: Use compact bullet points or direct key-value fragments.
`.trim();
/**
 * Ultra-low-overhead directive (~24 tokens / 95 chars) for recurring task ticket injection.
 * Prevents input prompt inflation on short tasks while enforcing identical brevity.
 */
export const CAVEMAN_COMPACT_DIRECTIVE = '[Brevity: Answer directly line 1. Zero filler/fluff. Code, paths, and errors verbatim.]';
/**
 * Returns prompt guidance for a task or member under Caveman Economy mode.
 */
export function formatCavemanInstruction(prefix, compact = false) {
    const instruction = compact ? CAVEMAN_COMPACT_DIRECTIVE : CAVEMAN_PROMPT_INSTRUCTIONS;
    if (!prefix)
        return instruction;
    return `${prefix}\n\n${instruction}`;
}
/**
 * Applies synthetic Caveman-style text compression for benchmarking and offline evaluations.
 * Preserves code blocks, paths, negations, and numbers while removing conversational filler.
 */
export function applySyntheticCavemanVoice(input) {
    if (!input || input.trim() === '')
        return input;
    // Protect code blocks (markdown ``` ... ```)
    const codeBlocks = [];
    const protectedText = input.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `__CAVEMAN_CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    // Eliminate common conversational filler phrases
    let compressed = protectedText
        .replace(/^(hello|hi|greetings|dear user|hey there)[,.! ]*/gim, '')
        .replace(/(i hope this helps|let me know if you need anything else|have a great day|best regards|cheers)[.!]*/gim, '')
        .replace(/(certainly!|sure,|of course,|as requested,|based on my analysis,|in conclusion,|to summarize,)/gim, '')
        .replace(/(i would be happy to help|here is the result of the|let's get started|as an ai assistant,?)/gim, '')
        .replace(/please note that\s+/gim, 'Note: ')
        .replace(/it is important to remember that\s+/gim, 'Note: ')
        .replace(/in order to\s+/gim, 'to ')
        .replace(/\b(basically|actually|essentially|literally|kind of|sort of)\b\s*/gim, '');
    // Collapse multiple blank lines
    compressed = compressed.replace(/\n{3,}/g, '\n\n').trim();
    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
        compressed = compressed.replace(`__CAVEMAN_CODE_BLOCK_${i}__`, codeBlocks[i]);
    }
    return compressed;
}
