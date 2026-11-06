import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatSeconds } from '../lib/timeline.ts';
import { colors } from './theme.ts';

/**
 * Relógio da sessão, no mesmo tempo da linha do tempo (o do jogo, quando há um
 * ligado). O intervalo serve só para redesenhar: o valor é sempre recalculado a
 * partir de `originMs`, então não "atrasa" se o JS ficar suspenso em segundo
 * plano. `frozenAt` (segundos) para o relógio — usado quando o jogo encerrou.
 */
export function LiveClock({ originMs, frozenAt = null }: { originMs: number; frozenAt?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const frozen = frozenAt !== null;

  useEffect(() => {
    if (frozen) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [frozen]);

  const seconds = frozen ? frozenAt : (now - originMs) / 1000;
  return <Text style={[styles.clock, frozen && styles.frozen]}>{formatSeconds(seconds)}</Text>;
}

const styles = StyleSheet.create({
  clock: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  frozen: { color: colors.muted },
});
