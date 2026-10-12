/**
 * Caveman In-Process Proxy Compression Engine for AgentTeams.
 *
 * Implements structural compression for tool results, tabular CSVs, test logs,
 * stack traces and JSON diagnostics, with an in-process content-addressable
 * store for exact, byte-for-byte payload recovery.
 *
 * Inspired by JuliusBrussee/caveman (Apache-2.0).
 *
 * @module dsh-agent-teams/caveman/proxy-engine
 */
import { createHash, randomUUID } from 'node:crypto';
/**
 * In-process Content-Addressable Storage for uncompressed payloads.
 * Implements LRU eviction and memory bounds (max 50 MB, max 500 entries).
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
     * Stores a payload and returns a stable recovery ID.
     */
    storePayload(content, category) {
        const byteSize = Buffer.byteLength(content, 'utf8');
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
        };
        this.store.set(id, entry);
        this.totalBytes += byteSize;
        return id;
    }
    /**
     * Retrieves an exact original payload by recovery ID.
     */
    getPayload(id) {
        const entry = this.store.get(id);
        if (!entry)
            return undefined;
        // Check TTL
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.delete(id);
            return undefined;
        }
        // Refresh LRU order: delete and re-insert
        this.store.delete(id);
        this.store.set(id, entry);
        return entry.content;
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
function compressCsv(text) {
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
    // Sample top 2 rows and last 1 row
    const topRows = dataRows.slice(0, 2);
    const lastRow = dataRows[dataRows.length - 1];
    const parts = [
        `[CSV: ${totalRows} rows, ${columns.length} columns: ${columns.join(', ')}]`,
        `Row 1: ${topRows[0] ?? ''}`,
        ...topRows.slice(1).map((r, i) => `Row ${i + 2}: ${r}`),
    ];
    if (lastRow && totalRows > 2) {
        parts.push(`... [${totalRows - topRows.length - 1} rows elided] ...`);
        parts.push(`Row ${totalRows}: ${lastRow}`);
    }
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses test runner output (Node test runner, Jest, Mocha, Pytest, etc.).
 * Retains failures, test count summary, duration, and collapses passing lines.
 */
function compressTestLogs(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 8)
        return { compressed: text, savings: false };
    const hasTestSignals = lines.some(l => l.includes('✔') || l.includes('▶') || l.includes('✖') ||
        l.includes('pass') || l.includes('fail') || l.includes('tests ') ||
        l.includes('suites ') || l.includes('PASS') || l.includes('FAIL'));
    if (!hasTestSignals)
        return { compressed: text, savings: false };
    const failureLines = [];
    const summaryLines = [];
    let passingCount = 0;
    let isCapturingFailure = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isPassing = /^[ \t]*(✔|PASS|ok\b)/.test(line) && !line.includes('fail');
        const isFailing = /^[ \t]*(✖|FAIL|not ok\b)/.test(line) || line.toLowerCase().includes('failed:');
        const isSummary = /^[ \t]*(ℹ tests|ℹ pass|ℹ fail|ℹ suites|Tests:|Suites:|Summary:|duration_ms)/.test(line);
        if (isPassing) {
            passingCount++;
            isCapturingFailure = false;
            continue;
        }
        if (isFailing) {
            isCapturingFailure = true;
            failureLines.push(line);
            continue;
        }
        if (isSummary) {
            isCapturingFailure = false;
            summaryLines.push(line);
            continue;
        }
        if (isCapturingFailure) {
            // Capture stack trace or details belonging to failure
            if (line.trim().startsWith('at ') || line.trim().startsWith('Error:') || line.includes('assertion')) {
                failureLines.push(line);
            }
            else if (line.trim() === '') {
                isCapturingFailure = false;
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
        parts.push('Results:');
        parts.push(...summaryLines);
    }
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses deep stack traces.
 * Keeps error name, message, top 4 frames, collapses deep internal runtime frames.
 */
function compressStackTrace(text) {
    const lines = text.split(/\r?\n/);
    const stackIndices = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^[ \t]*at (?:.+ )?\(?.*:\d+:\d+\)?/.test(lines[i])) {
            stackIndices.push(i);
        }
    }
    if (stackIndices.length < 8)
        return { compressed: text, savings: false };
    const errorLine = lines[0] ?? 'Error';
    const topFrames = stackIndices.slice(0, 4).map(idx => lines[idx]);
    const elidedCount = stackIndices.length - 4;
    const parts = [
        errorLine,
        ...topFrames,
        `    ... [${elidedCount} internal runtime frames elided]`,
    ];
    const result = parts.join('\n');
    return { compressed: result, savings: result.length < text.length };
}
/**
 * Compresses verbose JSON arrays or large nested structures.
 */
function compressJson(text) {
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
            };
            const result = JSON.stringify(compressedObj, null, 2);
            return { compressed: result, savings: result.length < text.length };
        }
        if (typeof parsed === 'object' && parsed !== null) {
            let modified = false;
            const clone = { ...parsed };
            for (const [key, val] of Object.entries(clone)) {
                if (Array.isArray(val) && val.length > 5) {
                    clone[key] = {
                        _array_length: val.length,
                        sample: val.slice(0, 2),
                        omitted: val.length - 2,
                    };
                    modified = true;
                }
            }
            if (modified) {
                const result = JSON.stringify(clone, null, 2);
                return { compressed: result, savings: result.length < text.length };
            }
        }
    }
    catch {
        // Not valid JSON or parsing error, fallback
    }
    return { compressed: text, savings: false };
}
/**
 * Guard check: do not compress literal source code files.
 */
function isSourceCode(text) {
    // If the text looks like raw TypeScript, JavaScript or Python source code
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
    // If matches >= 2 and it's not a test runner or stack trace, consider it code
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
    const recoveryId = store.storePayload(rawText, category);
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
export function recoverPayload(recoveryId, store = defaultPayloadStore) {
    if (!recoveryId || typeof recoveryId !== 'string') {
        return { ok: false, error: 'recovery_id must be a non-empty string' };
    }
    const cleanId = recoveryId.trim();
    const content = store.getPayload(cleanId);
    if (content === undefined) {
        return {
            ok: false,
            error: `Recovery payload not found or expired for ID "${cleanId}". Original payloads have a 2-hour TTL.`,
        };
    }
    return {
        ok: true,
        content,
        originalBytes: Buffer.byteLength(content, 'utf8'),
    };
}
