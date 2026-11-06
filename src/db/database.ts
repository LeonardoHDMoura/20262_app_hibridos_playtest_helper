import type { SQLiteDatabase } from 'expo-sqlite';
import { getEventType, MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import type { GameLink, ObsEvent, Session } from '../domain/session.ts';
import { gameEventText } from '../lib/eventLabels.ts';
import type { GameEvent } from '../lib/relay.ts';

export const DATABASE_NAME = 'playtest.db';
const DATABASE_VERSION = 2;

/*
 * Schema v2
 *
 *   sessions(id, label, started_at, ended_at, game_session_id, game_origin_ms,
 *            paused_ms, paused_at)  -- paused_* sobraram da v1 e não são usados
 *
 *   timeline_items(id, session_id -> sessions, source 'game'|'observer',
 *                  game_session_id, seq, type, t, wall_ms, data, label, note)
 *     - t: segundos desde o início da sessão (origem do jogo, se ligado)
 *     - wall_ms: observador = horário do toque; jogo = horário de chegada
 *     - data: JSON do evento do jogo
 *     - índice único (game_session_id, source, seq) só para eventos do jogo:
 *       é ele que deduplica replays e reenvios (INSERT OR IGNORE)
 */

/** Passado como `onInit` do <SQLiteProvider>: cria/migra o schema. */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // WAL: cada commit vai para o log em disco; leituras não bloqueiam escritas.
  await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (version < 1) {
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
      `);
    }

    if (version < 2) {
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN game_session_id TEXT;
        ALTER TABLE sessions ADD COLUMN game_origin_ms INTEGER;
        CREATE INDEX idx_sessions_game ON sessions(game_session_id);

        CREATE TABLE timeline_items (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          source          TEXT    NOT NULL CHECK (source IN ('game', 'observer')),
          game_session_id TEXT,
          seq             INTEGER,
          type            TEXT    NOT NULL,
          t               REAL    NOT NULL,
          wall_ms         INTEGER NOT NULL,
          data            TEXT,
          label           TEXT    NOT NULL,
          note            TEXT,
          CHECK (source = 'observer' OR (game_session_id IS NOT NULL AND seq IS NOT NULL))
        );
        CREATE UNIQUE INDEX idx_items_game ON timeline_items(game_session_id, source, seq) WHERE source = 'game';
        CREATE INDEX idx_items_session ON timeline_items(session_id, t);

        -- Marcações da v1 viram itens do observador. O t é recalculado pelo
        -- horário do toque (a v1 descontava pausas, que não existem mais).
        INSERT INTO timeline_items (id, session_id, source, type, t, wall_ms, label, note)
          SELECT e.id, e.session_id, 'observer', e.type, (e.wall_ms - s.started_at) / 1000.0, e.wall_ms, e.type, e.note
          FROM events e JOIN sessions s ON s.id = e.session_id;
        DROP TABLE events;
      `);
      // Rótulos legíveis vêm do catálogo (não dá para fazer isso em SQL puro).
      const types = await db.getAllAsync<{ type: string }>(
        "SELECT DISTINCT type FROM timeline_items WHERE source = 'observer'",
      );
      for (const { type } of types) {
        await db.runAsync(
          "UPDATE timeline_items SET label = ? WHERE source = 'observer' AND type = ?",
          getEventType(type).label,
          type,
        );
      }
    }

    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });
}

interface SessionRow {
  id: number;
  label: string;
  started_at: number;
  ended_at: number | null;
  game_session_id: string | null;
  game_origin_ms: number | null;
}

interface ItemRow {
  id: number;
  session_id: number;
  source: 'game' | 'observer';
  game_session_id: string | null;
  seq: number | null;
  type: string;
  t: number;
  wall_ms: number;
  data: string | null;
  label: string;
  note: string | null;
}

export interface SessionSummary extends Session {
  observerCount: number;
  gameCount: number;
}

