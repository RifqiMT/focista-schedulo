import type { DataStorage, StorageJsonEntry, StorageKind } from "./types";

/** Profile row matching ProfileSchema field names in API memory. */
export type ProfileRecord = {
  id: string;
  name: string;
  title: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  profileId?: string | null;
};

/** Full task document (TaskSchema). Stored as tasks.payload jsonb. */
export type TaskRecord = Record<string, unknown> & {
  id: string;
  completed: boolean;
};

export type NeonEntityStorage = DataStorage & {
  readonly kind: "neon";
  loadProfiles(): Promise<ProfileRecord[]>;
  loadProjects(): Promise<ProjectRecord[]>;
  loadTasks(): Promise<TaskRecord[]>;
  replaceProfiles(rows: ProfileRecord[]): Promise<void>;
  replaceProjects(rows: ProjectRecord[]): Promise<void>;
  /** Full rebuild (import / repair). */
  replaceAllTasks(rows: TaskRecord[]): Promise<void>;
  upsertTasks(rows: TaskRecord[]): Promise<void>;
  deleteTasks(ids: string[]): Promise<void>;
  getTasksRevision(): Promise<number>;
  putTransferStaging(pathname: string, content: string, ttlHours?: number): Promise<void>;
  /**
   * Store one binary chunk (base64 in staging row). When index === total-1, assemble
   * UTF-8 content at `pathname` and delete chunk rows.
   */
  putTransferStagingChunk(
    pathname: string,
    index: number,
    total: number,
    chunk: Buffer,
    ttlHours?: number
  ): Promise<{ complete: boolean; byteLength: number }>;
  readTransferStaging(pathname: string): Promise<string | null>;
  deleteTransferStaging(pathname: string): Promise<void>;
  pruneExpiredTransferStaging(): Promise<number>;
};

export function isNeonEntityStorage(storage: DataStorage): storage is NeonEntityStorage {
  return storage.kind === "neon";
}

export type { DataStorage, StorageJsonEntry, StorageKind };
