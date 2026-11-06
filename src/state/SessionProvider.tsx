import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import * as db from '../db/database.ts';
import { MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import {
  applyEnd,
  applyPause,
  applyResume,
  elapsedAt,
  initialSessionState,
  sessionReducer,
  type ObsEvent,
  type Session,
  type SessionState,
} from '../domain/session.ts';

interface SessionActions {
  start: (label: string) => void;
  /** `pressedAt` deve ser capturado no onPressIn, para não somar o tempo do dedo na tela. */
  mark: (type: string, pressedAt?: number, note?: string | null) => void;
  undoLast: () => ObsEvent | null;
  pause: () => void;
  resume: () => void;
  /** Encerra a partida e devolve o id da sessão encerrada. */
  end: () => number | null;
}

const StateContext = createContext<SessionState | null>(null);
const ActionsContext = createContext<SessionActions | null>(null);

const MANUAL_IDS = new Set(MANUAL_EVENT_TYPES.map((t) => t.id));

/**
 * Estado global da partida em andamento.
 *
 * Regra de ouro: **persistir primeiro, despachar depois**. Toda action passa
 * pelo SQLite (escrita síncrona) antes de chegar ao reducer, então o que está
 * na tela nunca está "à frente" do que está no disco.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  // Cópia síncrona da sessão: dois toques seguidos (antes do re-render) ou um
  // toque logo após "pausar" precisam enxergar a versão mais nova.
  const sessionRef = useRef<Session | null>(null);
  const eventsRef = useRef<ObsEvent[]>([]);
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
        const event = db.insertEvent(database, {
          sessionId: session.id,
          type,
          tMs: elapsedAt(session, wallMs),
          wallMs,
          note,
        });
        eventsRef.current = [...eventsRef.current, event];
        dispatch({ type: 'ADD_EVENT', event });
        return event;
      });
    },
    [database, guard],
  );

  // 1) Reidratação: se o app morreu no meio da partida, a sessão aberta volta.
  useEffect(() => {
    let cancelled = false;
    db.loadOpenSession(database)
      .then((open) => {
        if (cancelled) return;
        sessionRef.current = open?.session ?? null;
        dispatch({ type: 'HYDRATE', session: open?.session ?? null, events: open?.events ?? [] });
      })
      .catch((err) => {
        console.error(err);
        dispatch({ type: 'HYDRATE', session: null, events: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [database]);

  // 2) Segundo plano: não há nada pendente para "salvar às pressas" (tudo já foi
  //    escrito), mas marcamos a ida/volta na linha do tempo para mostrar lacunas
  //    de observação.
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
        guard('Iniciar partida', () => {
          const session = db.insertSession(database, label.trim() || 'Sem nome', Date.now());
          sessionRef.current = session;
          dispatch({ type: 'START', session });
        });
      },

      mark(type, pressedAt = Date.now(), note = null) {
        const session = sessionRef.current;
        if (!session || session.pausedAt !== null) return;
        recordEvent(type, pressedAt, note);
      },

      undoLast() {
        const last = [...eventsRef.current].reverse().find((e) => MANUAL_IDS.has(e.type));
        if (!last) return null;
        return guard('Desfazer', () => {
          db.deleteEvent(database, last.id);
          eventsRef.current = eventsRef.current.filter((e) => e.id !== last.id);
          dispatch({ type: 'REMOVE_EVENT', id: last.id });
          return last;
        });
      },

      pause() {
        const session = sessionRef.current;
        if (!session || session.pausedAt !== null) return;
        const at = Date.now();
        recordEvent('pausa', at);
        guard('Pausar', () => {
          const next = applyPause(session, at);
          db.saveSessionTiming(database, next);
          sessionRef.current = next;
          dispatch({ type: 'PAUSE', at });
        });
      },

      resume() {
        const session = sessionRef.current;
        if (!session || session.pausedAt === null) return;
        const at = Date.now();
        guard('Retomar', () => {
          const next = applyResume(session, at);
          db.saveSessionTiming(database, next);
          sessionRef.current = next;
          dispatch({ type: 'RESUME', at });
        });
        recordEvent('retomada', at);
      },

      end() {
        const session = sessionRef.current;
        if (!session) return null;
        const at = Date.now();
        return guard('Encerrar', () => {
          db.saveSessionTiming(database, applyEnd(session, at));
          sessionRef.current = null;
          eventsRef.current = [];
          dispatch({ type: 'END', at });
          return session.id;
        });
      },
    }),
    [database, guard, recordEvent],
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