/** Tudo o que a linha do tempo de uma sessão precisa. */
export interface LoadedSession {
  session: Session;
  events: ObsEvent[];
  game: GameLink | null;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  label: r.label,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

const toObsEvent = (r: ItemRow): ObsEvent => ({
  id: r.id,
  sessionId: r.session_id,
  type: r.type,
  wallMs: r.wall_ms,
  note: r.note,
});

function parseData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const toGameEvent = (r: ItemRow): GameEvent => ({
  v: 1,
  sessionId: r.game_session_id as string,
  seq: r.seq as number,
  type: r.type,
  t: r.t,
  data: parseData(r.data),
});

/*
 * Escritas usam a API *síncrona* de propósito: quando a função retorna, a linha
 * já foi commitada no SQLite. Só depois disso o reducer é atualizado. Assim, se
 * o sistema matar o app em segundo plano logo após um toque, o evento já está
 * no disco. Cada INSERT é minúsculo (bem abaixo de 1 ms), então não trava a UI.
 */

export function insertSession(db: SQLiteDatabase, label: string, startedAt: number): Session {
  const res = db.runSync('INSERT INTO sessions (label, started_at) VALUES (?, ?)', label, startedAt);
  return { id: res.lastInsertRowId, label, startedAt, endedAt: null };
}

export function saveSessionEnd(db: SQLiteDatabase, id: number, endedAt: number): void {
  db.runSync('UPDATE sessions SET ended_at = ? WHERE id = ?', endedAt, id);
}

/** Marcação do observador. `t` já vem calculado com a origem atual da sessão. */
export function insertObserverItem(
  db: SQLiteDatabase,
  e: { sessionId: number; type: string; wallMs: number; t: number; note: string | null },
): ObsEvent {
  const res = db.runSync(
    "INSERT INTO timeline_items (session_id, source, type, t, wall_ms, label, note) VALUES (?, 'observer', ?, ?, ?, ?, ?)",
    e.sessionId,
    e.type,
    e.t,
    e.wallMs,
    getEventType(e.type).label,
    e.note,
  );
  return { id: res.lastInsertRowId, sessionId: e.sessionId, type: e.type, wallMs: e.wallMs, note: e.note };
}

export function deleteObserverItem(db: SQLiteDatabase, id: number): void {
  db.runSync("DELETE FROM timeline_items WHERE id = ? AND source = 'observer'", id);
}

/**
 * Grava eventos do jogo. Repetidos (mesmo game_session_id + seq) são ignorados
 * pelo índice único. Devolve quantos eram novos.
 */
export function insertGameEvents(db: SQLiteDatabase, sessionId: number, events: readonly GameEvent[], receivedAt: number): number {
  let inserted = 0;
  db.withTransactionSync(() => {
    for (const e of events) {
      const res = db.runSync(
        `INSERT OR IGNORE INTO timeline_items (session_id, source, game_session_id, seq, type, t, wall_ms, data, label)
         VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        e.sessionId,
        e.seq,
        e.type,
        e.t,
        receivedAt,
        JSON.stringify(e.data ?? {}),
        gameEventText(e).label,
      );
      inserted += res.changes;
    }
  });
  return inserted;
}

/**
 * Liga a sessão ao jogo e/ou grava uma origem nova, realinhando o `t` das
 * marcações do observador (o horário do toque não muda; só a referência).
 */
export function saveGameLink(db: SQLiteDatabase, sessionId: number, gameSessionId: string, originMs: number): void {
  db.withTransactionSync(() => {
    db.runSync('UPDATE sessions SET game_session_id = ?, game_origin_ms = ? WHERE id = ?', gameSessionId, originMs, sessionId);
    db.runSync(
      "UPDATE timeline_items SET t = (wall_ms - ?) / 1000.0 WHERE session_id = ? AND source = 'observer'",
      originMs,
      sessionId,
    );
  });
}

/** Já existe uma observação encerrada para este jogo? (o replay não pode reabri-la) */
export function isGameSessionFinished(db: SQLiteDatabase, gameSessionId: string): boolean {
  return (
    db.getFirstSync<{ one: number }>(
      'SELECT 1 AS one FROM sessions WHERE game_session_id = ? AND ended_at IS NOT NULL LIMIT 1',
      gameSessionId,
    ) !== null
  );
}

export function deleteSession(db: SQLiteDatabase, id: number): void {
  db.runSync('DELETE FROM sessions WHERE id = ?', id);
}

async function loadFull(db: SQLiteDatabase, row: SessionRow | null): Promise<LoadedSession | null> {
  if (!row) return null;
  const items = await db.getAllAsync<ItemRow>('SELECT * FROM timeline_items WHERE session_id = ? ORDER BY t, id', row.id);
  const session = toSession(row);
  const events = items.filter((i) => i.source === 'observer').map(toObsEvent);
  const gameItems = items
    .filter((i) => i.source === 'game' && i.game_session_id === row.game_session_id)
    .sort((a, b) => (a.seq as number) - (b.seq as number));
  const game: GameLink | null =
    row.game_session_id !== null
      ? { sessionId: row.game_session_id, originMs: row.game_origin_ms ?? session.startedAt, events: gameItems.map(toGameEvent) }
      : null;
  return { session, events, game };
}

/** Sessão que ficou aberta (app fechado/morto no meio da partida). */
export async function loadOpenSession(db: SQLiteDatabase): Promise<LoadedSession | null> {
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  return loadFull(db, row);
}

export async function loadSession(db: SQLiteDatabase, id: number): Promise<LoadedSession | null> {
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
  return loadFull(db, row);
}

export async function listFinishedSessions(db: SQLiteDatabase): Promise<SessionSummary[]> {
  // Conta só as marcações feitas pelo observador (ignora as automáticas do app).
  const manualIds = MANUAL_EVENT_TYPES.map((t) => t.id);
  const placeholders = manualIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<SessionRow & { observer_count: number; game_count: number }>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM timeline_items i
         WHERE i.session_id = s.id AND i.source = 'observer' AND i.type IN (${placeholders})) AS observer_count,
       (SELECT COUNT(*) FROM timeline_items i WHERE i.session_id = s.id AND i.source = 'game') AS game_count
     FROM sessions s
     WHERE s.ended_at IS NOT NULL
     ORDER BY s.started_at DESC`,
    manualIds,
  );
  return rows.map((r) => ({ ...toSession(r), observerCount: r.observer_count, gameCount: r.game_count }));
}

