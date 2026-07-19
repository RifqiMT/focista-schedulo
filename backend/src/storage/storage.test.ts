import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { createFsStorage } from "./fsStorage";
import { resolveStorageKind } from "./createStorage";

describe("resolveStorageKind", () => {
  it("defaults to fs without database url", () => {
    expect(resolveStorageKind({})).toBe("fs");
  });

  it("auto-selects neon when DATABASE_URL is set", () => {
    expect(
      resolveStorageKind({
        DATABASE_URL: "postgresql://user:pass@ep-test.neon.tech/neondb"
      })
    ).toBe("neon");
  });

  it("accepts POSTGRES_URL from Vercel Neon integration", () => {
    expect(
      resolveStorageKind({
        POSTGRES_URL: "postgresql://user:pass@ep-test.neon.tech/neondb"
      })
    ).toBe("neon");
  });

  it("on Vercel prefers neon over stale STORAGE_BACKEND=fs when DB URL exists", () => {
    expect(
      resolveStorageKind({
        VERCEL: "1",
        STORAGE_BACKEND: "fs",
        DATABASE_URL: "postgresql://user:pass@ep-test.neon.tech/neondb"
      })
    ).toBe("neon");
  });

  it("honors explicit fs when DATABASE_URL exists off Vercel", () => {
    expect(
      resolveStorageKind({
        STORAGE_BACKEND: "fs",
        DATABASE_URL: "postgresql://user:pass@ep-test.neon.tech/neondb"
      })
    ).toBe("fs");
  });

  it("rejects neon without DATABASE_URL", () => {
    expect(() => resolveStorageKind({ STORAGE_BACKEND: "neon" })).toThrow(/DATABASE_URL/);
  });

  it("rejects legacy vercel-blob backend", () => {
    expect(() =>
      resolveStorageKind({
        STORAGE_BACKEND: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test"
      })
    ).toThrow(/no longer supported/);
  });

  it("rejects unknown storage backends", () => {
    expect(() => resolveStorageKind({ STORAGE_BACKEND: "redis" })).toThrow(/Unknown STORAGE_BACKEND/);
  });
});

describe("createFsStorage", () => {
  it("reads and writes runtime JSON files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "focista-fs-storage-"));
    const storage = createFsStorage(dir);
    await storage.ensureReady();
    await storage.writeText("tasks.runtime.json", '[{"id":"T1"}]');
    const raw = await storage.readText("tasks.runtime.json");
    expect(raw).toBe('[{"id":"T1"}]');
    expect(await storage.readText("missing.json")).toBeNull();
  });

  it("lists sync JSON entries excluding unified snapshot", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "focista-fs-list-"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "tasks.runtime.json"), "[]", "utf8");
    await writeFile(path.join(dir, "focista-unified-data.json"), "{}", "utf8");
    const storage = createFsStorage(dir);
    const entries = await storage.listSyncJsonEntries();
    expect(entries.map((e) => e.name)).toEqual(["tasks.runtime.json"]);
    const onDisk = await readFile(path.join(dir, "tasks.runtime.json"), "utf8");
    expect(onDisk).toBe("[]");
  });
});
