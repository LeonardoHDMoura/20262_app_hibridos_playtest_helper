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
 * "Perdeu o jogador" segue a regra da linha do tempo: toda saída de `chase`
 * conta, mesmo que a entrada em caça não tenha chegado. Única exceção: o reset
 * do monstro causado por uma captura. A captura (ou um attempt_start no meio
 * da caça) encerra a caça na hora, e a primeira saída de `chase` depois dela é
 * o reset — também quando ela vem colada logo antes do player_caught. Não
 * dependemos de o jogo mandar esse reset: se não mandar, a caça já foi fechada.
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
  /** t em que a caça atual começou, ou null fora de caça. */
  let chaseStart: number | null = null;
  /**
   * A captura (ou nova tentativa) encerrou a caça; a próxima saída de `chase`
   * que o jogo mandar é só o reset do monstro, não uma perda. Vale até a
   * próxima entrada em caça — assim nunca "engole" uma perda real depois.
   */
  let resetPending = false;
  let endT = sorted[sorted.length - 1].t;

  const closeChase = (t: number) => {
    if (chaseStart === null) return;
    s.chaseSec += Math.max(0, t - chaseStart);
    chaseStart = null;
  };

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const d = e.data ?? {};
    switch (e.type) {
      case 'tutorial_end':
        s.tutorialSec = num(d, 'durationSec') ?? e.t;
        break;
      case 'seeker_state': {
        const from = d.from;
        const to = d.to;
        if (from === 'patrol' && to === 'alert') s.alerts += 1;
        if (to === 'chase') {
          if (chaseStart === null) {
            s.chases += 1;
            chaseStart = e.t;
          }
          resetPending = false;
        } else if (from === 'chase') {
          // Mesma regra da linha do tempo: toda saída de chase é "perdeu o
          // jogador", mesmo que a entrada não tenha chegado. Exceções: o reset
          // depois de uma captura, e a saída que vem colada antes do
          // player_caught (jogos que avisam o reset antes da captura).
          const next = sorted[i + 1];
          const captureRightAfter = next?.type === 'player_caught' && next.t - e.t <= 1;
          closeChase(e.t);
          if (resetPending) resetPending = false;
          else if (!captureRightAfter) s.lostPlayer += 1;
        }
        break;
      }
      case 'player_caught':
        s.captures += 1;
        if (chaseStart !== null) {
          closeChase(e.t);
          resetPending = true;
        }
        maxAttempt = Math.max(maxAttempt, num(d, 'attempt') ?? 1);
        break;
      case 'attempt_start':
        // Nova tentativa no meio de uma caça: a caça acabou (o jogo pode
        // reiniciar sem mandar player_caught).
        if (chaseStart !== null) {
          closeChase(e.t);
          resetPending = true;
        }
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
    s.inChaseNow = !s.ended;
    closeChase(endT);
  }
  s.attempts = maxAttempt;

  const seqs = new Set(sorted.map((e) => e.seq));
  s.missingEvents = sorted[sorted.length - 1].seq + 1 - seqs.size;
  return s;
}
