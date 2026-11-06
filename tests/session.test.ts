import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventsToCsv, formatMs } from '../src/domain/format.ts';
import {
  applyEnd,
  applyPause,
  applyResume,
  elapsedAt,
  initialSessionState,
  sessionDuration,
  sessionReducer,
  type ObsEvent,
  type Session,
} from '../src/domain/session.ts';

const T0 = 1_700_000_000_000;
const session = (over: Partial<Session> = {}): Session => ({
  id: 1,
  label: 'P01',
  startedAt: T0,
  endedAt: null,
  pausedMs: 0,
  pausedAt: null,
  ...over,
});
const ev = (id: number, tMs: number, type = 'susto'): ObsEvent => ({
  id,
  sessionId: 1,
  type,
  tMs,
  wallMs: T0 + tMs,
  note: null,
});

describe('elapsedAt', () => {
  it('conta tempo de parede desde o início', () => {
    assert.equal(elapsedAt(session(), T0 + 12_345), 12_345);
  });

  it('desconta pausas encerradas e a pausa atual', () => {
    const s = session({ pausedMs: 5_000, pausedAt: T0 + 20_000 });
    // 30s de parede - 5s de pausa antiga - 10s de pausa atual
    assert.equal(elapsedAt(s, T0 + 30_000), 15_000);
  });

  it('congela no fim da sessão', () => {
    const s = session({ endedAt: T0 + 60_000 });
    assert.equal(elapsedAt(s, T0 + 999_999), 60_000);
    assert.equal(sessionDuration(s, T0 + 999_999), 60_000);
  });

  it('não fica negativo se o relógio voltar', () => {
    assert.equal(elapsedAt(session(), T0 - 1_000), 0);
  });

  it('sobrevive a "processo morto": recalcula só com dados persistidos', () => {
    // App foi morto aos 40s e reaberto aos 100s: o relógio continua certo.
    const persisted = session({ pausedMs: 0 });
    assert.equal(elapsedAt(persisted, T0 + 100_000), 100_000);
  });
});

describe('applyPause / applyResume / applyEnd', () => {
  it('pausa e retoma acumulando pausedMs', () => {
    const p = applyPause(session(), T0 + 10_000);
    const r = applyResume(p, T0 + 13_000);
    assert.equal(r.pausedMs, 3_000);
    assert.equal(r.pausedAt, null);
    assert.equal(elapsedAt(r, T0 + 20_000), 17_000);
  });

  it('pausar duas vezes não reinicia a pausa', () => {
    const p = applyPause(applyPause(session(), T0 + 10_000), T0 + 15_000);
    assert.equal(p.pausedAt, T0 + 10_000);
  });

  it('encerrar durante pausa fecha a pausa', () => {
    const e = applyEnd(applyPause(session(), T0 + 10_000), T0 + 30_000);
    assert.equal(e.endedAt, T0 + 30_000);
    assert.equal(e.pausedAt, null);
    assert.equal(sessionDuration(e, T0 + 99_000), 10_000);
  });
});

describe('sessionReducer', () => {
  it('HYDRATE com sessão aberta vai para running e ordena eventos', () => {
    const s = sessionReducer(initialSessionState, {
      type: 'HYDRATE',
      session: session(),
      events: [ev(2, 900), ev(1, 100)],
    });
    assert.equal(s.status, 'running');
    assert.deepEqual(
      s.events.map((e) => e.id),
      [1, 2],
    );
  });

  it('HYDRATE com sessão pausada vai para paused', () => {
    const s = sessionReducer(initialSessionState, {
      type: 'HYDRATE',
      session: session({ pausedAt: T0 + 1 }),
      events: [],
    });
    assert.equal(s.status, 'paused');
  });

  it('HYDRATE sem sessão (ou encerrada) vai para idle', () => {
    assert.equal(sessionReducer(initialSessionState, { type: 'HYDRATE', session: null, events: [] }).status, 'idle');
    const ended = sessionReducer(initialSessionState, {
      type: 'HYDRATE',
      session: session({ endedAt: T0 + 5 }),
      events: [ev(1, 1)],
    });
    assert.equal(ended.status, 'idle');
    assert.equal(ended.session, null);
    assert.equal(ended.events.length, 0);
  });

  it('ADD_EVENT ignora duplicados e eventos de outra sessão', () => {
    let s = sessionReducer(initialSessionState, { type: 'START', session: session() });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: { ...ev(2, 200), sessionId: 99 } });
    assert.equal(s.events.length, 1);
  });

  it('ADD_EVENT sem sessão não faz nada', () => {
    const idle = sessionReducer(initialSessionState, { type: 'HYDRATE', session: null, events: [] });
    assert.equal(sessionReducer(idle, { type: 'ADD_EVENT', event: ev(1, 1) }), idle);
  });

  it('REMOVE_EVENT remove pelo id', () => {
    let s = sessionReducer(initialSessionState, { type: 'START', session: session() });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(2, 200) });
    s = sessionReducer(s, { type: 'REMOVE_EVENT', id: 2 });
    assert.deepEqual(
      s.events.map((e) => e.id),
      [1],
    );
  });

  it('PAUSE/RESUME respeitam o status atual', () => {
    let s = sessionReducer(initialSessionState, { type: 'START', session: session() });
    assert.equal(sessionReducer(s, { type: 'RESUME', at: T0 + 1 }), s, 'resume sem pausa é no-op');
    s = sessionReducer(s, { type: 'PAUSE', at: T0 + 1_000 });
    assert.equal(s.status, 'paused');
    assert.equal(sessionReducer(s, { type: 'PAUSE', at: T0 + 2_000 }), s, 'pausa dupla é no-op');
    s = sessionReducer(s, { type: 'RESUME', at: T0 + 4_000 });
    assert.equal(s.status, 'running');
    assert.equal(s.session?.pausedMs, 3_000);
  });

  it('END limpa a sessão ativa', () => {
    let s = sessionReducer(initialSessionState, { type: 'START', session: session() });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'END', at: T0 + 5_000 });
    assert.deepEqual(s, { status: 'idle', session: null, events: [] });
  });
});

describe('format', () => {
  it('formatMs', () => {
    assert.equal(formatMs(0), '00:00.0');
    assert.equal(formatMs(83_456), '01:23.4');
    assert.equal(formatMs(3_723_900), '1:02:03.9');
  });

  it('eventsToCsv escapa vírgulas e aspas', () => {
    const csv = eventsToCsv(session({ label: 'P01, "turma A"' }), [{ ...ev(1, 1_500), note: 'olhou, voltou' }]);
    const [header, row] = csv.split('\n');
    assert.match(header, /^sessao,participante,tempo_ms/);
    assert.match(row, /^1,"P01, ""turma A""",1500,00:01\.5,susto,Se assustou,comportamento,/);
    assert.match(row, /,"olhou, voltou"$/);
  });
});
