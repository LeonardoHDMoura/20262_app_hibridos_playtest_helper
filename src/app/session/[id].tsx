import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SessionSummary } from '../../components/SessionSummary.tsx';
import { TimelineChart } from '../../components/TimelineChart.tsx';
import { TimelineItemRow } from '../../components/TimelineItemRow.tsx';
import { colors, radius } from '../../components/theme.ts';
import { deleteSession, loadSession, type LoadedSession } from '../../db/database.ts';
import { formatMs } from '../../domain/format.ts';
import { secondsAt, sessionDuration, timelineOriginMs } from '../../domain/session.ts';
import { timelineToCsv } from '../../lib/exportCsv.ts';
import { buildTimeline } from '../../lib/timeline.ts';

export default function SessionTimelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const [data, setData] = useState<LoadedSession | null | undefined>(undefined);
  const items = useMemo(() => (data ? buildTimeline(data.session, data.events, data.game) : []), [data]);

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

  const { session, events, game } = data;
  // Sessões listadas aqui já estão encerradas, então `endedAt` define a duração.
  const endMs = session.endedAt ?? session.startedAt;
  const duration = sessionDuration(session, endMs);
  const durationSec = secondsAt(timelineOriginMs(session, game), endMs);
  const gameCount = items.filter((i) => i.source === 'game').length;

  const onShare = () => {
    Share.share({ title: `Playtest ${session.label}`, message: timelineToCsv(session, game, items) }).catch(console.error);
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
        <Text style={styles.duration}>Duração da observação: {formatMs(duration)}</Text>
        <Text style={styles.muted}>
          {game ? `Jogo ligado · ${gameCount} eventos do jogo` : 'Sem jogo ligado (só marcações manuais)'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Resumo</Text>
        <SessionSummary game={game} observerEvents={events} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Linha do tempo</Text>
        <TimelineChart items={items} durationSec={durationSec} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Eventos ({items.length})</Text>
        {items.map((item) => (
          <TimelineItemRow key={item.key} item={item} />
        ))}
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
  primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  deleteButton: { paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: colors.danger, fontWeight: '600' },
});
