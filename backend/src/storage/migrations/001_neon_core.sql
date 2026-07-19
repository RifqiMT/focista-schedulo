-- Focista Schedulo — Neon Free core schema
-- Replaces Vercel Blob runtime objects + Blob transfer staging.
-- Decision: docs/plans/2026-07-19-neon-schema-decision.md
--
-- Neon Free targets: 0.5 GB storage, 100 CU-hours, scale-to-zero.
-- Row-per-task + jsonb payload avoids multi-MB whole-document rewrites.

BEGIN;

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

-- Canonical task document lives in payload (TaskSchema JSON).
-- Generated columns power indexes without dual-write drift.
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  profile_id text GENERATED ALWAYS AS (NULLIF(payload->>'profileId', '')) STORED,
  project_id text GENERATED ALWAYS AS (NULLIF(payload->>'projectId', '')) STORED,
  completed boolean GENERATED ALWAYS AS (COALESCE((payload->>'completed')::boolean, false)) STORED,
  cancelled boolean GENERATED ALWAYS AS (COALESCE((payload->>'cancelled')::boolean, false)) STORED,
  due_date date GENERATED ALWAYS AS (
    CASE
      WHEN payload ? 'dueDate'
        AND NULLIF(payload->>'dueDate', '') IS NOT NULL
        AND (payload->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}'
      THEN (payload->>'dueDate')::date
      ELSE NULL
    END
  ) STORED,
  parent_id text GENERATED ALWAYS AS (NULLIF(payload->>'parentId', '')) STORED,
  priority text GENERATED ALWAYS AS (COALESCE(payload->>'priority', 'low')) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_payload_id_matches CHECK (payload->>'id' = id),
  CONSTRAINT tasks_priority_valid CHECK (
    priority IN ('low', 'medium', 'high', 'urgent')
  )
);

CREATE INDEX IF NOT EXISTS tasks_profile_due_idx ON tasks (profile_id, due_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS tasks_profile_completed_idx ON tasks (profile_id, completed);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_parent_id_idx ON tasks (parent_id);
CREATE INDEX IF NOT EXISTS tasks_updated_at_idx ON tasks (updated_at DESC);

-- Cheap multi-isolate freshness (replaces Blob list/head mtime peeks).
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

-- Replaces focista-schedulo/imports|exports Blob staging.
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

COMMIT;
