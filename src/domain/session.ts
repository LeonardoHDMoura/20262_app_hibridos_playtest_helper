/**
 * Núcleo puro do app: tipos, cálculo de tempo e o reducer da sessão.
 *
 * Nada aqui toca React Native, SQLite ou relógio do sistema — o horário sempre
 * chega pronto dentro da action. Isso deixa o reducer determinístico e testável
 * (ver tests/session.test.ts).
 */

export interface Session {
  id: number;
  label: string;
  /** Início da partida em epoch ms (relógio de parede). */
  startedAt: number;
  /** Fim da partida em epoch ms, ou null se ainda está em andamento. */
  endedAt: number | null;
  /** Total de ms já passados em pausas encerradas. */
  pausedMs: number;
  /** Epoch ms em que a pausa atual começou, ou null se não está pausada. */
  pausedAt: number | null;
}

export interface ObsEvent {
  id: number;
  sessionId: number;
  type: string;
  /** Tempo de partida (ms desde o início, descontando pausas) no momento do toque. */
  tMs: number;
  /** Epoch ms do toque — guardado para auditoria/reprocessamento. */
  wallMs: number;
  note: string | null;
}

export type SessionStatus = 'loading' | 'idle' | 'running' | 'paused';

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  events: ObsEvent[];
}

export type SessionAction =
  | { type: 'HYDRATE'; session: Session | null; events: ObsEvent[] }
  | { type: 'START'; session: Session }
  | { type: 'ADD_EVENT'; event: ObsEvent }
  | { type: 'REMOVE_EVENT'; id: number }
  | { type: 'PAUSE'; at: number }
  | { type: 'RESUME'; at: number }
  | { type: 'END'; at: number };

export const initialSessionState: SessionState = { status: 'loading', session: null, events: [] };

/**
 * Tempo de partida em `wallMs`: tempo de parede desde o início menos o tempo
 * pausado. Como depende só de timestamps absolutos, continua correto mesmo que
 * o JS fique congelado em segundo plano ou que o processo seja morto e reaberto.
 */
export function elapsedAt(session: Session, wallMs: number): number {
  const end = session.endedAt !== null ? Math.min(wallMs, session.endedAt) : wallMs;
  const currentPause = session.pausedAt !== null ? Math.max(0, end - session.pausedAt) : 0;
  return Math.max(0, end - session.startedAt - session.pausedMs - currentPause);
}

/** Duração total da partida (até o fim, ou até agora se ainda está aberta). */
export function sessionDuration(session: Session, nowMs: number): number {
  return elapsedAt(session, session.endedAt ?? nowMs);
}

function statusOf(session: Session | null): SessionStatus {
  if (!session || session.endedAt !== null) return 'idle';
  return session.pausedAt !== null ? 'paused' : 'running';
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'HYDRATE': {
      const session = action.session && action.session.endedAt === null ? action.session : null;
      return { status: statusOf(session), session, events: session ? sortEvents(action.events) : [] };
    }

    case 'START':
      return { status: statusOf(action.session), session: action.session, events: [] };

    case 'ADD_EVENT': {
      if (!state.session || action.event.sessionId !== state.session.id) return state;
      if (state.events.some((e) => e.id === action.event.id)) return state;
      return { ...state, events: sortEvents([...state.events, action.event]) };
    }

    case 'REMOVE_EVENT':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };

    case 'PAUSE':
      if (state.status !== 'running' || !state.session) return state;
      return { ...state, status: 'paused', session: applyPause(state.session, action.at) };

    case 'RESUME':
      if (state.status !== 'paused' || !state.session) return state;
      return { ...state, status: 'running', session: applyResume(state.session, action.at) };

    case 'END':
      if (!state.session) return state;
      return { status: 'idle', session: null, events: [] };

    default:
      return state;
  }
}

/**
 * Aplica pausa/retomada/fim a uma sessão — usado pelo provider para calcular o
 * registro exato que vai para o banco antes de despachar a action.
 */
export function applyPause(session: Session, at: number): Session {
  return session.pausedAt !== null ? session : { ...session, pausedAt: at };
}

export function applyResume(session: Session, at: number): Session {
  if (session.pausedAt === null) return session;
  return { ...session, pausedMs: session.pausedMs + Math.max(0, at - session.pausedAt), pausedAt: null };
}

export function applyEnd(session: Session, at: number): Session {
  // Fechar uma pausa aberta antes de encerrar mantém a duração consistente.
  const resumed = applyResume(session, at);
  return { ...resumed, endedAt: at };
}

function sortEvents(events: ObsEvent[]): ObsEvent[] {
  return [...events].sort((a, b) => a.tMs - b.tMs || a.id - b.id);
}
