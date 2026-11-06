import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventsToCsv, formatMs } from '../src/domain/format.ts';
import {
  gameEnded,
  groupByGameSession,
  initialSessionState,
  routeGameEvents,
  sessionDuration,
  sessionReducer,
  timelineOriginMs,
  type GameRouteContext,
  type ObsEvent,
  type Session,
  type SessionState,
} from '../src/domain/session.ts';
import type { GameEvent } from '../src/lib/relay.ts';
import { buildTimeline, formatSeconds } from '../src/lib/timeline.ts';

const T0 = 1_700_000_000_000;
const session = (over: Partial<Session> = {}): Session => ({ id: 1, label: 'P01', startedAt: T0, endedAt: null, ...over });
const ev = (id: number, wallOffsetMs: number, type = 'susto'): ObsEvent => ({
  id,
  sessionId: 1,
  type,
  tMs: wallOffsetMs,
  wallMs: T0 + wallOffsetMs,
  note: null,
});
const gev = (seq: number, t: number, type = 'seeker_state', sessionId = 'G1'): GameEvent => ({
  v: 1,
  sessionId,
  seq,
  type,
  t,
  data: {},
});

const running = (): SessionState => sessionReducer(initialSessionState, { type: 'START', session: session() });

describe('sessionReducer — observação', () => {
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
    let s = running();
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: { ...ev(2, 200), sessionId: 99 } });
    assert.equal(s.events.length, 1);
  });

  it('REMOVE_EVENT remove pelo id', () => {
    let s = running();
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 100) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(2, 200) });
    s = sessionReducer(s, { type: 'REMOVE_EVENT', id: 2 });
    assert.deepEqual(
      s.events.map((e) => e.id),
      [1],
    );
  });

  it('END limpa a sessão ativa e o jogo', () => {
    let s = running();
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0, 'session_start')], receivedAt: T0 });
    s = sessionReducer(s, { type: 'END', at: T0 + 5_000 });
    assert.deepEqual(s, { status: 'idle', session: null, events: [], game: null });
  });

  it('sessionDuration', () => {
    assert.equal(sessionDuration(session({ endedAt: T0 + 60_000 }), T0 + 999_999), 60_000);
    assert.equal(sessionDuration(session(), T0 + 5_000), 5_000);
  });
});

describe('sessionReducer — eventos do jogo e relógio', () => {
  it('liga ao jogo e define origem = chegada - t', () => {
    const s = sessionReducer(running(), {
      type: 'GAME_EVENTS',
      gameSessionId: 'G1',
      events: [gev(0, 0, 'session_start')],
      receivedAt: T0 + 10_000,
    });
    assert.equal(s.game?.sessionId, 'G1');
    assert.equal(s.game?.originMs, T0 + 10_000);
  });

  it('replay atrasado é corrigido pelo primeiro evento ao vivo (menor chegada - t)', () => {
    let s = running();
    // App conectou 60 s depois do session_start: o replay chega todo de uma vez.
    s = sessionReducer(s, {
      type: 'GAME_EVENTS',
      gameSessionId: 'G1',
      events: [gev(0, 0, 'session_start'), gev(1, 20)],
      receivedAt: T0 + 60_000,
    });
    assert.equal(s.game?.originMs, T0 + 40_000, 'melhor estimativa do replay: 60 s - 20 s');
    // Evento ao vivo em t = 61 s chega em T0 + 61,05 s: origem real ≈ T0 + 0,05 s.
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(2, 61)], receivedAt: T0 + 61_050 });
    assert.equal(s.game?.originMs, T0 + 50);
  });

  it('origem nunca piora com eventos atrasados', () => {
    let s = sessionReducer(running(), { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0)], receivedAt: T0 });
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(1, 5)], receivedAt: T0 + 9_000 });
    assert.equal(s.game?.originMs, T0);
  });

  it('deduplica por sessionId + seq e mantém o estado se nada mudou', () => {
    let s = running();
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0), gev(1, 1)], receivedAt: T0 });
    const before = s;
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0), gev(1, 1)], receivedAt: T0 + 5_000 });
    assert.equal(s, before);
    assert.equal(s.game?.events.length, 2);
  });

  it('ignora eventos de outro jogo e quando não há observação', () => {
    let s = sessionReducer(running(), { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0)], receivedAt: T0 });
    s = sessionReducer(s, {
      type: 'GAME_EVENTS',
      gameSessionId: 'G2',
      events: [gev(0, 0, 'session_start', 'G2')],
      receivedAt: T0,
    });
    assert.equal(s.game?.sessionId, 'G1');
    assert.equal(s.game?.events.length, 1);

    const idle = sessionReducer(initialSessionState, { type: 'HYDRATE', session: null, events: [] });
    assert.equal(sessionReducer(idle, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0)], receivedAt: T0 }), idle);
  });

  it('gameEnded', () => {
    let s = sessionReducer(running(), { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(0, 0)], receivedAt: T0 });
    assert.equal(gameEnded(s.game), false);
    s = sessionReducer(s, { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(1, 9, 'session_end')], receivedAt: T0 });
    assert.equal(gameEnded(s.game), true);
  });
});

