/**
 * Protocolo entre o app e o relay (ver relay/server.js), sem dependências de
 * React Native, para poder ser testado com node:test.
 *
 * Contrato de eventos v1 (igual ao do jogo): { v: 1, sessionId, seq, type, t, data }
 */

export interface GameEvent {
  v: 1;
  /** GUID gerado pelo jogo ao iniciar a sessão. */
  sessionId: string;
  /** Inteiro crescente por sessão, a partir de 0. Chave de dedup: sessionId + seq. */
  seq: number;
  type: string;
  /** Segundos desde o session_start, em tempo real (não para no pause). */
  t: number;
  data: Record<string, unknown>;
}

export type RelayMessage =
  | { kind: 'replay'; events: GameEvent[] }
  | { kind: 'event'; event: GameEvent }
  /** Batida de coração do relay: só prova que a conexão está viva. */
  | { kind: 'ping' };

export const DEFAULT_RELAY_PORT = 8787;

/**
 * Converte o que o usuário digitou em uma URL de WebSocket.
 *   "192.168.0.12"            -> "ws://192.168.0.12:8787/ws"
 *   "192.168.0.12:9000"       -> "ws://192.168.0.12:9000/ws"
 *   "http://pc.local:8787"    -> "ws://pc.local:8787/ws"
 *   "ws://192.168.0.12:8787/ws" (como está)
 * Devolve null se não der para entender o endereço.
 */
export function toRelayUrl(input: string): string | null {
  const match = /^(?:(wss?|https?):\/\/)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?(\/\S*)?$/.exec(input.trim());
  if (!match) return null;
  const [, scheme, host, portStr, path] = match;
  if (host.startsWith('.') || host.endsWith('.') || host.startsWith('-')) return null;
  const port = portStr ? Number(portStr) : DEFAULT_RELAY_PORT;
  if (port < 1 || port > 65535) return null;
  const secure = scheme === 'wss' || scheme === 'https';
  const finalPath = path && path !== '/' ? path : '/ws';
  return `${secure ? 'wss' : 'ws'}://${host}:${port}${finalPath}`;
}

/** Espera antes da tentativa seguinte: 1 s, 2 s, 4 s, 8 s, 10 s, 10 s… */
export function backoffDelay(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures), 10_000);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Valida um evento do contrato v1. Campos extras são descartados. */
export function parseGameEvent(x: unknown): GameEvent | null {
  if (!isRecord(x)) return null;
  const { v, sessionId, seq, type, t, data } = x;
  if (v !== 1) return null;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof type !== 'string' || type.length === 0) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  return { v: 1, sessionId, seq, type, t, data: isRecord(data) ? data : {} };
}

/**
 * Lê uma mensagem do WebSocket. Mensagens desconhecidas ou malformadas viram
 * null (nunca lançam), e eventos inválidos dentro de um replay são descartados.
 */
export function parseRelayMessage(raw: unknown): RelayMessage | null {
  if (typeof raw !== 'string') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(msg)) return null;
  switch (msg.kind) {
    case 'replay': {
      if (!Array.isArray(msg.events)) return null;
      const events = msg.events.map(parseGameEvent).filter((e): e is GameEvent => e !== null);
      return { kind: 'replay', events };
    }
    case 'event': {
      const event = parseGameEvent(msg.event);
      return event ? { kind: 'event', event } : null;
    }
    case 'ping':
      return { kind: 'ping' };
    default:
      return null;
  }
}

export const gameEventKey = (e: Pick<GameEvent, 'sessionId' | 'seq'>): string => `${e.sessionId}#${e.seq}`;

/**
 * Junta eventos novos a uma lista sem repetir `sessionId + seq`. Devolve a
 * mesma lista (mesma referência) se nada mudou.
 */
export function mergeGameEvents(
  current: readonly GameEvent[],
  incoming: readonly GameEvent[],
): { events: GameEvent[]; added: number; duplicates: number } {
  const seen = new Set(current.map(gameEventKey));
  const fresh: GameEvent[] = [];
  for (const e of incoming) {
    const key = gameEventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(e);
  }
  const duplicates = incoming.length - fresh.length;
  if (fresh.length === 0) return { events: current as GameEvent[], added: 0, duplicates };
  return { events: [...current, ...fresh], added: fresh.length, duplicates };
}
