/**
 * Caveman In-Process Proxy Compression Engine for AgentTeams.
 *
 * Implements structural compression for tool results, tabular CSVs, test logs,
 * stack traces and JSON diagnostics, with an in-process content-addressable
 * store and optional disk persistence for exact, byte-for-byte payload recovery.
 *
 * Inspired by the brevity philosophy of JuliusBrussee/caveman (Apache-2.0).
 *
 * @module dsh-agent-teams/caveman/proxy-engine
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function sanitizePayloadId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
/**
 * In-process Content-Addressable Storage for uncompressed payloads.
 * Implements LRU eviction, memory bounds (max 50 MB, max 500 entries),
 * and disk-backed persistence for cross-restart survivability.
 */
export class CavemanPayloadStore {
    store = new Map();
    totalBytes = 0;
    maxEntries;
    maxTotalBytes;
    ttlMs;
    constructor(options) {
        this.maxEntries = options?.maxEntries ?? 500;
        this.maxTotalBytes = options?.maxTotalBytes ?? 50 * 1024 * 1024; // 50 MB
        this.ttlMs = options?.ttlMs ?? 2 * 60 * 60 * 1000; // 2 hours
    }
    /**
     * Stores a payload and returns a stable recovery ID, or null if capacity exceeded.
     */
    storePayload(content, category, options) {
        const byteSize = Buffer.byteLength(content, 'utf8');
        // Single payload exceeding maximum store capacity is rejected to protect heap
        if (byteSize > this.maxTotalBytes) {
            return null;
        }
        const hashPrefix = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12);
        const id = `caveman-rec:${hashPrefix}-${randomUUID().slice(0, 8)}`;
        // Evict expired or overflow entries
        this.evictIfNeeded(byteSize);
        const entry = {
            id,
            content,
            createdAt: Date.now(),
            byteSize,
            category,
            teamId: options?.teamId,
        };
        this.store.set(id, entry);
        this.totalBytes += byteSize;
        // Disk-backed persistence for restart recovery
        if (options?.stateRoot && options?.teamId) {
            try {
                const teamDir = join(options.stateRoot, options.teamId, '.caveman-payloads');
                mkdirSync(teamDir, { recursive: true });
                const filePath = join(teamDir, `${sanitizePayloadId(id)}.json`);
                writeFileSync(filePath, JSON.stringify(entry), 'utf8');
            }
            catch {
                // Disk persistence is best-effort; in-memory cache remains available
            }
        }
        return id;
    }
    /**
     * Retrieves an exact original payload by recovery ID, with team isolation and disk fallback.
     */
    getPayload(id, options) {
        if (!id || typeof id !== 'string') {
            return { ok: false, error: 'recovery_id must be a non-empty string' };
        }
        const cleanId = id.trim();
        // 1. Check in-memory store
        const entry = this.store.get(cleanId);
        if (entry) {
            // Check TTL
            if (Date.now() - entry.createdAt > this.ttlMs) {
                this.delete(cleanId);
            }
            else {
                // Team isolation check
                if (entry.teamId && options?.teamId && entry.teamId !== options.teamId) {
                    return { ok: false, error: `Unauthorized: payload ${cleanId} belongs to another team` };
                }
                // Refresh LRU order: delete and re-insert
                this.store.delete(cleanId);
                this.store.set(cleanId, entry);
                return { ok: true, content: entry.content, originalBytes: entry.byteSize };
            }
        }
        // 2. Check disk persistence fallback
        if (options?.stateRoot && options?.teamId) {
            try {
                const filePath = join(options.stateRoot, options.teamId, '.caveman-payloads', `${sanitizePayloadId(cleanId)}.json`);
                if (existsSync(filePath)) {
                    const raw = readFileSync(filePath, 'utf8');
                    const diskEntry = JSON.parse(raw);
                    if (diskEntry && diskEntry.content !== undefined) {
                        if (diskEntry.teamId && options.teamId && diskEntry.teamId !== options.teamId) {
                            return { ok: false, error: `Unauthorized: payload ${cleanId} belongs to another team` };
                        }
                        // Re-populate in-memory cache
                        if (diskEntry.byteSize <= this.maxTotalBytes) {
                            this.evictIfNeeded(diskEntry.byteSize);
                            this.store.set(cleanId, diskEntry);
                            this.totalBytes += diskEntry.byteSize;
                        }
                        return { ok: true, content: diskEntry.content, originalBytes: diskEntry.byteSize };
                    }
                }
            }
            catch {
                // Disk read failure falls through
            }
        }
        return {
            ok: false,
            error: `Recovery payload not found or expired for ID "${cleanId}". Original payloads are retained for 2 hours.`,
        };
    }
    /**
     * Checks if an ID exists in the store without evicting.
     */
    has(id) {
        const entry = this.store.get(id);
        if (!entry)
            return false;
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.delete(id);
            return false;
        }
        return true;
    }
    /**
     * Deletes one payload by ID.
     */
    delete(id) {
        const entry = this.store.get(id);
        if (!entry)
            return false;
        this.totalBytes -= entry.byteSize;
        return this.store.delete(id);
    }
    /**
     * Clears the entire store.
     */
    clear() {
        this.store.clear();
        this.totalBytes = 0;
    }
    /**
     * Returns current storage telemetry.
     */
    stats() {
        return {
            count: this.store.size,
            totalBytes: this.totalBytes,
            maxEntries: this.maxEntries,
            maxTotalBytes: this.maxTotalBytes,
        };
    }
    evictIfNeeded(incomingBytes) {
        const now = Date.now();
        // 1. Evict expired entries
        for (const [id, entry] of this.store.entries()) {
            if (now - entry.createdAt > this.ttlMs) {
                this.totalBytes -= entry.byteSize;
                this.store.delete(id);
            }
        }
        // 2. Evict oldest entries until within caps
        while ((this.store.size >= this.maxEntries || this.totalBytes + incomingBytes > this.maxTotalBytes) &&
            this.store.size > 0) {
            const oldestKey = this.store.keys().next().value;
            if (!oldestKey)
                break;
            const oldest = this.store.get(oldestKey);
            if (oldest) {
                this.totalBytes -= oldest.byteSize;
                this.store.delete(oldestKey);
            }
        }
    }
}
/** Global singleton payload store. */
export const defaultPayloadStore = new CavemanPayloadStore();
/**
 * Structural compressors
 */
