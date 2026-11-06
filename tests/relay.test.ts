import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backoffDelay,
  mergeGameEvents,
  parseGameEvent,
  parseRelayMessage,
  toRelayUrl,
  type GameEvent,
} from '../src/lib/relay.ts';

const ev = (seq: number, sessionId = 'abc', type = 'seeker_state'): GameEvent => ({
  v: 1,
  sessionId,
  seq,
  type,
  t: seq * 1.5,
  data: {},
});

describe('toRelayUrl', () => {
  it('completa porta e caminho', () => {
    assert.equal(toRelayUrl('192.168.0.12'), 'ws://192.168.0.12:8787/ws');
    assert.equal(toRelayUrl(' 192.168.0.12:8787 '), 'ws://192.168.0.12:8787/ws');
    assert.equal(toRelayUrl('192.168.0.12:9000'), 'ws://192.168.0.12:9000/ws');
  });

  it('aceita URLs completas', () => {
    assert.equal(toRelayUrl('ws://192.168.0.12:8787/ws'), 'ws://192.168.0.12:8787/ws');
    assert.equal(toRelayUrl('http://pc.local:8787'), 'ws://pc.local:8787/ws');
    assert.equal(toRelayUrl('https://relay.exemplo.com/'), 'wss://relay.exemplo.com:8787/ws');
    assert.equal(toRelayUrl('ws://10.0.0.2:8787/outro'), 'ws://10.0.0.2:8787/outro');
  });

  it('rejeita lixo', () => {
    for (const bad of ['', '   ', 'ftp://x', '192.168.0.12:99999', 'a b', '.com', 'x:0', 'http://']) {
      assert.equal(toRelayUrl(bad), null, bad);
    }
  });
});

describe('backoffDelay', () => {
  it('dobra até 10 s', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffDelay), [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });
});

describe('parseGameEvent', () => {
  it('aceita o contrato e descarta campos extras', () => {
    const e = parseGameEvent({ v: 1, sessionId: 's', seq: 0, type: 'session_start', t: 0, data: { map: 'm' }, x: 1 });
    assert.deepEqual(e, { v: 1, sessionId: 's', seq: 0, type: 'session_start', t: 0, data: { map: 'm' } });
  });

  it('data ausente vira objeto vazio', () => {
    assert.deepEqual(parseGameEvent({ v: 1, sessionId: 's', seq: 3, type: 'x', t: 2 })?.data, {});
  });

  it('rejeita campos obrigatórios inválidos', () => {
    const ok = { v: 1, sessionId: 's', seq: 0, type: 'x', t: 0 };
    for (const bad of [
      { ...ok, v: 2 },
      { ...ok, sessionId: '' },
      { ...ok, seq: -1 },
      { ...ok, seq: 1.5 },
      { ...ok, type: 3 },
      { ...ok, t: 'agora' },
      null,
      [ok],
    ]) {
      assert.equal(parseGameEvent(bad), null, JSON.stringify(bad));
    }
  });
});

describe('parseRelayMessage', () => {
  it('replay filtra eventos inválidos', () => {
    const msg = parseRelayMessage(JSON.stringify({ kind: 'replay', events: [ev(0), { v: 9 }, ev(1)] }));
    assert.equal(msg?.kind, 'replay');
    assert.equal(msg?.kind === 'replay' && msg.events.length, 2);
  });

  it('event e ping', () => {
    assert.equal(parseRelayMessage(JSON.stringify({ kind: 'event', event: ev(4) }))?.kind, 'event');
    assert.deepEqual(parseRelayMessage('{"kind":"ping"}'), { kind: 'ping' });
  });

  it('nunca lança com lixo', () => {
    for (const raw of ['', '{', 'null', '[]', '{"kind":"novo"}', '{"kind":"event","event":{}}', 42]) {
      assert.equal(parseRelayMessage(raw), null, String(raw));
    }
  });
});

describe('mergeGameEvents', () => {
  it('ignora sessionId + seq repetidos, inclusive dentro do mesmo lote', () => {
    const first = mergeGameEvents([], [ev(0), ev(1), ev(1)]);
    assert.equal(first.added, 2);
    assert.equal(first.duplicates, 1);
    // Replay depois de reconectar: só o 2 é novo.
    const second = mergeGameEvents(first.events, [ev(0), ev(1), ev(2)]);
    assert.equal(second.added, 1);
    assert.equal(second.duplicates, 2);
    assert.deepEqual(
      second.events.map((e) => e.seq),
      [0, 1, 2],
    );
  });

  it('mesmo seq em sessões diferentes não é duplicado', () => {
    assert.equal(mergeGameEvents([ev(0, 'a')], [ev(0, 'b')]).added, 1);
  });

  it('mantém a referência quando nada muda', () => {
    const list = [ev(0)];
    assert.equal(mergeGameEvents(list, [ev(0)]).events, list);
  });
});
