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
/** Configuration options for payload compression. */
export interface CompressionOptions {
    /** Minimum bytes before attempting compression. Default: 300. */
    minBytes?: number;
    /** Minimum reduction percentage required to accept compression. Default: 15. */
    minSavingsPercent?: number;
    /** Force compression even if savings are marginal. Default: false. */
    force?: boolean;
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
 * Implements LRU eviction and memory bounds (max 50 MB, max 500 entries).
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
     * Stores a payload and returns a stable recovery ID.
     */
    storePayload(content: string, category: string): string;
    /**
     * Retrieves an exact original payload by recovery ID.
     */
    getPayload(id: string): string | undefined;
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
 * Main compression entry point for tool execution outputs and external observations.
 */
export declare function compressPayload(rawText: string, options?: CompressionOptions, store?: CavemanPayloadStore): CompressionResult;
/**
 * Retrieves the exact, unmodified original payload by recovery ID.
 */
export declare function recoverPayload(recoveryId: string, store?: CavemanPayloadStore): {
    ok: boolean;
    content?: string;
    originalBytes?: number;
    error?: string;
};