/**
 * Compresses CSV or TSV data.
 * Keeps column headers, row counts, sample data, and numeric range summaries.
 */
export function compressCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 6)
        return { compressed: text, savings: false };
    const header = lines[0];
    const delimiter = header.includes('\t') ? '\t' : (header.includes(',') ? ',' : null);
    if (!delimiter)
        return { compressed: text, savings: false };
    const columns = header.split(delimiter).map(c => c.trim());
    if (columns.length < 2)
        return { compressed: text, savings: false };
    const dataRows = lines.slice(1).filter(l => l.trim() !== '');
    const totalRows = dataRows.length;
    if (totalRows < 5)
        return { compressed: text, savings: false };
    // Sample top 3 rows and last 1 row
    const topRows = dataRows.slice(0, 3);
    const lastRow = dataRows[dataRows.length - 1];
    const parts = [
        `[CSV: ${totalRows} rows, ${columns.length} columns: ${columns.join(', ')}]`,
        `Row 1: ${topRows[0] ?? ''}`,
        ...topRows.slice(1).map((r, i) => `Row ${i + 2}: ${r}`),
    ];
    if (lastRow && totalRows > 3) {
        parts.push(`... [${totalRows - topRows.length - 1} rows elided; use agent_teams_recover_payload for all rows] ...`);
        parts.push(`Row ${totalRows}: ${lastRow}`);
    }
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses test runner output (Node test runner, Jest, Mocha, Pytest, Vitest, etc.).
 * Retains failures, test count summary, duration, and collapses passing lines.
 */
