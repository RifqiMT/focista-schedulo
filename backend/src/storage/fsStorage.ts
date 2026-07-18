import { promises as fs } from "fs";
import { watch as fsWatch } from "fs";
import path from "path";
import type { DataStorage, StorageJsonEntry } from "./types";

export function createFsStorage(dataDir: string): DataStorage {
  return {
    kind: "fs",
    persistDebounceMs: 40,

    async ensureReady() {
      await fs.mkdir(dataDir, { recursive: true });
    },

    async readText(name: string) {
      try {
        return await fs.readFile(path.join(dataDir, name), "utf8");
      } catch {
        return null;
      }
    },

    async writeText(name: string, content: string) {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, name), content, "utf8");
    },

    async listSyncJsonEntries() {
      const entries = await fs.readdir(dataDir).catch(() => [] as string[]);
      const jsonFiles = entries.filter((n) => {
        const lower = n.toLowerCase();
        return lower.endsWith(".json") && lower !== "focista-unified-data.json";
      });
      const fileMetas = await Promise.all(
        jsonFiles.map(async (name) => {
          const full = path.join(dataDir, name);
          const st = await fs.stat(full).catch(() => null);
          return st ? ({ name, mtimeMs: st.mtimeMs } satisfies StorageJsonEntry) : null;
        })
      );
      return fileMetas
        .filter((x): x is StorageJsonEntry => Boolean(x))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
    },

    watchJsonChanges(onChange) {
      fsWatch(dataDir, { persistent: true }, (_eventType, filename) => {
        const name = typeof filename === "string" ? filename : "";
        if (!name.endsWith(".json")) return;
        onChange(name);
      });
    }
  };
}
