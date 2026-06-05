import { Database } from "bun:sqlite";
import type { CollabEvent, Project, Session, ParticipantId } from "../types";

export function createDb(path?: string): Database {
  const db = new Database(path ?? ":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      name TEXT NOT NULL,
      project TEXT NOT NULL REFERENCES projects(name),
      driver TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project, name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      session TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      sender TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project, timestamp)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(project, session, timestamp)
  `);

  return db;
}

export function createProject(db: Database, name: string): Project {
  const created_at = new Date().toISOString();
  db.run("INSERT INTO projects (name, created_at) VALUES (?, ?)", [name, created_at]);
  return { name, created_at };
}

export function getProject(db: Database, name: string): Project | null {
  const row = db.query("SELECT name, created_at FROM projects WHERE name = ?").get(name) as
    | { name: string; created_at: string }
    | null;
  return row;
}

export function createSession(
  db: Database,
  project: string,
  name: string,
  driver: ParticipantId | null
): Session {
  const created_at = new Date().toISOString();
  db.run("INSERT INTO sessions (name, project, driver, created_at) VALUES (?, ?, ?, ?)", [
    name,
    project,
    driver,
    created_at,
  ]);
  return { name, project, driver, created_at };
}

export function getSession(db: Database, project: string, name: string): Session | null {
  const row = db
    .query("SELECT name, project, driver, created_at FROM sessions WHERE project = ? AND name = ?")
    .get(project, name) as { name: string; project: string; driver: string | null; created_at: string } | null;
  return row;
}

export function setDriver(db: Database, project: string, session: string, driver: ParticipantId): void {
  db.run("UPDATE sessions SET driver = ? WHERE project = ? AND name = ?", [driver, project, session]);
}

export function clearDriver(db: Database, project: string, session: string): void {
  db.run("UPDATE sessions SET driver = NULL WHERE project = ? AND name = ?", [project, session]);
}

export function pushEvent(db: Database, event: CollabEvent): void {
  db.run(
    "INSERT INTO events (id, project, session, timestamp, source, sender, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [event.id, event.project, event.session, event.timestamp, event.source, event.sender, JSON.stringify(event.payload)]
  );
}

function rowToEvent(row: {
  id: string;
  project: string;
  session: string;
  timestamp: string;
  source: string;
  sender: string;
  payload: string;
}): CollabEvent {
  return {
    id: row.id,
    project: row.project,
    session: row.session,
    timestamp: row.timestamp,
    source: row.source as CollabEvent["source"],
    sender: row.sender as ParticipantId,
    payload: JSON.parse(row.payload),
  };
}

export function getProjectEvents(db: Database, project: string): CollabEvent[] {
  const rows = db
    .query("SELECT * FROM events WHERE project = ? ORDER BY timestamp ASC")
    .all(project) as Array<{
    id: string;
    project: string;
    session: string;
    timestamp: string;
    source: string;
    sender: string;
    payload: string;
  }>;
  return rows.map(rowToEvent);
}

export function getSessionEvents(db: Database, project: string, session: string): CollabEvent[] {
  const rows = db
    .query("SELECT * FROM events WHERE project = ? AND session = ? ORDER BY timestamp ASC")
    .all(project, session) as Array<{
    id: string;
    project: string;
    session: string;
    timestamp: string;
    source: string;
    sender: string;
    payload: string;
  }>;
  return rows.map(rowToEvent);
}

export function getEventsSince(db: Database, project: string, since: string): CollabEvent[] {
  const rows = db
    .query("SELECT * FROM events WHERE project = ? AND timestamp > ? ORDER BY timestamp ASC")
    .all(project, since) as Array<{
    id: string;
    project: string;
    session: string;
    timestamp: string;
    source: string;
    sender: string;
    payload: string;
  }>;
  return rows.map(rowToEvent);
}
