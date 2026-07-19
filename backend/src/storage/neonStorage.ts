import type { StorageJsonEntry } from "./types";
import {
  ensureNeonMigrations,
  getSharedNeonSql,
  type NeonSql
} from "./neonClient";
import type {
  NeonEntityStorage,
  ProfileRecord,
  ProjectRecord,
  TaskRecord
} from "./neonTypes";
import {
  assembleTransferChunks,
  transferChunkPathname
} from "../transferStaging";

const TASKS_FILE = "tasks.runtime.json";
const PROJECTS_FILE = "projects.runtime.json";
const PROFILES_FILE = "profiles.runtime.json";

export type NeonStorageOptions = {
  env?: NodeJS.ProcessEnv;
  sql?: NeonSql;
};

function profileToRow(p: ProfileRecord) {
  return {
    id: p.id,
    name: p.name,
    title: p.title,
    password_hash: p.passwordHash ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt
  };
}

function rowToProfile(r: {
  id: string;
  name: string;
  title: string;
  password_hash: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}): ProfileRecord {
  const createdAt =
    r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
  const updatedAt =
    r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at);
  return {
    id: r.id,
    name: r.name,
    title: r.title,
    ...(r.password_hash ? { passwordHash: r.password_hash } : {}),
    createdAt,
    updatedAt
  };
}

async function bumpRevision(sql: NeonSql, key: string): Promise<void> {
  await sql`
    INSERT INTO runtime_meta (key, value, updated_at)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE
      SET value = runtime_meta.value + 1,
          updated_at = now()
  `;
}

/**
 * Neon Free row-store adapter.
 * Implements document read/write for sync/bootstrap compatibility, plus entity APIs
 * so task complete can UPDATE one row instead of rewriting multi-MB JSON.
 */
