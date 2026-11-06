import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LiveClock } from '../components/LiveClock.tsx';
import { colors, radius } from '../components/theme.ts';
import { getEventType, MANUAL_EVENT_TYPES } from '../domain/eventTypes.ts';
import { countByType, formatMs } from '../domain/format.ts';
import { useSessionActions, useSessionState } from '../state/SessionProvider.tsx';

export default function LiveScreen() {
  // A tela não apaga durante a partida — o observador não pode perder um toque.
  useKeepAwake();
  const { status, session, events } = useSessionState();
  const { mark, undoLast, pause, resume, end } = useSessionActions();

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Nenhuma partida em andamento.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/')}>
          <Text style={styles.secondaryButtonText}>Voltar ao início</Text>
        </Pressable>
      </View>
    );
  }

  const paused = status === 'paused';
  const counts = countByType(events);
  const recent = events.slice(-4).reverse();

  const onUndo = () => {
    const removed = undoLast();
    if (removed) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  };

  const onEnd = () => {
    Alert.alert('Encerrar partida?', 'A sessão será fechada e você verá a linha do tempo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Encerrar',
        style: 'destructive',
        onPress: () => {
          const id = end();
          if (id !== null) router.replace(`/session/${id}`);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.muted}>{session.label}</Text>
        <LiveClock session={session} />
        {paused && <Text style={styles.pausedBadge}>PAUSADA — toques desativados</Text>}
      </View>

      <View style={styles.grid}>
        {MANUAL_EVENT_TYPES.map((t) => (
          <Pressable
            key={t.id}
            disabled={paused}
            // onPressIn (e não onPress): o horário é o do contato do dedo, sem
            // somar o tempo até soltar.
            onPressIn={() => {
              mark(t.id, Date.now());
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }}
            style={({ pressed }) => [
              styles.eventButton,
              { backgroundColor: t.color, opacity: paused ? 0.35 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.eventLabel}>{t.label}</Text>
            <Text style={styles.eventCount}>{counts.get(t.id) ?? 0}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.recent}>
        {recent.length === 0 ? (
          <Text style={styles.muted}>Os últimos eventos aparecem aqui.</Text>
        ) : (
          recent.map((e) => (
            <View key={e.id} style={styles.recentRow}>
              <Text style={styles.recentTime}>{formatMs(e.tMs)}</Text>
              <View style={[styles.dot, { backgroundColor: getEventType(e.type).color }]} />
              <Text style={styles.recentLabel}>{getEventType(e.type).label}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.toolbar}>
        <Pressable style={styles.secondaryButton} onPress={onUndo}>
          <Text style={styles.secondaryButtonText}>Desfazer</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={paused ? resume : pause}>
          <Text style={styles.secondaryButtonText}>{paused ? 'Retomar' : 'Pausar'}</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={onEnd}>
          <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>Encerrar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  container: { flex: 1, padding: 16, gap: 12 },
  header: { alignItems: 'center' },
  pausedBadge: { color: colors.warning, fontWeight: '700', fontSize: 12 },
  muted: { color: colors.muted, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  eventButton: {
    width: '48%',
    flexGrow: 1,
    minHeight: 92,
    borderRadius: radius,
    padding: 12,
    justifyContent: 'space-between',
  },
  eventLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  eventCount: { color: '#fff', fontSize: 22, fontWeight: '800', alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  recent: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentTime: { width: 64, color: colors.text, fontVariant: ['tabular-nums'], fontWeight: '600' },
  recentLabel: { color: colors.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  toolbar: { flexDirection: 'row', gap: 8 },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  secondaryButtonText: { fontWeight: '700', color: colors.text },
  dangerButton: { backgroundColor: colors.danger, borderColor: colors.danger },
});
