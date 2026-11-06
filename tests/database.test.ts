/**
 * Testa src/db/database.ts contra um SQLite de verdade (node:sqlite), com um
 * adaptador mínimo que imita a API do expo-sqlite usada pelo app.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as db from '../src/db/database.ts';
import type { GameEvent } from '../src/lib/relay.ts';

type Params = unknown[];
const flat = (params: Params): SQLInputValue[] =>
  (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as SQLInputValue[];

function openTestDb(): { raw: DatabaseSync; expo: SQLiteDatabase } {
  const raw = new DatabaseSync(':memory:');
  const first = (sql: string, params: Params) => (raw.prepare(sql).get(...flat(params)) as unknown) ?? null;
  const all = (sql: string, params: Params) => raw.prepare(sql).all(...flat(params)) as unknown[];
  const run = (sql: string, params: Params) => {
    const r = raw.prepare(sql).run(...flat(params));
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  };
  const adapter = {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async (sql: string, ...p: Params) => first(sql, p),
    getAllAsync: async (sql: string, ...p: Params) => all(sql, p),
    runAsync: async (sql: string, ...p: Params) => run(sql, p),
    getFirstSync: (sql: string, ...p: Params) => first(sql, p),
    getAllSync: (sql: string, ...p: Params) => all(sql, p),
    runSync: (sql: string, ...p: Params) => run(sql, p),
    withTransactionSync: (task: () => void) => {
      raw.exec('BEGIN');
      try {
        task();
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { raw, expo: adapter as unknown as SQLiteDatabase };
}

const T0 = 1_700_000_000_000;
const gev = (seq: number, t: number, type = 'seeker_state', sessionId = 'G1', data: Record<string, unknown> = {}): GameEvent => ({
  v: 1,
  sessionId,
  seq,
  type,
  t,
  data,
});

async function freshDb() {
  const t = openTestDb();
  await db.migrateDbIfNeeded(t.expo);
  return t;
}

describe('migração', () => {
  it('banco novo chega à v2 e rodar de novo não faz nada', async () => {
    const { raw, expo } = await freshDb();
    assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
    assert.ok(tables.includes('timeline_items'));
    assert.ok(!tables.includes('events'));
    await db.migrateDbIfNeeded(expo);
  });

  it('v1 -> v2 preserva as marcações, recalcula t pelo toque e usa o rótulo do catálogo', async () => {
    const { raw, expo } = openTestDb();
    raw.exec(`
      CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, started_at INTEGER NOT NULL,
        ended_at INTEGER, paused_ms INTEGER NOT NULL DEFAULT 0, paused_at INTEGER);
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL, t_ms INTEGER NOT NULL, wall_ms INTEGER NOT NULL, note TEXT);
      PRAGMA user_version = 1;
    `);
    raw.prepare('INSERT INTO sessions (label, started_at, ended_at, paused_ms) VALUES (?, ?, ?, ?)').run('P01', T0, T0 + 60_000, 5_000);
    // t_ms da v1 descontava 5 s de pausa; o toque foi 20 s após o início.
    raw.prepare('INSERT INTO events (session_id, type, t_ms, wall_ms, note) VALUES (1, ?, ?, ?, ?)').run('susto', 15_000, T0 + 20_000, 'nota');
    raw.prepare('INSERT INTO events (session_id, type, t_ms, wall_ms) VALUES (1, ?, ?, ?)').run('tipo_antigo', 1_000, T0 + 1_000);

    await db.migrateDbIfNeeded(expo);

    const items = raw.prepare('SELECT id, source, type, t, label, note FROM timeline_items ORDER BY id').all();
    assert.deepEqual(
      items.map((r) => ({ ...r })),
      [
        { id: 1, source: 'observer', type: 'susto', t: 20, label: 'Se assustou', note: 'nota' },
        { id: 2, source: 'observer', type: 'tipo_antigo', t: 1, label: 'tipo_antigo', note: null },
      ],
    );
    const loaded = await db.loadSession(expo, 1);
    assert.equal(loaded?.events.length, 2);
    assert.equal(loaded?.game, null);
  });
});

describe('eventos do jogo', () => {
  it('INSERT OR IGNORE deduplica por (sessão do jogo, seq)', async () => {
    const { expo } = await freshDb();
    const s = db.insertSession(expo, 'P01', T0);
    assert.equal(db.insertGameEvents(expo, s.id, [gev(0, 0, 'session_start'), gev(1, 2)], T0), 2);
    // Replay depois de reconectar + um reenvio no mesmo lote.
    assert.equal(db.insertGameEvents(expo, s.id, [gev(0, 0, 'session_start'), gev(1, 2), gev(2, 5), gev(2, 5)], T0 + 9_000), 1);
    // Mesmo seq de outro jogo não é duplicado.
    assert.equal(db.insertGameEvents(expo, s.id, [gev(0, 0, 'session_start', 'G2')], T0), 1);
  });

  it('ligação + origem: realinha o t das marcações e volta ao reabrir', async () => {
    const { raw, expo } = await freshDb();
    const s = db.insertSession(expo, 'P01', T0);
    db.insertObserverItem(expo, { sessionId: s.id, type: 'susto', wallMs: T0 + 5_000, t: 5, note: null });
    db.insertGameEvents(expo, s.id, [gev(1, 10, 'key_collected', 'G1', { total: 1, required: 3 }), gev(0, 0, 'session_start')], T0 + 8_000);
    db.saveGameLink(expo, s.id, 'G1', T0 + 8_000);

    const t = (raw.prepare("SELECT t FROM timeline_items WHERE source = 'observer'").get() as { t: number }).t;
    assert.equal(t, -3, 'marcação 3 s antes do jogo começar');

    const open = await db.loadOpenSession(expo);
    assert.equal(open?.game?.sessionId, 'G1');
    assert.equal(open?.game?.originMs, T0 + 8_000);
    assert.deepEqual(
      open?.game?.events.map((e) => [e.seq, e.type]),
      [
        [0, 'session_start'],
        [1, 'key_collected'],
      ],
      'eventos do jogo voltam ordenados por seq',
    );
    assert.deepEqual(open?.game?.events[1].data, { total: 1, required: 3 });
    assert.equal(open?.events[0].wallMs, T0 + 5_000);
  });

  it('isGameSessionFinished só depois de encerrar a observação', async () => {
    const { expo } = await freshDb();
    const s = db.insertSession(expo, 'P01', T0);
    db.saveGameLink(expo, s.id, 'G1', T0);
    assert.equal(db.isGameSessionFinished(expo, 'G1'), false);
    db.saveSessionEnd(expo, s.id, T0 + 60_000);
    assert.equal(db.isGameSessionFinished(expo, 'G1'), true);
    assert.equal(await db.loadOpenSession(expo), null);
  });
});

describe('listagem e exclusão', () => {
  it('conta marcações manuais e eventos do jogo; excluir apaga os itens', async () => {
    const { raw, expo } = await freshDb();
    const s = db.insertSession(expo, 'P01', T0);
    db.insertObserverItem(expo, { sessionId: s.id, type: 'susto', wallMs: T0 + 1, t: 0, note: null });
    db.insertObserverItem(expo, { sessionId: s.id, type: 'app_segundo_plano', wallMs: T0 + 2, t: 0, note: null });
    const removed = db.insertObserverItem(expo, { sessionId: s.id, type: 'escondeu', wallMs: T0 + 3, t: 0, note: null });
    db.deleteObserverItem(expo, removed.id);
    db.insertGameEvents(expo, s.id, [gev(0, 0, 'session_start'), gev(1, 1)], T0);
    db.saveSessionEnd(expo, s.id, T0 + 10_000);

    const [summary] = await db.listFinishedSessions(expo);
    assert.equal(summary.observerCount, 1, 'só a marcação manual que sobrou');
    assert.equal(summary.gameCount, 2);

    db.deleteSession(expo, s.id);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM timeline_items').get() as { n: number }).n, 0);
  });
});