describe('linha do tempo unificada', () => {
  it('sem jogo: t relativo ao início manual', () => {
    const items = buildTimeline(session(), [ev(1, 12_500)], null);
    assert.equal(items[0].t, 12.5);
    assert.equal(items[0].source, 'observer');
  });

  it('marcações são realinhadas quando o jogo liga (podem ficar negativas)', () => {
    let s = running();
    // Observador marcou 5 s após "Iniciar"; o jogo começou 8 s após "Iniciar".
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(1, 5_000) });
    s = sessionReducer(s, { type: 'ADD_EVENT', event: ev(2, 20_000, 'escondeu') });
    s = sessionReducer(s, {
      type: 'GAME_EVENTS',
      gameSessionId: 'G1',
      events: [gev(0, 0, 'session_start')],
      receivedAt: T0 + 8_000,
    });
    s = sessionReducer(s, {
      type: 'GAME_EVENTS',
      gameSessionId: 'G1',
      events: [gev(1, 10, 'player_caught')],
      receivedAt: T0 + 18_000,
    });
    assert.equal(timelineOriginMs(s.session!, s.game), T0 + 8_000);
    const items = buildTimeline(s.session!, s.events, s.game);
    assert.deepEqual(
      items.map((i) => [i.source, i.t, i.label]),
      [
        ['observer', -3, 'Se assustou'],
        ['game', 0, 'Sessão iniciada'],
        ['game', 10, 'Monstro pegou o jogador'],
        ['observer', 12, 'Se escondeu'],
      ],
    );
  });

  it('empate: jogo antes do observador', () => {
    const s = sessionReducer(
      sessionReducer(sessionReducer(running(), { type: 'ADD_EVENT', event: ev(1, 3_000) }), {
        type: 'GAME_EVENTS',
        gameSessionId: 'G1',
        events: [gev(0, 3, 'player_caught')],
        receivedAt: T0 + 3_000,
      }),
      { type: 'GAME_EVENTS', gameSessionId: 'G1', events: [gev(1, 0, 'session_start')], receivedAt: T0 },
    );
    assert.deepEqual(
      buildTimeline(s.session!, s.events, s.game).map((i) => i.source),
      ['game', 'game', 'observer'],
    );
  });

  it('formatSeconds', () => {
    assert.equal(formatSeconds(0), '00:00');
    assert.equal(formatSeconds(83.9), '01:23');
    assert.equal(formatSeconds(-4.2), '-00:04');
    assert.equal(formatSeconds(3723), '1:02:03');
  });
});

describe('routeGameEvents', () => {
  const ctx = (over: Partial<GameRouteContext> = {}): GameRouteContext => ({
    hasOpenSession: false,
    linkedGameSessionId: null,
    finishedGameSessionIds: new Set(),
    ...over,
  });
  const start = [gev(0, 0, 'session_start')];
  const mid = [gev(5, 30)];
  const over = [gev(0, 0, 'session_start'), gev(9, 90, 'session_end')];

  it('sem observação: session_start cria; o resto é ignorado', () => {
    assert.equal(routeGameEvents(ctx(), 'G1', start), 'start');
    assert.equal(routeGameEvents(ctx(), 'G1', mid), 'ignore');
  });

  it('observação aberta sem jogo: liga, mesmo sem session_start', () => {
    assert.equal(routeGameEvents(ctx({ hasOpenSession: true }), 'G1', start), 'link');
    assert.equal(routeGameEvents(ctx({ hasOpenSession: true }), 'G1', mid), 'link');
  });

  it('jogo ligado: acrescenta, inclusive o session_end', () => {
    const c = ctx({ hasOpenSession: true, linkedGameSessionId: 'G1' });
    assert.equal(routeGameEvents(c, 'G1', mid), 'append');
    assert.equal(routeGameEvents(c, 'G1', [gev(9, 90, 'session_end')]), 'append');
  });

  it('outro jogo começando: substitui; evento solto de outro jogo: ignora', () => {
    const c = ctx({ hasOpenSession: true, linkedGameSessionId: 'G1' });
    assert.equal(routeGameEvents(c, 'G2', [gev(0, 0, 'session_start', 'G2')]), 'replace');
    assert.equal(routeGameEvents(c, 'G2', [gev(3, 9, 'seeker_state', 'G2')]), 'ignore');
  });

  it('jogo já terminado ou observação já encerrada: ignora (replay antigo)', () => {
    assert.equal(routeGameEvents(ctx(), 'G1', over), 'ignore');
    assert.equal(routeGameEvents(ctx({ hasOpenSession: true }), 'G1', over), 'ignore');
    assert.equal(routeGameEvents(ctx({ finishedGameSessionIds: new Set(['G1']) }), 'G1', start), 'ignore');
  });

  it('groupByGameSession mantém a ordem', () => {
    const groups = groupByGameSession([gev(0, 0, 'x', 'A'), gev(0, 0, 'x', 'B'), gev(1, 1, 'x', 'A')]);
    assert.deepEqual([...groups.keys()], ['A', 'B']);
    assert.deepEqual(
      groups.get('A')!.map((e) => e.seq),
      [0, 1],
    );
  });
});

describe('format (legado)', () => {
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
