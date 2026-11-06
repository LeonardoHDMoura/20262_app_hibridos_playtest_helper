/**
 * Núcleo puro do app: tipos, relógio da sessão, reducer e roteamento dos
 * eventos do jogo.
 *
 * Nada aqui toca React Native, SQLite ou relógio do sistema — o horário sempre
 * chega pronto dentro da action. Isso deixa o reducer determinístico e testável
 * (ver tests/session.test.ts).
 */
import { mergeGameEvents, type GameEvent } from '../lib/relay.ts';

export interface Session {
  id: number;
  label: string;
  /** Início da observação em epoch ms (relógio de parede do celular). */
  startedAt: number;
  /** Fim da observação em epoch ms, ou null se ainda está em andamento. */
  endedAt: number | null;
}

/** Marcação manual do observador (ou evento automático do app, como "app em 2º plano"). */
export interface ObsEvent {
  id: number;
  sessionId: number;
  type: string;
  /** Epoch ms do toque. O t na linha do tempo é derivado daqui e da origem. */
  wallMs: number;
  note: string | null;
}

/** Sessão do jogo ligada à observação atual. */
export interface GameLink {
  /** GUID do jogo (`sessionId` do contrato). */
  sessionId: string;
  /**
   * Relógio do celular (epoch ms) que corresponde a t = 0 do jogo.
   *
   * Sincronização: cada evento recebido diz "isto aconteceu em t, e chegou
   * agora", então `chegada - t` é um limite superior para a origem (o evento
   * nunca chega antes de acontecer). Guardamos o menor valor visto. No
   * session_start ao vivo isso é exatamente `Date.now() - t*1000`; se o app
   * conectou no meio da partida, o session_start veio atrasado pelo replay e o
   * primeiro evento ao vivo corrige a origem. Marcações manuais guardam o
   * horário do toque, então são realinhadas de graça quando a origem muda.
   */
  originMs: number;
  /** Eventos do jogo, sem repetir `sessionId + seq`, na ordem de chegada. */
  events: GameEvent[];
}

export type SessionStatus = 'loading' | 'idle' | 'running';

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  events: ObsEvent[];
  game: GameLink | null;
}

export type SessionAction =
  | { type: 'HYDRATE'; session: Session | null; events: ObsEvent[]; game: GameLink | null }
  | { type: 'START'; session: Session }
  | { type: 'ADD_EVENT'; event: ObsEvent }
  | { type: 'REMOVE_EVENT'; id: number }
  | { type: 'GAME_EVENTS'; gameSessionId: string; events: GameEvent[]; receivedAt: number }
  | { type: 'END'; at: number };

export const initialSessionState: SessionState = { status: 'loading', session: null, events: [], game: null };

/**
 * t = 0 da linha do tempo: a origem do jogo, se houver um ligado; senão, o
 * toque em "Iniciar". Marcações feitas antes do jogo começar ficam com t < 0.
 */
export function timelineOriginMs(session: Session, game: GameLink | null): number {
  return game ? game.originMs : session.startedAt;
}

/** Segundos de linha do tempo para um instante do relógio do celular. */
export function secondsAt(originMs: number, wallMs: number): number {
  return (wallMs - originMs) / 1000;
}

/** Duração da observação (até o fim, ou até agora se ainda está aberta). */
export function sessionDuration(session: Session, nowMs: number): number {
  return Math.max(0, (session.endedAt ?? nowMs) - session.startedAt);
}

/**
 * Nova origem do relógio após receber `events` em `receivedAt` (ver GameLink):
 * o menor `chegada - t` entre a origem atual e os eventos recebidos.
 */
export function nextOriginMs(current: number | null, events: readonly GameEvent[], receivedAt: number): number {
  const candidate = Math.min(...events.map((e) => receivedAt - e.t * 1000));
  return current === null ? candidate : Math.min(current, candidate);
}

export function gameEnded(game: GameLink | null): boolean {
  return !!game && game.events.some((e) => e.type === 'session_end');
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'HYDRATE': {
      const session = action.session && action.session.endedAt === null ? action.session : null;
      return {
        status: session ? 'running' : 'idle',
        session,
        events: session ? sortEvents(action.events) : [],
        game: session && action.game ? action.game : null,
      };
    }

    case 'START':
      return { status: 'running', session: action.session, events: [], game: null };

    case 'ADD_EVENT': {
      if (!state.session || action.event.sessionId !== state.session.id) return state;
      if (state.events.some((e) => e.id === action.event.id)) return state;
      return { ...state, events: sortEvents([...state.events, action.event]) };
    }

    case 'REMOVE_EVENT':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };

    case 'GAME_EVENTS': {
      if (!state.session) return state;
      if (state.game && state.game.sessionId !== action.gameSessionId) return state;
      const incoming = action.events.filter((e) => e.sessionId === action.gameSessionId);
      if (incoming.length === 0) return state;

      const prev = state.game;
      const merged = mergeGameEvents(prev?.events ?? [], incoming);
      const originMs = nextOriginMs(prev?.originMs ?? null, incoming, action.receivedAt);
      if (prev && merged.added === 0 && originMs === prev.originMs) return state;

      return { ...state, game: { sessionId: action.gameSessionId, originMs, events: merged.events } };
    }

    case 'END':
      if (!state.session) return state;
      return { status: 'idle', session: null, events: [], game: null };

    default:
      return state;
  }
}

/** O que fazer com um lote de eventos de uma sessão do jogo. */
export type GameRoute =
  /** Já é a sessão ligada: só acrescentar. */
  | 'append'
  /** Há observação aberta sem jogo: ligar a ela (e realinhar as marcações). */
  | 'link'
  /** Nenhuma observação aberta: criar uma para este jogo. */
  | 'start'
  /** Observação aberta ligada a outro jogo, e este começou agora: encerrar a atual e criar outra. */
  | 'replace'
  | 'ignore';

export interface GameRouteContext {
  hasOpenSession: boolean;
  linkedGameSessionId: string | null;
  /** Jogos cujas observações já foram encerradas (o replay não pode reabri-los). */
  finishedGameSessionIds: ReadonlySet<string>;
}

export function routeGameEvents(ctx: GameRouteContext, gameSessionId: string, events: readonly GameEvent[]): GameRoute {
  if (ctx.linkedGameSessionId === gameSessionId) return 'append';
  if (ctx.finishedGameSessionIds.has(gameSessionId)) return 'ignore';

  const hasStart = events.some((e) => e.type === 'session_start');
  // Um jogo que já terminou (replay antigo guardado no relay) não abre nem
  // captura observação nova.
  const alreadyOver = events.some((e) => e.type === 'session_end');
  if (alreadyOver) return 'ignore';

  if (ctx.hasOpenSession) {
    // Sem session_start também liga: cobre o relay reiniciado no meio da partida.
    if (ctx.linkedGameSessionId === null) return 'link';
    return hasStart ? 'replace' : 'ignore';
  }
  return hasStart ? 'start' : 'ignore';
}

/** Agrupa um lote por sessão do jogo, mantendo a ordem de chegada. */
export function groupByGameSession(events: readonly GameEvent[]): Map<string, GameEvent[]> {
  const groups = new Map<string, GameEvent[]>();
  for (const e of events) {
    const list = groups.get(e.sessionId);
    if (list) list.push(e);
    else groups.set(e.sessionId, [e]);
  }
  return groups;
}

function sortEvents(events: ObsEvent[]): ObsEvent[] {
  return [...events].sort((a, b) => a.wallMs - b.wallMs || a.id - b.id);
}
