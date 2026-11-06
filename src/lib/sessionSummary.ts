/**
 * Resumo da sessão do jogo, sempre **derivado** dos eventos (nunca guardado em
 * estado): valores que podem ser calculados a partir do estado não viram estado.
 */
import type { GameEvent } from './relay.ts';

export interface GameSummary {
  /** Duração do tutorial em segundos (durationSec do tutorial_end), ou null se não houve. */
  tutorialSec: number | null;
  captures: number;
  attempts: number;
  keys: { collected: number; required: number | null };
  bottles: number;
  /** patrol -> alert */
  alerts: number;
  /** qualquer entrada em chase */
  chases: number;
  /** saída de chase que não terminou em captura */
  lostPlayer: number;
  /** Soma dos intervalos em chase (segundos). */
  chaseSec: number;
  /** O monstro ainda está em caça no último evento recebido. */
  inChaseNow: boolean;
  escaped: boolean;
  ended: boolean;
  /** `reason` do session_end ("escaped" | "quit"), se houver. */
  endReason: string | null;
  /** Eventos do jogo que faltam pela sequência de `seq` (lacunas). */
  missingEvents: number;
}

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * Percorre os eventos em ordem de `seq` como uma máquina de estados do monstro.
 *
 * Decisão sobre "perdeu o jogador": pela regra do contrato, qualquer saída de
 * `chase` aparece na linha do tempo como "Monstro perdeu o jogador" — inclusive
 * a volta à patrulha logo após uma captura. No resumo, uma caça em que houve
 * `player_caught` conta como captura, não como perda.
 *
 * Caça ainda aberta no fim conta até o `session_end` (ou até o último evento).
 */
export function summarizeGame(events: readonly GameEvent[]): GameSummary {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const s: GameSummary = {
    tutorialSec: null,
    captures: 0,
    attempts: 0,
    keys: { collected: 0, required: null },
    bottles: 0,
    alerts: 0,
    chases: 0,
    lostPlayer: 0,
    chaseSec: 0,
    inChaseNow: false,
    escaped: false,
    ended: false,
    endReason: null,
    missingEvents: 0,
  };
  if (sorted.length === 0) return s;

  let maxAttempt = 1;
  let chaseStart: number | null = null;
  let caughtInChase = false;
  let endT = sorted[sorted.length - 1].t;

  for (const e of sorted) {
    const d = e.data ?? {};
    switch (e.type) {
      case 'tutorial_end':
        s.tutorialSec = num(d, 'durationSec') ?? e.t;
        break;
      case 'seeker_state': {
        const from = d.from;
        const to = d.to;
        if (from === 'patrol' && to === 'alert') s.alerts += 1;
        if (to === 'chase' && chaseStart === null) {
          s.chases += 1;
          chaseStart = e.t;
          caughtInChase = false;
        } else if (from === 'chase' && to !== 'chase' && chaseStart !== null) {
          s.chaseSec += Math.max(0, e.t - chaseStart);
          if (!caughtInChase) s.lostPlayer += 1;
          chaseStart = null;
        }
        break;
      }
      case 'player_caught':
        s.captures += 1;
        if (chaseStart !== null) caughtInChase = true;
        maxAttempt = Math.max(maxAttempt, num(d, 'attempt') ?? 1);
        break;
      case 'attempt_start':
        maxAttempt = Math.max(maxAttempt, num(d, 'attempt') ?? 1);
        break;
      case 'key_collected': {
        const total = num(d, 'total');
        s.keys.collected = Math.max(s.keys.collected + (total === null ? 1 : 0), total ?? 0);
        s.keys.required = num(d, 'required') ?? s.keys.required;
        break;
      }
      case 'bottle_thrown': {
        const total = num(d, 'total');
        s.bottles = Math.max(s.bottles + (total === null ? 1 : 0), total ?? 0);
        break;
      }
      case 'player_escaped':
        s.escaped = true;
        maxAttempt = Math.max(maxAttempt, num(d, 'attempts') ?? 1);
        break;
      case 'session_end':
        s.ended = true;
        s.endReason = typeof d.reason === 'string' ? d.reason : null;
        endT = e.t;
        break;
    }
  }

  if (chaseStart !== null) {
    s.chaseSec += Math.max(0, endT - chaseStart);
    s.inChaseNow = !s.ended;
  }
  s.attempts = maxAttempt;

  const seqs = new Set(sorted.map((e) => e.seq));
  s.missingEvents = sorted[sorted.length - 1].seq + 1 - seqs.size;
  return s;
}
