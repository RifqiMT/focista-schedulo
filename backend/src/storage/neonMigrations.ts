/**
 * Neon core DDL embedded for serverless deploys (no filesystem SQL at runtime).
 * Keep in sync with `migrations/001_neon_core.sql`.
 *
 * Note: task filter fields stay inside `payload jsonb` (expression indexes).
 * Generated columns were avoided — Postgres rejects some jsonb casts as non-immutable.
 */
export const NEON_CORE_MIGRATION_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  name text NOT NULL,
  title text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  profile_id text
);

CREATE INDEX IF NOT EXISTS projects_profile_id_idx ON projects (profile_id);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_payload_id_matches CHECK (payload->>'id' = id)
);

CREATE INDEX IF NOT EXISTS tasks_profile_id_idx ON tasks ((payload->>'profileId'));
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks ((payload->>'projectId'));
CREATE INDEX IF NOT EXISTS tasks_parent_id_idx ON tasks ((payload->>'parentId'));
CREATE INDEX IF NOT EXISTS tasks_completed_idx ON tasks (((payload->>'completed') = 'true'));
CREATE INDEX IF NOT EXISTS tasks_updated_at_idx ON tasks (updated_at DESC);

CREATE TABLE IF NOT EXISTS runtime_meta (
  key text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO runtime_meta (key, value)
VALUES
  ('tasks_revision', 0),
  ('projects_revision', 0),
  ('profiles_revision', 0)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS transfer_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pathname text NOT NULL UNIQUE,
  content text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT transfer_staging_pathname_prefix CHECK (
    pathname LIKE 'focista-schedulo/imports/%'
    OR pathname LIKE 'focista-schedulo/exports/%'
  )
);

CREATE INDEX IF NOT EXISTS transfer_staging_expires_idx ON transfer_staging (expires_at);
`.trim();
