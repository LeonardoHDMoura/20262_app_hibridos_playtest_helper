import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import * as db from '../db/database.ts';
import { MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import {
  groupByGameSession,
  initialSessionState,
  nextOriginMs,
  routeGameEvents,
  secondsAt,
  sessionReducer,
  type ObsEvent,
  type Session,
  type SessionState,
} from '../domain/session.ts';
import type { GameEvent } from '../lib/relay.ts';
import { useGameLink } from './GameLinkProvider.tsx';

interface SessionActions {
  start: (label: string) => void;
  /** `pressedAt` deve ser capturado no onPressIn, para não somar o tempo do dedo na tela. */
  mark: (type: string, pressedAt?: number, note?: string | null) => void;
  undoLast: () => ObsEvent | null;
  /** Encerra a observação e devolve o id da sessão encerrada. */
  end: () => number | null;
}

const StateContext = createContext<SessionState | null>(null);
const ActionsContext = createContext<SessionActions | null>(null);

const MANUAL_IDS = new Set(MANUAL_EVENT_TYPES.map((t) => t.id));
const NO_FINISHED: ReadonlySet<string> = new Set();

function labelForGame(events: readonly GameEvent[], at: number): string {
  const start = events.find((e) => e.type === 'session_start');
  const map = start && typeof start.data.map === 'string' ? start.data.map : null;
  const time = new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return map ? `Jogo · ${map} · ${time}` : `Jogo · ${time}`;
}

/**
 * Estado global da observação em andamento, incluindo a sessão do jogo ligada.
 *
 * Regra de ouro: **persistir primeiro, despachar depois**. Marcações, eventos
 * do jogo, ligação com o jogo e origem do relógio passam pelo SQLite (escrita
 * síncrona) antes de chegar ao reducer — a tela nunca está "à frente" do disco.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const { subscribe } = useGameLink();
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  // Cópias síncronas: dois eventos seguidos (antes do re-render) precisam
  // enxergar a versão mais nova.
  const sessionRef = useRef<Session | null>(null);
  const eventsRef = useRef<ObsEvent[]>([]);
  const gameIdRef = useRef<string | null>(null);
  const gameOriginRef = useRef<number | null>(null);
  /** Eventos do jogo que chegaram antes de lermos o banco. */
  const hydratedRef = useRef(false);
  const pendingRef = useRef<{ events: GameEvent[]; receivedAt: number }[]>([]);

  useEffect(() => {
    eventsRef.current = state.events;
  }, [state.events]);

  const guard = useCallback(<T,>(what: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (err) {
      console.error(what, err);
      Alert.alert('Falha ao salvar', `${what}: ${String(err)}`);
      return null;
    }
  }, []);

  const recordEvent = useCallback(
    (type: string, wallMs: number, note: string | null = null): ObsEvent | null => {
      const session = sessionRef.current;
      if (!session) return null;
      return guard('Registrar evento', () => {
        const origin = gameOriginRef.current ?? session.startedAt;
        const event = db.insertObserverItem(database, {
          sessionId: session.id,
          type,
          wallMs,
          t: secondsAt(origin, wallMs),
          note,
        });
        eventsRef.current = [...eventsRef.current, event];
        dispatch({ type: 'ADD_EVENT', event });
        return event;
      });
    },
    [database, guard],
  );

  const startSession = useCallback(
    (label: string, at: number): Session | null =>
      guard('Iniciar sessão', () => {
        const session = db.insertSession(database, label.trim() || 'Sem nome', at);
        sessionRef.current = session;
        eventsRef.current = [];
        gameIdRef.current = null;
        gameOriginRef.current = null;
        dispatch({ type: 'START', session });
        return session;
      }),
    [database, guard],
  );

  const endSession = useCallback(
    (at: number): number | null => {
      const session = sessionRef.current;
      if (!session) return null;
      return guard('Encerrar', () => {
        db.saveSessionEnd(database, session.id, at);
        sessionRef.current = null;
        eventsRef.current = [];
        gameIdRef.current = null;
        gameOriginRef.current = null;
        dispatch({ type: 'END', at });
        return session.id;
      });
    },
    [database, guard],
  );

  /** Decide o destino de cada lote do jogo (ver routeGameEvents) e despacha. */
  const ingestGame = useCallback(
    (events: GameEvent[], receivedAt: number) => {
      if (!hydratedRef.current) {
        pendingRef.current.push({ events, receivedAt });
        return;
      }
      for (const [gameSessionId, group] of groupByGameSession(events)) {
        const isLinked = gameIdRef.current === gameSessionId;
        // Jogo com observação já encerrada no banco: o replay não pode reabri-lo.
        let finished = NO_FINISHED;
        if (!isLinked) {
          try {
            if (db.isGameSessionFinished(database, gameSessionId)) finished = new Set([gameSessionId]);
          } catch (err) {
            console.error(err);
          }
        }
        const route = routeGameEvents(
          {
            hasOpenSession: sessionRef.current !== null,
            linkedGameSessionId: gameIdRef.current,
            finishedGameSessionIds: finished,
          },
          gameSessionId,
          group,
        );
        if (route === 'ignore') continue;
        if (route === 'replace') endSession(receivedAt);
        if (route === 'start' || route === 'replace') {
          if (!startSession(labelForGame(group, receivedAt), receivedAt)) continue;
        }

        const session = sessionRef.current;
        if (!session) continue;
        const prevOrigin = gameIdRef.current === gameSessionId ? gameOriginRef.current : null;
        // Mesma conta que o reducer faz, para o banco e a tela concordarem.
        const origin = nextOriginMs(prevOrigin, group, receivedAt);
        const saved = guard('Gravar eventos do jogo', () => {
          db.insertGameEvents(database, session.id, group, receivedAt);
          if (gameIdRef.current !== gameSessionId || origin !== prevOrigin) {
            db.saveGameLink(database, session.id, gameSessionId, origin);
          }
          return true;
        });
        if (!saved) continue;

        gameIdRef.current = gameSessionId;
        gameOriginRef.current = origin;
        dispatch({ type: 'GAME_EVENTS', gameSessionId, events: group, receivedAt });
      }
    },
    [database, guard, endSession, startSession],
  );

  // 1) Reidratação: se o app morreu no meio da observação, ela volta.
  useEffect(() => {
    let cancelled = false;
    const finish = (open: db.LoadedSession | null) => {
      if (cancelled) return;
      sessionRef.current = open?.session ?? null;
      eventsRef.current = open?.events ?? [];
      gameIdRef.current = open?.game?.sessionId ?? null;
      gameOriginRef.current = open?.game?.originMs ?? null;
      dispatch({ type: 'HYDRATE', session: open?.session ?? null, events: open?.events ?? [], game: open?.game ?? null });
      hydratedRef.current = true;
      const pending = pendingRef.current;
      pendingRef.current = [];
      for (const p of pending) ingestGame(p.events, p.receivedAt);
    };
    db.loadOpenSession(database)
      .then(finish)
      .catch((err) => {
        console.error(err);
        finish(null);
      });
    return () => {
      cancelled = true;
    };
  }, [database, ingestGame]);

  // 2) Eventos do jogo vindos do relay.
  useEffect(() => subscribe((events, { receivedAt }) => ingestGame(events, receivedAt)), [subscribe, ingestGame]);

  // 3) Segundo plano: nada fica pendente (tudo já foi escrito), mas a ida/volta
  //    vira item da linha do tempo para mostrar lacunas de observação.
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = last === 'active';
      last = next;
      if (!sessionRef.current) return;
      if (wasActive && next === 'background') recordEvent('app_segundo_plano', Date.now());
      else if (!wasActive && next === 'active') recordEvent('app_voltou', Date.now());
    });
    return () => sub.remove();
  }, [recordEvent]);

  const actions = useMemo<SessionActions>(
    () => ({
      start(label) {
        if (sessionRef.current) return;
        startSession(label, Date.now());
      },

      mark(type, pressedAt = Date.now(), note = null) {
        recordEvent(type, pressedAt, note);
      },

      undoLast() {
        const last = [...eventsRef.current].reverse().find((e) => MANUAL_IDS.has(e.type));
        if (!last) return null;
        return guard('Desfazer', () => {
          db.deleteObserverItem(database, last.id);
          eventsRef.current = eventsRef.current.filter((e) => e.id !== last.id);
          dispatch({ type: 'REMOVE_EVENT', id: last.id });
          return last;
        });
      },

      end() {
        return endSession(Date.now());
      },
    }),
    [database, guard, recordEvent, startSession, endSession],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useSessionState(): SessionState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('useSessionState precisa estar dentro de <SessionProvider>');
  return ctx;
}

export function useSessionActions(): SessionActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useSessionActions precisa estar dentro de <SessionProvider>');
  return ctx;
}
