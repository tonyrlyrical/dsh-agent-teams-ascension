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
/** Core system instructions for Caveman terse output formatting. */
export declare const CAVEMAN_PROMPT_INSTRUCTIONS: string;
/**
 * Returns prompt guidance for a task or member under Caveman Economy mode.
 */
export declare function formatCavemanInstruction(prefix?: string): string;
/**
 * Applies synthetic Caveman-style text compression for benchmarking and offline evaluations.
 * Preserves code blocks, paths, negations, and numbers while removing conversational filler.
 */
export declare function applySyntheticCavemanVoice(input: string): string;