export function compressTestLogs(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 6)
        return { compressed: text, savings: false };
    const hasTestSignals = lines.some(l => l.includes('✔') || l.includes('▶') || l.includes('✖') ||
        l.includes('pass') || l.includes('fail') || l.includes('tests ') ||
        l.includes('suites ') || l.includes('PASS') || l.includes('FAIL') ||
        /assertion(?:error)?/i.test(l));
    if (!hasTestSignals)
        return { compressed: text, savings: false };
    const failureLines = [];
    const summaryLines = [];
    let passingCount = 0;
    let isCapturingFailure = false;
    let consecutiveBlankLines = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isPassing = /^[ \t]*(✔|PASS|ok\b)/.test(line) && !line.toLowerCase().includes('fail');
        const isFailing = /^[ \t]*(✖|FAIL|not ok\b)/.test(line) ||
            /\b(failed|failure|assertionerror|assertion error)\b/i.test(line) ||
            line.trim().startsWith('● ') ||
            /^[0-9]+\)\s+/.test(line.trim());
        const isSummary = /^[ \t]*(ℹ tests|ℹ pass|ℹ fail|ℹ suites|Tests:|Suites:|Summary:|duration_ms|Time:|Ran all test)/i.test(line);
        if (isSummary) {
            isCapturingFailure = false;
            summaryLines.push(line);
            continue;
        }
        if (isPassing) {
            passingCount++;
            isCapturingFailure = false;
            consecutiveBlankLines = 0;
            continue;
        }
        if (isFailing) {
            isCapturingFailure = true;
            consecutiveBlankLines = 0;
            failureLines.push(line);
            continue;
        }
        if (isCapturingFailure) {
            if (line.trim() === '') {
                consecutiveBlankLines++;
                if (consecutiveBlankLines <= 2) {
                    failureLines.push(line);
                }
                else {
                    isCapturingFailure = false;
                }
            }
            else {
                consecutiveBlankLines = 0;
                failureLines.push(line);
            }
        }
    }
    if (passingCount === 0 && failureLines.length === 0 && summaryLines.length === 0) {
        return { compressed: text, savings: false };
    }
    const parts = [];
    if (passingCount > 0) {
        parts.push(`[Test Log Summary: ${passingCount} passing test(s) elided]`);
    }
    if (failureLines.length > 0) {
        parts.push('Failures & Errors:');
        parts.push(...failureLines);
    }
    if (summaryLines.length > 0) {
        parts.push(...summaryLines);
    }
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses deep stack traces.
 * Keeps all error headers before the first stack frame, top 5 frames, and the bottom-most frame.
 */
export function compressStackTrace(text) {
    const lines = text.split(/\r?\n/);
    const firstFrameIndex = lines.findIndex(l => /^[ \t]*at (?:.+ )?\(?.*:\d+:\d+\)?/.test(l));
    if (firstFrameIndex === -1)
        return { compressed: text, savings: false };
    const stackIndices = [];
    for (let i = firstFrameIndex; i < lines.length; i++) {
        if (/^[ \t]*at (?:.+ )?\(?.*:\d+:\d+\)?/.test(lines[i])) {
            stackIndices.push(i);
        }
    }
    if (stackIndices.length < 7)
        return { compressed: text, savings: false };
    // Preserve all header lines prior to the first frame (error type, message, diff, causation)
    const headerLines = lines.slice(0, firstFrameIndex).filter(l => l.trim() !== '');
    const errorHeader = headerLines.length > 0 ? headerLines.join('\n') : (lines[0] ?? 'Error');
    const topFrames = stackIndices.slice(0, 5).map(idx => lines[idx]);
    const bottomFrame = lines[stackIndices[stackIndices.length - 1]];
    const elidedCount = stackIndices.length - 6;
    const parts = [
        errorHeader,
        ...topFrames,
    ];
    if (elidedCount > 0) {
        parts.push(`    ... [${elidedCount} internal runtime frames elided]`);
        parts.push(bottomFrame);
    }
    else if (stackIndices.length > 5) {
        parts.push(bottomFrame);
    }
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses verbose JSON arrays or large nested structures.
 */
export function compressJson(text) {
    const trimmed = text.trim();
    if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
        return { compressed: text, savings: false };
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 5) {
            const sample = parsed.slice(0, 2);
            const compressedObj = {
                _caveman_array_summary: true,
                total_items: parsed.length,
                sample_items: sample,
                omitted_count: parsed.length - sample.length,
                note: 'Full JSON array recoverable with agent_teams_recover_payload',
            };
            const result = JSON.stringify(compressedObj, null, 2);
            return { compressed: result, savings: result.length < text.length };
        }
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            let modified = false;
            const compressedObj = {};
            for (const [key, val] of Object.entries(parsed)) {
                if (Array.isArray(val) && val.length > 8) {
                    compressedObj[key] = {
                        _caveman_array_summary: true,
                        total_items: val.length,
                        sample_items: val.slice(0, 2),
                        omitted_count: val.length - 2,
                    };
                    modified = true;
                }
                else {
                    compressedObj[key] = val;
                }
            }
            if (modified) {
                const result = JSON.stringify(compressedObj, null, 2);
                return { compressed: result, savings: result.length < text.length };
            }
        }
    }
    catch {
        // Invalid JSON, do not compress
    }
    return { compressed: text, savings: false };
}
/**
 * Guard check: do not compress literal source code files.
 */
