import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatMs } from '../domain/format.ts';
import { elapsedAt, type Session } from '../domain/session.ts';
import { colors } from './theme.ts';

/**
 * Relógio da partida. O intervalo serve só para redesenhar: o valor exibido é
 * sempre recalculado a partir de timestamps absolutos, então não "atrasa" se o
 * JS ficar suspenso em segundo plano. O estado local fica aqui dentro para não
 * re-renderizar a tela inteira 10x por segundo.
 */
export function LiveClock({ session }: { session: Session }) {
  const [now, setNow] = useState(() => Date.now());

  const paused = session.pausedAt !== null;

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [paused]);

  // Pausado, o tempo fica congelado exatamente no instante da pausa.
  const shownAt = session.pausedAt ?? now;
  return <Text style={[styles.clock, paused && styles.paused]}>{formatMs(elapsedAt(session, shownAt))}</Text>;
}

const styles = StyleSheet.create({
  clock: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  paused: { color: colors.warning },
});
