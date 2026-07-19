import { describe, expect, it } from "vitest";
import { createDataStorage } from "./storage/createStorage";

/**
 * Completion toggles must flush before the HTTP response returns on Vercel.
 * A non-zero debounce is unsafe: serverless freezes pending timers after respond.
 */
describe("task complete persist durability", () => {
  it("uses zero debounce on Neon when VERCEL is set so await persistTasks flushes immediately", () => {
    const storage = createDataStorage({
      env: {
        STORAGE_BACKEND: "neon",
        DATABASE_URL: "postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require",
        VERCEL: "1"
      }
    });
    expect(storage.kind).toBe("neon");
    expect(storage.persistDebounceMs).toBe(0);
  });

  it("keeps a positive debounce for Neon outside Vercel (long-running Node)", () => {
    const storage = createDataStorage({
      env: {
        STORAGE_BACKEND: "neon",
        DATABASE_URL: "postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require"
      }
    });
    expect(storage.kind).toBe("neon");
    expect(storage.persistDebounceMs).toBeGreaterThan(0);
  });
});