function isSourceCode(text) {
    const codeKeywords = [
        /\bimport\s+.*\s+from\s+['"].*['"]/,
        /\bexport\s+(?:default\s+)?(?:function|class|const|interface|type)\b/,
        /\bfunction\s+[a-zA-Z0-9_$]+\s*\(/,
        /\bclass\s+[a-zA-Z0-9_$]+(?:\s+extends|\s+implements|\s*\{)/,
        /\bdef\s+[a-zA-Z0-9_$]+\s*\(.*?\):/,
    ];
    let matches = 0;
    for (const regex of codeKeywords) {
        if (regex.test(text))
            matches++;
    }
    return matches >= 2 && !text.includes('✔') && !text.includes('FAIL') && !text.includes('at ');
}
/**
 * Main compression entry point for tool execution outputs and external observations.
 */
export function compressPayload(rawText, options, store = defaultPayloadStore) {
    const minBytes = options?.minBytes ?? 300;
    const minSavings = options?.minSavingsPercent ?? 15;
    const originalBytes = Buffer.byteLength(rawText, 'utf8');
    if (!rawText || originalBytes < minBytes) {
        return {
            text: rawText,
            wasCompressed: false,
            originalBytes,
            compressedBytes: originalBytes,
            savingsPercent: 0,
        };
    }
    // Reject single payload exceeding total store capacity
    if (originalBytes > (store.stats().maxTotalBytes ?? 50 * 1024 * 1024)) {
        return {
            text: rawText,
            wasCompressed: false,
            originalBytes,
            compressedBytes: originalBytes,
            savingsPercent: 0,
        };
    }
    // Guard: Never compress source code
    if (isSourceCode(rawText)) {
        return {
            text: rawText,
            wasCompressed: false,
            originalBytes,
            compressedBytes: originalBytes,
            savingsPercent: 0,
        };
    }
    let compressed = rawText;
    let category = undefined;
    // 1. Try CSV compression
    const csvRes = compressCsv(rawText);
    if (csvRes.savings) {
        compressed = csvRes.compressed;
        category = 'csv';
    }
    else {
        // 2. Try Test logs compression
        const testRes = compressTestLogs(rawText);
        if (testRes.savings) {
            compressed = testRes.compressed;
            category = 'test_logs';
        }
        else {
            // 3. Try Stack trace compression
            const stackRes = compressStackTrace(rawText);
            if (stackRes.savings) {
                compressed = stackRes.compressed;
                category = 'stack_trace';
            }
            else {
                // 4. Try JSON compression
                const jsonRes = compressJson(rawText);
                if (jsonRes.savings) {
                    compressed = jsonRes.compressed;
                    category = 'json';
                }
            }
        }
    }
    const compressedBytes = Buffer.byteLength(compressed, 'utf8');
    const savingsPercent = Math.max(0, Math.round(((originalBytes - compressedBytes) / originalBytes) * 100));
    if (!category || (savingsPercent < minSavings && !options?.force)) {
        return {
            text: rawText,
            wasCompressed: false,
            originalBytes,
            compressedBytes: originalBytes,
            savingsPercent: 0,
        };
    }
    // Store original payload in store
    const recoveryId = store.storePayload(rawText, category, {
        teamId: options?.teamId,
        stateRoot: options?.stateRoot,
    });
    if (!recoveryId) {
        return {
            text: rawText,
            wasCompressed: false,
            originalBytes,
            compressedBytes: originalBytes,
            savingsPercent: 0,
        };
    }
    // Append clean recovery handle
    const footer = `\n\n[caveman-proxy: compressed ${originalBytes}B -> ${compressedBytes}B (${savingsPercent}% saved). Full payload recoverable with tool agent_teams_recover_payload using recovery_id="${recoveryId}"]`;
    const finalCompressedText = compressed + footer;
    const finalCompressedBytes = Buffer.byteLength(finalCompressedText, 'utf8');
    const finalSavings = Math.max(0, Math.round(((originalBytes - finalCompressedBytes) / originalBytes) * 100));
    return {
        text: finalCompressedText,
        wasCompressed: true,
        recoveryId,
        originalBytes,
        compressedBytes: finalCompressedBytes,
        savingsPercent: finalSavings,
        category,
    };
}
/**
 * Retrieves the exact, unmodified original payload by recovery ID.
 */
export function recoverPayload(recoveryId, store = defaultPayloadStore, options) {
    return store.getPayload(recoveryId, options);
}
