import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import { countByType } from '../domain/format.ts';
import type { GameLink, ObsEvent } from '../domain/session.ts';
import { summarizeGame, type GameSummary } from '../lib/sessionSummary.ts';
import { formatSeconds } from '../lib/timeline.ts';
import { TONE_COLOR } from './TimelineItemRow.tsx';
import { colors } from './theme.ts';

interface Stat {
  key: string;
  label: string;
  value: string;
  color?: string;
  note?: string;
}

function resultText(s: GameSummary): string {
  if (s.escaped) return 'Escapou';
  if (s.ended) return s.endReason === 'quit' ? 'Desistiu' : 'Encerrada';
  return 'Em andamento';
}

function gameStats(s: GameSummary): Stat[] {
  return [
    { key: 'result', label: 'Resultado', value: resultText(s), color: s.escaped ? TONE_COLOR.success : undefined },
    { key: 'tutorial', label: 'Tutorial', value: s.tutorialSec === null ? '—' : `${Math.round(s.tutorialSec)} s` },
    { key: 'attempts', label: 'Tentativas', value: String(s.attempts) },
    { key: 'captures', label: 'Capturas', value: String(s.captures), color: TONE_COLOR.danger },
    {
      key: 'keys',
      label: 'Chaves',
      value: s.keys.required === null ? String(s.keys.collected) : `${s.keys.collected}/${s.keys.required}`,
      color: TONE_COLOR.item,
    },
    { key: 'bottles', label: 'Garrafas', value: String(s.bottles), color: TONE_COLOR.item },
    { key: 'alerts', label: 'Entrou em alerta', value: String(s.alerts), color: TONE_COLOR.alert },
    { key: 'chases', label: 'Entrou em caça', value: String(s.chases), color: TONE_COLOR.chase },
    {
      key: 'lost',
      label: 'Perdeu o jogador',
      value: String(s.lostPlayer),
      color: TONE_COLOR.lost,
      note: 'caças que não terminaram em captura',
    },
    {
      key: 'chaseTime',
      label: 'Tempo em caça',
      value: formatSeconds(s.chaseSec),
      color: TONE_COLOR.chase,
      note: s.inChaseNow ? 'caça em andamento' : undefined,
    },
  ];
}

/**
 * Resumo da sessão, calculado na hora a partir dos eventos (nada disso é
 * estado). `compact` mostra uma faixa rolável para a tela da partida.
 */
export function SessionSummary({
  game,
  observerEvents,
  compact = false,
}: {
  game: GameLink | null;
  observerEvents: readonly ObsEvent[];
  compact?: boolean;
}) {
  const summary = useMemo(() => (game ? summarizeGame(game.events) : null), [game]);

  if (compact) {
    if (!summary) return null;
    const pick = ['captures', 'chases', 'chaseTime', 'lost', 'keys', 'bottles', 'alerts'];
    const stats = gameStats(summary).filter((s) => pick.includes(s.key));
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripWrap}
        contentContainerStyle={styles.strip}
      >
        {stats.map((s) => (
          <View key={s.key} style={styles.pill}>
            <Text style={[styles.pillValue, s.color ? { color: s.color } : null]}>{s.value}</Text>
            <Text style={styles.pillLabel}>{s.label}</Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  const counts = countByType([...observerEvents]);
  // Botões atuais sempre aparecem; os aposentados só em sessões que os usaram.
  const observerTypes = MANUAL_EVENT_TYPES.filter((t) => !t.retired || (counts.get(t.id) ?? 0) > 0);
  return (
    <View style={{ gap: 14 }}>
      <View>
        <Text style={styles.sectionTitle}>Jogo</Text>
        {summary ? (
          <>
            <View style={styles.grid}>
              {gameStats(summary).map((s) => (
                <View key={s.key} style={styles.tile}>
                  <Text style={[styles.tileValue, s.color ? { color: s.color } : null]}>{s.value}</Text>
                  <Text style={styles.tileLabel}>{s.label}</Text>
                  {s.note ? <Text style={styles.tileNote}>{s.note}</Text> : null}
                </View>
              ))}
            </View>
            {summary.missingEvents > 0 && (
              <Text style={styles.warning}>
                {summary.missingEvents} evento(s) do jogo faltando (lacunas na sequência). Os números acima podem estar
                incompletos.
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.muted}>Sem jogo ligado nesta sessão.</Text>
        )}
      </View>

      <View>
        <Text style={styles.sectionTitle}>Observador</Text>
        <View style={styles.grid}>
          {observerTypes.map((t) => (
            <View key={t.id} style={[styles.tile, { borderColor: t.color }]}>
              <Text style={[styles.tileValue, { color: t.color }]}>{counts.get(t.id) ?? 0}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    minWidth: '30%',
    flexGrow: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tileValue: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 12, color: colors.text },
  tileNote: { fontSize: 10, color: colors.muted },
  warning: { marginTop: 8, color: colors.warning, fontSize: 12 },
  stripWrap: { flexGrow: 0 },
  strip: { gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillValue: { fontSize: 14, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  pillLabel: { fontSize: 11, color: colors.muted },
});
