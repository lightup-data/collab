import type { Sql } from "../src/service/db";

/**
 * Reset test data: drop and recreate all tables using the canonical schema.
 * This ensures tests always match the current schema in db.ts.
 */
export async function resetTestData(sql: Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS events`;
  await sql`DROP TABLE IF EXISTS sessions`;
  await sql`DROP TABLE IF EXISTS projects`;
  await sql`DROP TABLE IF EXISTS users`;
  await sql`DROP TABLE IF EXISTS orgs`;
  await sql`
    CREATE TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      domain TEXT,
      slack_team_id TEXT,
      slack_bot_token TEXT,
      slack_system_channel_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      participant_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slack_channel_id TEXT,
      slack_channel_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, name)
    )
  `;
  await sql`
    CREATE TABLE sessions (
      name TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id),
      org_id TEXT NOT NULL,
      driver TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, name)
    )
  `;
  await sql`
    CREATE TABLE events (
      id UUID PRIMARY KEY,
      org_id TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id),
      session TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL,
      sender TEXT NOT NULL,
      payload JSONB NOT NULL
    )
  `;
  await sql`CREATE INDEX idx_events_project ON events(project_id, timestamp)`;
  await sql`CREATE INDEX idx_events_session ON events(project_id, session, timestamp)`;
  await sql`INSERT INTO orgs (id, name) VALUES ('default', 'Default') ON CONFLICT DO NOTHING`;
}
