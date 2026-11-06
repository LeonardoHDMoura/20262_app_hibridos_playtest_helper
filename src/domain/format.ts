import { getEventType } from './eventTypes.ts';
import type { ObsEvent, Session } from './session.ts';

/** 83456 -> "01:23.4" ; acima de 1h -> "1:02:03.4" */
export function formatMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const tenths = Math.floor((safe % 1000) / 100);
  const totalSec = Math.floor(safe / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const str = String(value);
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** CSV de uma sessão, pronto para colar numa planilha ou anexar ao relatório. */
export function eventsToCsv(session: Session, events: ObsEvent[]): string {
  const header = ['sessao', 'participante', 'tempo_ms', 'tempo', 'evento_id', 'evento', 'categoria', 'horario_iso', 'nota'];
  const rows = events.map((e) => {
    const def = getEventType(e.type);
    return [
      session.id,
      session.label,
      e.tMs,
      formatMs(e.tMs),
      e.type,
      def.label,
      def.category,
      new Date(e.wallMs).toISOString(),
      e.note,
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Quantidade de cada tipo de evento, na ordem do catálogo. */
export function countByType(events: ObsEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}
