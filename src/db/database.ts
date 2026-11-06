import type { SQLiteDatabase } from 'expo-sqlite';
import { MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import type { ObsEvent, Session } from '../domain/session.ts';

export const DATABASE_NAME = 'playtest.db';
const DATABASE_VERSION = 1;

/** Passado como `onInit` do <SQLiteProvider>: cria/migra o schema. */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // WAL: cada commit vai para o log em disco; leituras não bloqueiam escritas.
  await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        label      TEXT    NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        paused_ms  INTEGER NOT NULL DEFAULT 0,
        paused_at  INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type       TEXT    NOT NULL,
        t_ms       INTEGER NOT NULL,
        wall_ms    INTEGER NOT NULL,
        note       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, t_ms);
    `);
    version = 1;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

interface SessionRow {
  id: number;
  label: string;
  started_at: number;
  ended_at: number | null;
  paused_ms: number;
  paused_at: number | null;
}

interface EventRow {
  id: number;
  session_id: number;
  type: string;
  t_ms: number;
  wall_ms: number;
  note: string | null;
}

export interface SessionSummary extends Session {
  eventCount: number;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  label: r.label,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  pausedMs: r.paused_ms,
  pausedAt: r.paused_at,
});

const toEvent = (r: EventRow): ObsEvent => ({
  id: r.id,
  sessionId: r.session_id,
  type: r.type,
  tMs: r.t_ms,
  wallMs: r.wall_ms,
  note: r.note,
});

/*
 * Escritas usam a API *síncrona* de propósito: quando a função retorna, a linha
 * já foi commitada no SQLite. Só depois disso o reducer é atualizado. Assim, se
 * o sistema matar o app em segundo plano logo após um toque, o evento já está
 * no disco. Cada INSERT é minúsculo (bem abaixo de 1 ms), então não trava a UI.
 */

export function insertSession(db: SQLiteDatabase, label: string, startedAt: number): Session {
  const res = db.runSync('INSERT INTO sessions (label, started_at) VALUES (?, ?)', label, startedAt);
  return { id: res.lastInsertRowId, label, startedAt, endedAt: null, pausedMs: 0, pausedAt: null };
}

export function saveSessionTiming(db: SQLiteDatabase, s: Session): void {
  db.runSync(
    'UPDATE sessions SET ended_at = ?, paused_ms = ?, paused_at = ? WHERE id = ?',
    s.endedAt,
    s.pausedMs,
    s.pausedAt,
    s.id,
  );
}

export function insertEvent(db: SQLiteDatabase, e: Omit<ObsEvent, 'id'>): ObsEvent {
  const res = db.runSync(
    'INSERT INTO events (session_id, type, t_ms, wall_ms, note) VALUES (?, ?, ?, ?, ?)',
    e.sessionId,
    e.type,
    e.tMs,
    e.wallMs,
    e.note,
  );
  return { ...e, id: res.lastInsertRowId };
}

export function deleteEvent(db: SQLiteDatabase, id: number): void {
  db.runSync('DELETE FROM events WHERE id = ?', id);
}

export function deleteSession(db: SQLiteDatabase, id: number): void {
  db.runSync('DELETE FROM sessions WHERE id = ?', id);
}

/** Sessão que ficou aberta (app fechado/morto no meio da partida). */
export async function loadOpenSession(db: SQLiteDatabase): Promise<{ session: Session; events: ObsEvent[] } | null> {
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  if (!row) return null;
  return { session: toSession(row), events: await loadEvents(db, row.id) };
}

export async function loadSession(db: SQLiteDatabase, id: number): Promise<{ session: Session; events: ObsEvent[] } | null> {
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
  if (!row) return null;
  return { session: toSession(row), events: await loadEvents(db, id) };
}

export async function loadEvents(db: SQLiteDatabase, sessionId: number): Promise<ObsEvent[]> {
  const rows = await db.getAllAsync<EventRow>(
    'SELECT * FROM events WHERE session_id = ? ORDER BY t_ms, id',
    sessionId,
  );
  return rows.map(toEvent);
}

export async function listFinishedSessions(db: SQLiteDatabase): Promise<SessionSummary[]> {
  // Conta só eventos marcados pelo observador (ignora os automáticos de sistema).
  const manualIds = MANUAL_EVENT_TYPES.map((t) => t.id);
  const placeholders = manualIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<SessionRow & { event_count: number }>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type IN (${placeholders})) AS event_count
     FROM sessions s
     WHERE s.ended_at IS NOT NULL
     ORDER BY s.started_at DESC`,
    manualIds,
  );
  return rows.map((r) => ({ ...toSession(r), eventCount: r.event_count }));
}
