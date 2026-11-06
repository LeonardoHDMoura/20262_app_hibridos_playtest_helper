import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EventTone } from '../lib/eventLabels.ts';
import { formatSeconds, type TimelineItem } from '../lib/timeline.ts';
import { colors } from './theme.ts';

export const TONE_COLOR: Record<EventTone, string> = {
  neutral: '#60646C',
  alert: '#F76B15',
  chase: '#E5484D',
  lost: '#12A594',
  calm: '#8B8D98',
  danger: '#1C2024',
  item: '#AB6400',
  success: '#30A46C',
};

const SOURCE_LABEL = { game: 'Jogo', observer: 'Observador' } as const;

/** Uma linha da linha do tempo. Jogo: fundo cinza e etiqueta "Jogo"; observador: fundo branco e etiqueta azul. */
export const TimelineItemRow = memo(function TimelineItemRow({ item }: { item: TimelineItem }) {
  const isGame = item.source === 'game';
  const accent = isGame ? TONE_COLOR[item.tone ?? 'neutral'] : (item.color ?? colors.primary);
  return (
    <View style={[styles.row, isGame ? styles.gameRow : styles.observerRow, { borderLeftColor: accent }]}>
      <Text style={[styles.time, item.t < 0 && styles.negative]}>{formatSeconds(item.t)}</Text>
      <View style={styles.body}>
        <Text style={[styles.label, item.system && styles.system]} numberOfLines={2}>
          {item.label}
        </Text>
        {item.detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {item.detail}
          </Text>
        ) : null}
      </View>
      <View style={[styles.tag, isGame ? styles.gameTag : styles.observerTag]}>
        <Text style={[styles.tagText, isGame ? styles.gameTagText : styles.observerTagText]}>{SOURCE_LABEL[item.source]}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderLeftWidth: 4,
    borderRadius: 6,
    marginBottom: 4,
  },
  gameRow: { backgroundColor: '#EFF0F3' },
  observerRow: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  time: { width: 52, fontVariant: ['tabular-nums'], fontWeight: '700', color: colors.text },
  negative: { color: colors.muted },
  body: { flex: 1 },
  label: { color: colors.text, fontSize: 14 },
  system: { color: colors.muted, fontStyle: 'italic' },
  detail: { color: colors.muted, fontSize: 11 },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  gameTag: { backgroundColor: '#DDDEE3' },
  observerTag: { backgroundColor: '#E6EDFE' },
  tagText: { fontSize: 10, fontWeight: '700' },
  gameTagText: { color: '#3A3D44' },
  observerTagText: { color: colors.primary },
});
