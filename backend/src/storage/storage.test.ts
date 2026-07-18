import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { createFsStorage } from "./fsStorage";
import { resolveStorageKind } from "./createStorage";

describe("resolveStorageKind", () => {
  it("defaults to fs without blob credentials", () => {
    expect(resolveStorageKind({})).toBe("fs");
  });

  it("auto-selects vercel-blob when BLOB_READ_WRITE_TOKEN is set", () => {
    expect(resolveStorageKind({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test" })).toBe(
      "vercel-blob"
    );
  });

  it("honors explicit fs even when a blob token exists", () => {
    expect(
      resolveStorageKind({
        STORAGE_BACKEND: "fs",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test"
      })
    ).toBe("fs");
  });

  it("rejects vercel-blob without credentials", () => {
    expect(() => resolveStorageKind({ STORAGE_BACKEND: "vercel-blob" })).toThrow(
      /BLOB_READ_WRITE_TOKEN/
    );
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
