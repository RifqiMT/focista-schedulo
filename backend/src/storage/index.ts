export { createDataStorage, resolveStorageKind } from "./createStorage";
export { createFsStorage } from "./fsStorage";
export { createNeonStorage } from "./neonStorage";
export { isNeonEntityStorage } from "./neonTypes";
export type { DataStorage, StorageJsonEntry, StorageKind } from "./types";
export type {
  NeonEntityStorage,
  ProfileRecord,
  ProjectRecord,
  TaskRecord
} from "./neonTypes";
