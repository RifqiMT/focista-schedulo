import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NEON_CORE_MIGRATION_SQL } from "./neonMigrations";

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

function createNeonSql(databaseUrl: string): NeonSql {
  return neon(databaseUrl, {
    fetchOptions: {
      // Neon serverless HTTP driver; keep requests bounded on Free cold starts.
    }
  });
}

export function getSharedNeonSql(env: NodeJS.ProcessEnv = process.env): NeonSql {
  if (cachedSql) return cachedSql;
  const url = getDatabaseUrl(env);
  if (!url) {
    throw new Error("DATABASE_URL is required for Neon storage");
  }
  cachedSql = createNeonSql(url);
  return cachedSql;
}

export async function ensureNeonMigrations(
  sql: NeonSql,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (migrationsApplied) return;
  const timeoutMs = Math.max(1000, Number(env.NEON_STATEMENT_TIMEOUT_MS ?? 15_000));
  await sql.query(`SET statement_timeout = ${timeoutMs}`);
  // Embed DDL in the JS bundle so Vercel serverless does not need dist/migrations/*.sql.
  const ddl = NEON_CORE_MIGRATION_SQL;
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
