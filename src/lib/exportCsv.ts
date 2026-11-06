/** Exportação da linha do tempo unificada em CSV (para planilha ou relatório). */
import type { GameLink, Session } from '../domain/session.ts';
import { formatSeconds, type TimelineItem } from './timeline.ts';

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export const CSV_HEADER = [
  'sessao',
  'participante',
  'sessao_jogo',
  'fonte',
  'seq',
  'tempo_s',
  'tempo',
  'tipo',
  'texto',
  'detalhe',
  'horario_iso',
  'dados',
  'nota',
] as const;

/**
 * Uma linha por item, na ordem da linha do tempo. `horario_iso` é o horário do
 * toque (observador) ou o horário estimado no relógio do celular (jogo: origem + t).
 */
export function timelineToCsv(session: Session, game: GameLink | null, items: readonly TimelineItem[]): string {
  const origin = game ? game.originMs : session.startedAt;
  const rows = items.map((i) => {
    const wall = i.source === 'observer' ? (i.wallMs ?? origin + i.t * 1000) : origin + i.t * 1000;
    return [
      session.id,
      session.label,
      game?.sessionId ?? '',
      i.source === 'game' ? 'jogo' : 'observador',
      i.seq ?? '',
      i.t.toFixed(3),
      formatSeconds(i.t),
      i.type,
      i.label,
      i.detail ?? '',
      new Date(Math.round(wall)).toISOString(),
      i.data ? JSON.stringify(i.data) : '',
      i.note ?? '',
    ];
  });
  return [CSV_HEADER as readonly (string | number)[], ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
