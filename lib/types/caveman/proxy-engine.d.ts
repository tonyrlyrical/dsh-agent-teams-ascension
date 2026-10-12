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
/** Configuration options for payload compression. */
export interface CompressionOptions {
    /** Minimum bytes before attempting compression. Default: 300. */
    minBytes?: number;
    /** Minimum reduction percentage required to accept compression. Default: 15. */
    minSavingsPercent?: number;
    /** Force compression even if savings are marginal. Default: false. */
    force?: boolean;
    /** Team ID to associate this payload with for session isolation. */
    teamId?: string;
    /** State root directory for disk-backed persistence. */
    stateRoot?: string;
}
/** Options for payload recovery. */
export interface RecoveryOptions {
    /** Team ID to verify caller belongs to the same team. */
    teamId?: string;
    /** State root directory to look for disk-persisted payload if memory cache misses. */
    stateRoot?: string;
}
/** Result of a payload compression attempt. */
export interface CompressionResult {
    /** Resulting text (either compressed or original). */
    text: string;
    /** Whether the text was actually compressed. */
    wasCompressed: boolean;
    /** Opaque recovery ID for retrieving the original payload. */
    recoveryId?: string;
    /** Original uncompressed size in bytes (UTF-8). */
    originalBytes: number;
    /** Resulting size in bytes (UTF-8). */
    compressedBytes: number;
    /** Percentage of bytes saved (0 - 100). */
    savingsPercent: number;
    /** Category of structural compression applied. */
    category?: 'csv' | 'test_logs' | 'stack_trace' | 'json' | 'generic';
}
/**
 * In-process Content-Addressable Storage for uncompressed payloads.
 * Implements LRU eviction, memory bounds (max 50 MB, max 500 entries),
 * and disk-backed persistence for cross-restart survivability.
 */
export declare class CavemanPayloadStore {
    private readonly store;
    private totalBytes;
    private readonly maxEntries;
    private readonly maxTotalBytes;
    private readonly ttlMs;
    constructor(options?: {
        maxEntries?: number;
        maxTotalBytes?: number;
        ttlMs?: number;
    });
    /**
     * Stores a payload and returns a stable recovery ID, or null if capacity exceeded.
     */
    storePayload(content: string, category: string, options?: {
        teamId?: string;
        stateRoot?: string;
    }): string | null;
    /**
     * Retrieves an exact original payload by recovery ID, with team isolation and disk fallback.
     * Fails closed if the payload belongs to a team and caller team context is absent or mismatched.
     */
    getPayload(id: string, options?: RecoveryOptions): {
        ok: boolean;
        content?: string;
        originalBytes?: number;
        error?: string;
    };
    /**
     * Checks if an ID exists in the store without evicting.
     */
    has(id: string): boolean;
    /**
     * Deletes one payload by ID.
     */
    delete(id: string): boolean;
    /**
     * Clears the entire store.
     */
    clear(): void;
    /**
     * Returns current storage telemetry.
     */
    stats(): {
        count: number;
        totalBytes: number;
        maxEntries: number;
        maxTotalBytes: number;
    };
    private evictIfNeeded;
}
/** Global singleton payload store. */
export declare const defaultPayloadStore: CavemanPayloadStore;
/**
 * Structural compressors
 */
/**
 * Compresses CSV or TSV data.
 * Keeps column headers, row counts, sample data, and numeric range summaries.
 */
export declare function compressCsv(text: string): {
    compressed: string;
    savings: boolean;
};
/**
 * Compresses test runner output (Node test runner, Jest, Mocha, Pytest, Vitest, etc.).
 * Retains failures, test count summary, duration, and collapses passing lines.
 */
export declare function compressTestLogs(text: string): {
    compressed: string;
    savings: boolean;
};
/**
 * Compresses deep stack traces.
 * Keeps all error headers before the first stack frame, top 5 frames, and the bottom-most frame.
 */
export declare function compressStackTrace(text: string): {
    compressed: string;
    savings: boolean;
};
/**
 * Compresses verbose JSON arrays or large nested structures.
 */
export declare function compressJson(text: string): {
    compressed: string;
    savings: boolean;
};
/**
 * Main compression entry point for tool execution outputs and external observations.
 */
export declare function compressPayload(rawText: string, options?: CompressionOptions, store?: CavemanPayloadStore): CompressionResult;
/**
 * Retrieves the exact, unmodified original payload by recovery ID.
 */
export declare function recoverPayload(recoveryId: string, store?: CavemanPayloadStore, options?: RecoveryOptions): {
    ok: boolean;
    content?: string;
    originalBytes?: number;
    error?: string;
};