export function createNeonStorage(options: NeonStorageOptions = {}): NeonEntityStorage {
  const env = options.env ?? process.env;
  const sql = options.sql ?? getSharedNeonSql(env);
  const transferTtlHours = Math.max(1, Number(env.NEON_TRANSFER_TTL_HOURS ?? 2));

  const api: NeonEntityStorage = {
    kind: "neon",
    // Coalesce bursts on long-running hosts; Vercel must flush before respond.
    persistDebounceMs: env.VERCEL ? 0 : 200,

    async ensureReady() {
      await ensureNeonMigrations(sql, env);
    },

    async loadProfiles() {
      const rows = await sql`
        SELECT id, name, title, password_hash, created_at, updated_at
        FROM profiles
        ORDER BY id
      `;
      return (rows as Array<Parameters<typeof rowToProfile>[0]>).map(rowToProfile);
    },

    async loadProjects() {
      const rows = await sql`
        SELECT id, name, profile_id
        FROM projects
        ORDER BY id
      `;
      return (rows as Array<{ id: string; name: string; profile_id: string | null }>).map(
        (r) => ({
          id: r.id,
          name: r.name,
          profileId: r.profile_id
        })
      );
    },

    async loadTasks() {
      const rows = await sql`SELECT payload FROM tasks`;
      return (rows as Array<{ payload: TaskRecord }>).map((r) => r.payload);
    },

    async replaceProfiles(rows) {
      await sql`DELETE FROM profiles`;
      for (const p of rows) {
        const row = profileToRow(p);
        await sql`
          INSERT INTO profiles (id, name, title, password_hash, created_at, updated_at)
          VALUES (
            ${row.id},
            ${row.name},
            ${row.title},
            ${row.password_hash},
            ${row.created_at}::timestamptz,
            ${row.updated_at}::timestamptz
          )
        `;
      }
      await bumpRevision(sql, "profiles_revision");
    },

    async replaceProjects(rows) {
      await sql`DELETE FROM projects`;
      for (const p of rows) {
        await sql`
          INSERT INTO projects (id, name, profile_id)
          VALUES (${p.id}, ${p.name}, ${p.profileId ?? null})
        `;
      }
      await bumpRevision(sql, "projects_revision");
    },

    async replaceAllTasks(rows) {
      await sql`DELETE FROM tasks`;
      const chunkSize = 150;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const ids = chunk.map((t) => t.id);
        const payloads = chunk.map((t) => JSON.stringify(t));
        await sql.query(
          `INSERT INTO tasks (id, payload, updated_at)
           SELECT id, payload::jsonb, now()
           FROM UNNEST($1::text[], $2::text[]) AS t(id, payload)`,
          [ids, payloads]
        );
      }
      await bumpRevision(sql, "tasks_revision");
    },

    async upsertTasks(rows) {
      if (rows.length === 0) return;
      const chunkSize = 150;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const ids = chunk.map((t) => t.id);
        const payloads = chunk.map((t) => JSON.stringify(t));
        await sql.query(
          `INSERT INTO tasks (id, payload, updated_at)
           SELECT id, payload::jsonb, now()
           FROM UNNEST($1::text[], $2::text[]) AS t(id, payload)
           ON CONFLICT (id) DO UPDATE
             SET payload = EXCLUDED.payload,
                 updated_at = now()`,
          [ids, payloads]
        );
      }
      await bumpRevision(sql, "tasks_revision");
    },

    async deleteTasks(ids) {
      if (ids.length === 0) return;
      await sql.query(`DELETE FROM tasks WHERE id = ANY($1::text[])`, [ids]);
      await bumpRevision(sql, "tasks_revision");
    },

    async getTasksRevision() {
      const rows = await sql`
        SELECT value FROM runtime_meta WHERE key = 'tasks_revision'
      `;
      const value = (rows as Array<{ value: string | number }>)[0]?.value;
      return Number(value ?? 0);
    },

    async putTransferStaging(pathname, content, ttlHours = transferTtlHours) {
      const bytes = Buffer.byteLength(content, "utf8");
      const hours = Math.max(1, ttlHours);
      await sql`
        INSERT INTO transfer_staging (pathname, content, byte_size, created_at, expires_at)
        VALUES (
          ${pathname},
          ${content},
          ${bytes},
          now(),
          now() + make_interval(hours => ${hours})
        )
        ON CONFLICT (pathname) DO UPDATE
          SET content = EXCLUDED.content,
              byte_size = EXCLUDED.byte_size,
              created_at = now(),
              expires_at = now() + make_interval(hours => ${hours})
      `;
    },

    async putTransferStagingChunk(pathname, index, total, chunk, ttlHours = transferTtlHours) {
      const hours = Math.max(1, ttlHours);
      const partPath = transferChunkPathname(pathname, index);
      const b64 = chunk.toString("base64");
      await sql`
        INSERT INTO transfer_staging (pathname, content, byte_size, created_at, expires_at)
        VALUES (
          ${partPath},
          ${b64},
          ${chunk.length},
          now(),
          now() + make_interval(hours => ${hours})
        )
        ON CONFLICT (pathname) DO UPDATE
          SET content = EXCLUDED.content,
              byte_size = EXCLUDED.byte_size,
              created_at = now(),
              expires_at = now() + make_interval(hours => ${hours})
      `;

      if (index < total - 1) {
        return { complete: false, byteLength: chunk.length };
      }

      const buffers: Buffer[] = [];
      for (let i = 0; i < total; i++) {
        const rows = await sql`
          SELECT content FROM transfer_staging
          WHERE pathname = ${transferChunkPathname(pathname, i)}
            AND expires_at > now()
        `;
        const row = (rows as Array<{ content: string }>)[0];
        if (!row?.content) {
          throw new Error(`Missing transfer chunk ${i}/${total} for ${pathname}`);
        }
        buffers.push(Buffer.from(row.content, "base64"));
      }
      const assembled = assembleTransferChunks(buffers);
      await api.putTransferStaging(pathname, assembled, hours);
      for (let i = 0; i < total; i++) {
        await sql`DELETE FROM transfer_staging WHERE pathname = ${transferChunkPathname(pathname, i)}`;
      }
      return { complete: true, byteLength: Buffer.byteLength(assembled, "utf8") };
    },

    async readTransferStaging(pathname) {
      const rows = await sql`
        SELECT content FROM transfer_staging
        WHERE pathname = ${pathname}
          AND expires_at > now()
      `;
      const row = (rows as Array<{ content: string }>)[0];
      return row?.content ?? null;
    },

    async deleteTransferStaging(pathname) {
      await sql`DELETE FROM transfer_staging WHERE pathname = ${pathname}`;
    },

    async pruneExpiredTransferStaging() {
      const rows = await sql`
        DELETE FROM transfer_staging
        WHERE expires_at <= now()
        RETURNING id
      `;
      return (rows as unknown[]).length;
    },

    async readText(name: string) {
      if (name === TASKS_FILE) {
        const tasks = await api.loadTasks();
        return JSON.stringify(tasks);
      }
      if (name === PROJECTS_FILE) {
        const projects = await api.loadProjects();
        return JSON.stringify(projects);
      }
      if (name === PROFILES_FILE) {
        const profiles = await api.loadProfiles();
        return JSON.stringify(profiles);
      }
      // Unified / legacy interchange not stored in Neon row tables.
      return null;
    },

    async writeText(name: string, content: string) {
      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Neon writeText expects a JSON array for ${name}`);
      }
      if (name === TASKS_FILE) {
        await api.replaceAllTasks(parsed as TaskRecord[]);
        return;
      }
      if (name === PROJECTS_FILE) {
        await api.replaceProjects(parsed as ProjectRecord[]);
        return;
      }
      if (name === PROFILES_FILE) {
        await api.replaceProfiles(parsed as ProfileRecord[]);
        return;
      }
      throw new Error(`Neon storage does not persist ${name}`);
    },

    async listSyncJsonEntries(): Promise<StorageJsonEntry[]> {
      const rows = await sql`
        SELECT key, EXTRACT(EPOCH FROM updated_at) * 1000 AS mtime_ms
        FROM runtime_meta
        WHERE key IN ('tasks_revision', 'projects_revision', 'profiles_revision')
      `;
      const map = new Map<string, number>();
      for (const r of rows as Array<{ key: string; mtime_ms: string | number }>) {
        map.set(r.key, Number(r.mtime_ms) || Date.now());
      }
      return [
        { name: TASKS_FILE, mtimeMs: map.get("tasks_revision") ?? 0 },
        { name: PROJECTS_FILE, mtimeMs: map.get("projects_revision") ?? 0 },
        { name: PROFILES_FILE, mtimeMs: map.get("profiles_revision") ?? 0 }
      ].sort((a, b) => a.mtimeMs - b.mtimeMs);
    }
  };

  return api;
}
