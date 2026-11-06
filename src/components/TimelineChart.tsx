import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EVENT_TYPES } from '../domain/eventTypes.ts';
import { formatMs } from '../domain/format.ts';
import type { ObsEvent } from '../domain/session.ts';
import { colors } from './theme.ts';

const LANE_HEIGHT = 22;
const LABEL_WIDTH = 110;

/**
 * Linha do tempo em "raias": uma linha por tipo de evento, cada marca na posição
 * proporcional ao tempo de partida. Facilita ver padrões, p.ex. vários
 * "antecipou a ronda" seguidos depois da primeira captura.
 */
export function TimelineChart({ events, durationMs }: { events: ObsEvent[]; durationMs: number }) {
  const [width, setWidth] = useState(0);
  const total = Math.max(durationMs, 1);

  const present = new Set(events.map((e) => e.type));
  const lanes = EVENT_TYPES.filter((t) => t.manual && present.has(t.id));
  const systemEvents = events.filter((e) => !lanes.some((l) => l.id === e.type));

  const rows = [
    ...lanes.map((l) => ({ key: l.id, label: l.label, color: l.color, items: events.filter((e) => e.type === l.id) })),
    ...(systemEvents.length ? [{ key: 'sistema', label: 'Sistema', color: colors.muted, items: systemEvents }] : []),
  ];

  if (rows.length === 0) {
    return <Text style={styles.empty}>Nenhum evento marcado.</Text>;
  }

  return (
    <View>
      {rows.map((row) => (
        <View key={row.key} style={styles.lane}>
          <Text style={styles.laneLabel} numberOfLines={1}>
            {row.label}
          </Text>
          <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 &&
              row.items.map((e) => (
                <View
                  key={e.id}
                  style={[styles.mark, { left: Math.min(width - 3, (e.tMs / total) * width), backgroundColor: row.color }]}
                />
              ))}
          </View>
        </View>
      ))}
      <View style={styles.axis}>
        <Text style={styles.axisText}>00:00.0</Text>
        <Text style={styles.axisText}>{formatMs(total / 2)}</Text>
        <Text style={styles.axisText}>{formatMs(total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: { flexDirection: 'row', alignItems: 'center', height: LANE_HEIGHT, marginBottom: 4 },
  laneLabel: { width: LABEL_WIDTH, fontSize: 11, color: colors.muted, paddingRight: 6 },
  track: { flex: 1, height: LANE_HEIGHT, backgroundColor: '#EFF0F3', borderRadius: 4 },
  mark: { position: 'absolute', top: 2, bottom: 2, width: 3, borderRadius: 1.5 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: LABEL_WIDTH, marginTop: 2 },
  axisText: { fontSize: 10, color: colors.muted, fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, fontStyle: 'italic' },
});
