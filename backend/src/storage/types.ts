export type StorageKind = "fs" | "neon";

export type StorageJsonEntry = {
  name: string;
  mtimeMs: number;
};

export type DataStorage = {
  readonly kind: StorageKind;
  /** Longer debounce for remote stores to protect free-tier write quotas. */
  readonly persistDebounceMs: number;
  ensureReady(): Promise<void>;
  readText(name: string): Promise<string | null>;
  writeText(name: string, content: string): Promise<void>;
  /**
   * List JSON objects for sync-from-data (excludes the unified interchange snapshot).
   * Names are basenames (e.g. tasks.runtime.json).
   */
  listSyncJsonEntries(): Promise<StorageJsonEntry[]>;
  /** Local-dev hot reload only; no-op / unsupported for Neon. */
  watchJsonChanges?(onChange: (filename: string) => void): void;
};
