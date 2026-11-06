import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import type { EventTone } from '../lib/eventLabels.ts';
import { formatSeconds, type TimelineItem } from '../lib/timeline.ts';
import { TONE_COLOR } from './TimelineItemRow.tsx';
import { colors } from './theme.ts';

const LANE_HEIGHT = 20;
const LABEL_WIDTH = 116;

interface Lane {
  key: string;
  label: string;
  color: string;
}

/** Raias do jogo, nesta ordem. */
const SEEKER_LANES: Partial<Record<EventTone, Lane>> = {
  alert: { key: 'g:alert', label: 'Jogo · alerta', color: TONE_COLOR.alert },
  chase: { key: 'g:chase', label: 'Jogo · caça', color: TONE_COLOR.chase },
  lost: { key: 'g:lost', label: 'Jogo · perdeu', color: TONE_COLOR.lost },
};
const GAME_LANES: Record<string, Lane> = {
  player_caught: { key: 'g:caught', label: 'Jogo · captura', color: TONE_COLOR.danger },
  key_collected: { key: 'g:key', label: 'Jogo · chave', color: TONE_COLOR.item },
  bottle_thrown: { key: 'g:bottle', label: 'Jogo · garrafa', color: TONE_COLOR.item },
};
const MILESTONES: Lane = { key: 'g:milestone', label: 'Jogo · marcos', color: TONE_COLOR.neutral };
const SYSTEM: Lane = { key: 'o:system', label: 'App', color: colors.muted };

const LANE_ORDER = [
  ...Object.values(SEEKER_LANES).map((l) => l!.key),
  ...Object.values(GAME_LANES).map((l) => l.key),
  MILESTONES.key,
  ...MANUAL_EVENT_TYPES.map((t) => `o:${t.id}`),
  SYSTEM.key,
];

function laneOf(item: TimelineItem): Lane {
  if (item.source === 'game') {
    if (item.type === 'seeker_state') return SEEKER_LANES[item.tone ?? 'neutral'] ?? MILESTONES;
    return GAME_LANES[item.type] ?? MILESTONES;
  }
  if (item.system) return SYSTEM;
  return { key: `o:${item.type}`, label: item.label, color: item.color ?? colors.primary };
}

/**
 * Linha do tempo em "raias": uma linha por tipo de evento, cada marca na
 * posição proporcional ao tempo. Facilita ver padrões, p.ex. se o jogador se
 * assusta logo depois de o monstro entrar em caça.
 */
export function TimelineChart({ items, durationSec }: { items: readonly TimelineItem[]; durationSec: number }) {
  const [width, setWidth] = useState(0);

  const lanes = new Map<string, { lane: Lane; items: TimelineItem[] }>();
  for (const item of items) {
    const lane = laneOf(item);
    const entry = lanes.get(lane.key) ?? { lane, items: [] };
    entry.items.push(item);
    lanes.set(lane.key, entry);
  }
  const rows = [...lanes.values()].sort((a, b) => LANE_ORDER.indexOf(a.lane.key) - LANE_ORDER.indexOf(b.lane.key));

  if (rows.length === 0) return <Text style={styles.empty}>Nenhum evento.</Text>;

  // Marcações antes do jogo têm t < 0: o eixo começa no menor t.
  const minT = Math.min(0, ...items.map((i) => i.t));
  const maxT = Math.max(durationSec, ...items.map((i) => i.t), minT + 1);
  const span = maxT - minT;
  const x = (t: number) => Math.min(width - 3, Math.max(0, ((t - minT) / span) * width));

  return (
    <View>
      {rows.map(({ lane, items: laneItems }) => (
        <View key={lane.key} style={styles.lane}>
          <Text style={styles.laneLabel} numberOfLines={1}>
            {lane.label}
          </Text>
          <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 && minT < 0 && <View style={[styles.zero, { left: x(0) }]} />}
            {width > 0 &&
              laneItems.map((i) => <View key={i.key} style={[styles.mark, { left: x(i.t), backgroundColor: lane.color }]} />)}
          </View>
        </View>
      ))}
      <View style={styles.axis}>
        <Text style={styles.axisText}>{formatSeconds(minT)}</Text>
        <Text style={styles.axisText}>{formatSeconds(minT + span / 2)}</Text>
        <Text style={styles.axisText}>{formatSeconds(maxT)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: { flexDirection: 'row', alignItems: 'center', height: LANE_HEIGHT, marginBottom: 4 },
  laneLabel: { width: LABEL_WIDTH, fontSize: 11, color: colors.muted, paddingRight: 6 },
  track: { flex: 1, height: LANE_HEIGHT, backgroundColor: '#EFF0F3', borderRadius: 4 },
  mark: { position: 'absolute', top: 2, bottom: 2, width: 3, borderRadius: 1.5 },
  zero: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.muted },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: LABEL_WIDTH, marginTop: 2 },
  axisText: { fontSize: 10, color: colors.muted, fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, fontStyle: 'italic' },
});
