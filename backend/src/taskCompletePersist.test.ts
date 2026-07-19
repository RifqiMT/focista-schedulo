import { describe, expect, it } from "vitest";
import { createDataStorage } from "./storage/createStorage";

/**
 * Completion toggles must flush before the HTTP response returns on Vercel.
 * A non-zero debounce is unsafe: serverless freezes pending timers after respond.
 */
describe("task complete persist durability", () => {
  it("uses zero debounce on Vercel Blob so await persistTasks flushes immediately", () => {
    const storage = createDataStorage({
      env: {
        STORAGE_BACKEND: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
        VERCEL: "1"
      }
    });
    expect(storage.kind).toBe("vercel-blob");
    expect(storage.persistDebounceMs).toBe(0);
  });

  it("keeps a positive debounce for Blob outside Vercel (long-running Node)", () => {
    const storage = createDataStorage({
      env: {
        STORAGE_BACKEND: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token"
      }
    });
    expect(storage.kind).toBe("vercel-blob");
    expect(storage.persistDebounceMs).toBeGreaterThan(0);
  });
});
