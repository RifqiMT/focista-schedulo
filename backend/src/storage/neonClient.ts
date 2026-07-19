import { readFile } from "fs/promises";
import path from "path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type NeonSql = NeonQueryFunction<false, false>;

let cachedSql: NeonSql | null = null;
let migrationsApplied = false;

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  // Prefer pooled / primary names used by Neon + Vercel integrations.
  const candidates = [
    env.DATABASE_URL,
    env.DATABASE_URL_POOLED,
    env.POSTGRES_URL,
    env.POSTGRES_PRISMA_URL,
    env.NEON_DATABASE_URL,
    env.DATABASE_URL_UNPOOLED,
    env.POSTGRES_URL_NON_POOLING
  ];
  for (const raw of candidates) {
    const url = raw?.trim();
    if (url) return url;
  }
  return null;
}

export function createNeonSql(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): NeonSql {
  const timeoutMs = Number(env.NEON_STATEMENT_TIMEOUT_MS ?? 15_000);
  const sql = neon(databaseUrl, {
    fetchOptions: {
      // Neon serverless HTTP driver; keep requests bounded on Free cold starts.
    }
  });
  // statement_timeout is set per-session via SET when running migrations / ensureReady.
  void timeoutMs;
  return sql;
}

export function getSharedNeonSql(env: NodeJS.ProcessEnv = process.env): NeonSql {
  if (cachedSql) return cachedSql;
  const url = getDatabaseUrl(env);
  if (!url) {
    throw new Error("DATABASE_URL is required for Neon storage");
  }
  cachedSql = createNeonSql(url, env);
  return cachedSql;
}

/** Reset cached client (tests). */
export function resetNeonSqlCache(): void {
  cachedSql = null;
  migrationsApplied = false;
}

export async function ensureNeonMigrations(
  sql: NeonSql,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (migrationsApplied) return;
  const timeoutMs = Math.max(1000, Number(env.NEON_STATEMENT_TIMEOUT_MS ?? 15_000));
  await sql.query(`SET statement_timeout = ${timeoutMs}`);
  const migrationPath = path.join(__dirname, "migrations", "001_neon_core.sql");
  const ddl = await readFile(migrationPath, "utf8");
  // neon() HTTP driver does not run multi-statement scripts reliably; split on semicolons
  // outside of function bodies (our migration has none).
  const statements = ddl
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0 && !/^BEGIN$/i.test(s) && !/^COMMIT$/i.test(s));

  for (const statement of statements) {
    await sql.query(statement);
  }
  migrationsApplied = true;
}
