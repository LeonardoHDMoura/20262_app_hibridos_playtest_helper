import type { ObsEvent } from './session.ts';

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

/** Quantidade de cada tipo de evento, na ordem do catálogo. */
export function countByType(events: ObsEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}
