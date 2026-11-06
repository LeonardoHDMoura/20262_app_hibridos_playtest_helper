/**
 * Monta a linha do tempo unificada (jogo + observador). Tudo aqui é derivado
 * do estado — nada vira estado próprio.
 */
import { getEventType } from '../domain/eventTypes.ts';
import { secondsAt, timelineOriginMs, type GameLink, type ObsEvent, type Session } from '../domain/session.ts';
import { gameEventText, type EventTone } from './eventLabels.ts';

export type TimelineSource = 'game' | 'observer';

export interface TimelineItem {
  key: string;
  source: TimelineSource;
  /** Segundos desde o início da sessão (pode ser negativo: antes do jogo começar). */
  t: number;
  type: string;
  label: string;
  detail?: string;
  /** Jogo: tom do evento. Observador: cor do botão. */
  tone?: EventTone;
  color?: string;
  /** Evento automático do app (2º plano etc.), mostrado mais discreto. */
  system?: boolean;
  /** Jogo: número de sequência e dados crus do evento. */
  seq?: number;
  data?: Record<string, unknown>;
  /** Observador: horário do toque e nota. */
  wallMs?: number;
  note?: string | null;
}

export function buildTimeline(session: Session, observerEvents: readonly ObsEvent[], game: GameLink | null): TimelineItem[] {
  const origin = timelineOriginMs(session, game);

  const fromObserver: TimelineItem[] = observerEvents.map((e) => {
    const def = getEventType(e.type);
    return {
      key: `o${e.id}`,
      source: 'observer',
      t: secondsAt(origin, e.wallMs),
      type: e.type,
      label: def.label,
      color: def.color,
      system: !def.manual,
      wallMs: e.wallMs,
      note: e.note,
    };
  });

  const fromGame: TimelineItem[] = (game?.events ?? []).map((e) => {
    const text = gameEventText(e);
    return {
      key: `g${e.sessionId}#${e.seq}`,
      source: 'game',
      t: e.t,
      type: e.type,
      label: text.label,
      detail: text.detail,
      tone: text.tone,
      seq: e.seq,
      data: e.data,
    };
  });

  // Empate no mesmo segundo: jogo antes do observador (a reação vem depois).
  return [...fromGame, ...fromObserver].sort(
    (a, b) => a.t - b.t || (a.source === b.source ? 0 : a.source === 'game' ? -1 : 1),
  );
}

/** 83.4 -> "01:23" ; -4.2 -> "-00:04" ; 3723 -> "1:02:03" */
export function formatSeconds(t: number): string {
  const sign = t < 0 ? '-' : '';
  const total = Math.floor(Math.abs(t));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${sign}${h > 0 ? `${h}:` : ''}${mmss}`;
}
