import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { TimelineChart } from '../../components/TimelineChart.tsx';
import { colors, radius } from '../../components/theme.ts';
import { deleteSession, loadSession } from '../../db/database.ts';
import { getEventType, MANUAL_EVENT_TYPES } from '../../domain/eventTypes.ts';
import { countByType, eventsToCsv, formatMs } from '../../domain/format.ts';
import { sessionDuration, type ObsEvent, type Session } from '../../domain/session.ts';

export default function SessionTimelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const [data, setData] = useState<{ session: Session; events: ObsEvent[] } | null | undefined>(undefined);

  useEffect(() => {
    loadSession(database, Number(id))
      .then(setData)
      .catch((err) => {
        console.error(err);
        setData(null);
      });
  }, [database, id]);

  if (data === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Sessão não encontrada.</Text>
      </View>
    );
  }

  const { session, events } = data;
  // Sessões listadas aqui já estão encerradas, então `endedAt` define a duração.
  const duration = sessionDuration(session, session.endedAt ?? session.startedAt);
  const counts = countByType(events);

  const onShare = () => {
    Share.share({ title: `Playtest ${session.label}`, message: eventsToCsv(session, events) }).catch(console.error);
  };

  const onDelete = () => {
    Alert.alert('Excluir sessão?', 'Os eventos desta sessão serão apagados do aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          deleteSession(database, session.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{session.label}</Text>
        <Text style={styles.muted}>{new Date(session.startedAt).toLocaleString('pt-BR')}</Text>
        <Text style={styles.duration}>Duração: {formatMs(duration)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Resumo</Text>
        <View style={styles.chips}>
          {MANUAL_EVENT_TYPES.map((t) => (
            <View key={t.id} style={[styles.chip, { borderColor: t.color }]}>
              <Text style={[styles.chipCount, { color: t.color }]}>{counts.get(t.id) ?? 0}</Text>
              <Text style={styles.chipLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Linha do tempo</Text>
        <TimelineChart events={events} durationMs={duration} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Eventos ({events.length})</Text>
        {events.map((e) => {
          const def = getEventType(e.type);
          return (
            <View key={e.id} style={styles.eventRow}>
              <Text style={styles.eventTime}>{formatMs(e.tMs)}</Text>
              <View style={[styles.dot, { backgroundColor: def.color }]} />
              <Text style={[styles.eventLabel, !def.manual && styles.muted]}>{def.label}</Text>
            </View>
          );
        })}
      </View>

      <Pressable style={styles.primaryButton} onPress={onShare}>
        <Text style={styles.primaryButtonText}>Compartilhar CSV</Text>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={onDelete}>
        <Text style={styles.deleteButtonText}>Excluir sessão</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  duration: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted, fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: '30%', flexGrow: 1 },
  chipCount: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chipLabel: { fontSize: 12, color: colors.text },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  eventTime: { width: 64, fontVariant: ['tabular-nums'], fontWeight: '600', color: colors.text },
  eventLabel: { color: colors.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  deleteButton: { paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: colors.danger, fontWeight: '600' },
});
