/**
 * Tradução evento do jogo -> texto da linha do tempo. Puro e testável
 * (tests/eventLabels.test.ts). Tipos desconhecidos nunca quebram: aparecem com
 * o nome cru do `type`.
 */
import type { GameEvent } from './relay.ts';

/** Tom visual do item; a cor de cada tom fica no componente. */
export type EventTone = 'neutral' | 'alert' | 'chase' | 'lost' | 'calm' | 'danger' | 'item' | 'success';

export interface EventText {
  label: string;
  /** Linha secundária opcional (motivo, mapa…). */
  detail?: string;
  tone: EventTone;
}

const num = (data: Record<string, unknown>, key: string): number | null => {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const str = (data: Record<string, unknown>, key: string): string | null => {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

/** "(N)" se o número existir, senão nada. */
const paren = (n: number | null): string => (n === null ? '' : ` (${n})`);

function seekerText(data: Record<string, unknown>): EventText {
  const from = str(data, 'from');
  const to = str(data, 'to');
  const reason = str(data, 'reason');
  const detail = reason ? `motivo: ${reason}` : undefined;

  if (to === 'chase') return { label: 'Monstro achou o jogador (caça)', detail, tone: 'chase' };
  if (from === 'chase' && to !== null) return { label: 'Monstro perdeu o jogador', detail, tone: 'lost' };
  if (from === 'patrol' && to === 'alert') return { label: 'Monstro entrou em alerta', detail, tone: 'alert' };
  if (from === 'alert' && to === 'patrol') return { label: 'Monstro voltou à patrulha', detail, tone: 'calm' };
  if (from && to) return { label: `Monstro: ${from} → ${to}`, detail, tone: 'neutral' };
  return { label: 'Monstro mudou de estado', detail, tone: 'neutral' };
}

export function gameEventText(event: Pick<GameEvent, 'type' | 'data'>): EventText {
  const d = event.data ?? {};
  switch (event.type) {
    case 'session_start': {
      const parts = [str(d, 'map'), str(d, 'model'), str(d, 'build') && `build ${str(d, 'build')}`].filter(Boolean);
      return { label: 'Sessão iniciada', detail: parts.length ? parts.join(' · ') : undefined, tone: 'neutral' };
    }
    case 'tutorial_end': {
      const s = num(d, 'durationSec');
      return { label: s === null ? 'Tutorial concluído' : `Tutorial concluído em ${Math.round(s)} s`, tone: 'success' };
    }
    case 'seeker_state':
      return seekerText(d);
    case 'player_caught': {
      const n = num(d, 'attempt');
      return { label: `Monstro pegou o jogador${n === null ? '' : ` (tentativa ${n})`}`, tone: 'danger' };
    }
    case 'attempt_start':
      return { label: `Nova tentativa${paren(num(d, 'attempt'))}`, tone: 'neutral' };
    case 'key_collected': {
      const total = num(d, 'total');
      const required = num(d, 'required');
      const count = total === null ? '' : required === null ? ` (${total})` : ` (${total}/${required})`;
      return { label: `Chave coletada${count}`, tone: 'item' };
    }
    case 'bottle_thrown': {
      const total = num(d, 'total');
      return { label: `Garrafa arremessada${total === null ? '' : ` (total ${total})`}`, tone: 'item' };
    }
    case 'player_escaped':
      return { label: 'Jogador escapou', tone: 'success' };
    case 'session_end': {
      const reason = str(d, 'reason');
      return { label: 'Sessão encerrada', detail: reason ? `motivo: ${reason}` : undefined, tone: 'neutral' };
    }
    default:
      return { label: event.type, tone: 'neutral' };
  }
}
