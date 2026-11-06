import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameEvent } from '../src/lib/relay.ts';
import { summarizeGame } from '../src/lib/sessionSummary.ts';

let seq = 0;
const e = (t: number, type: string, data: Record<string, unknown> = {}): GameEvent => ({
  v: 1,
  sessionId: 'G1',
  seq: seq++,
  type,
  t,
  data,
});
const sk = (t: number, from: string, to: string) => e(t, 'seeker_state', { from, to });

/** Mesmo roteiro do relay/simulate.js a 1x. */
function simulatedSession(): GameEvent[] {
  seq = 0;
  return [
    e(0, 'session_start', { build: 'sim', map: 'mansao', model: 'ronda_fixa' }),
    e(41, 'tutorial_end', { durationSec: 41 }),
    sk(48, 'patrol', 'alert'),
    sk(53, 'alert', 'patrol'),
    e(60, 'key_collected', { keyId: 'a', total: 1, required: 3 }),
    sk(66, 'patrol', 'alert'),
    sk(69, 'alert', 'chase'),
    sk(77, 'chase', 'alert'),
    sk(83, 'alert', 'patrol'),
    e(88, 'bottle_thrown', { total: 1 }),
    e(95, 'key_collected', { keyId: 'b', total: 2, required: 3 }),
    e(95, 'bottle_thrown', { total: 2 }),
    sk(102, 'patrol', 'chase'),
    e(107, 'player_caught', { attempt: 1 }),
    sk(107, 'chase', 'patrol'),
    e(111, 'attempt_start', { attempt: 2 }),
    e(119, 'bottle_thrown', { total: 3 }),
    sk(126, 'patrol', 'alert'),
    sk(129, 'alert', 'chase'),
    sk(135, 'chase', 'alert'),
    sk(140, 'alert', 'patrol'),
    e(147, 'key_collected', { keyId: 'c', total: 3, required: 3 }),
    e(154, 'player_escaped', { totalTimeSec: 154, attempts: 2 }),
    e(154, 'session_end', { reason: 'escaped' }),
  ];
}

describe('summarizeGame', () => {
  it('sessão do simulador', () => {
    const s = summarizeGame(simulatedSession());
    assert.equal(s.tutorialSec, 41);
    assert.equal(s.captures, 1);
    assert.equal(s.attempts, 2);
    assert.deepEqual(s.keys, { collected: 3, required: 3 });
    assert.equal(s.bottles, 3);
    assert.equal(s.alerts, 3, 'patrol -> alert em 48, 66 e 126');
    assert.equal(s.chases, 3, 'entradas em chase em 69, 102 e 129');
    assert.equal(s.lostPlayer, 2, 'a caça de 102 terminou em captura, não em perda');
    assert.equal(s.chaseSec, 8 + 5 + 6);
    assert.equal(s.inChaseNow, false);
    assert.equal(s.escaped, true);
    assert.equal(s.ended, true);
    assert.equal(s.endReason, 'escaped');
    assert.equal(s.missingEvents, 0);
  });

  it('não depende da ordem de chegada (usa seq)', () => {
    const events = simulatedSession().reverse();
    assert.equal(summarizeGame(events).chaseSec, 19);
  });

  it('caça aberta conta até o último evento e fica marcada como em andamento', () => {
    seq = 0;
    const s = summarizeGame([e(0, 'session_start'), sk(10, 'patrol', 'chase'), e(14, 'bottle_thrown', { total: 1 })]);
    assert.equal(s.chases, 1);
    assert.equal(s.chaseSec, 4);
    assert.equal(s.inChaseNow, true);
  });

  it('caça aberta no fim da sessão conta até o session_end', () => {
    seq = 0;
    const s = summarizeGame([e(0, 'session_start'), sk(10, 'patrol', 'chase'), e(30, 'session_end', { reason: 'quit' })]);
    assert.equal(s.chaseSec, 20);
    assert.equal(s.inChaseNow, false);
  });

  it('lacunas de seq', () => {
    seq = 0;
    const events = [e(0, 'session_start'), e(1, 'x'), e(2, 'x'), e(3, 'x')];
    assert.equal(summarizeGame([events[0], events[3]]).missingEvents, 2);
  });

  it('sem eventos e dados faltando não quebram', () => {
    const empty = summarizeGame([]);
    assert.equal(empty.attempts, 0);
    assert.equal(empty.tutorialSec, null);
    seq = 0;
    const s = summarizeGame([e(0, 'session_start'), e(5, 'key_collected'), e(6, 'key_collected'), e(7, 'bottle_thrown')]);
    assert.deepEqual(s.keys, { collected: 2, required: null });
    assert.equal(s.bottles, 1);
    assert.equal(s.attempts, 1);
  });
});
