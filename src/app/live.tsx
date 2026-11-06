import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LiveClock } from '../components/LiveClock.tsx';
import { SessionSummary } from '../components/SessionSummary.tsx';
import { TimelineList } from '../components/TimelineList.tsx';
import { colors, radius } from '../components/theme.ts';
import { BUTTON_EVENT_TYPES } from '../domain/eventTypes.ts';
import { countByType } from '../domain/format.ts';
import { gameEnded, timelineOriginMs } from '../domain/session.ts';
import { gameEventText } from '../lib/eventLabels.ts';
import { buildTimeline } from '../lib/timeline.ts';
import { useGameLink } from '../state/GameLinkProvider.tsx';
import { useSessionActions, useSessionState } from '../state/SessionProvider.tsx';

export default function LiveScreen() {
  // A tela não apaga durante a partida — o observador não pode perder um toque.
  useKeepAwake();
  const { session, events, game } = useSessionState();
  const { mark, undoLast, end } = useSessionActions();
  const { connection } = useGameLink();

  const timeline = useMemo(() => (session ? buildTimeline(session, events, game) : []), [session, events, game]);

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

  const counts = countByType(events);
  const ended = gameEnded(game);
  const endEvent = ended ? game?.events.find((e) => e.type === 'session_end') : undefined;
  const startEvent = game?.events.find((e) => e.type === 'session_start');

  const gameLine = game
    ? `Jogo ligado${startEvent ? ` · ${gameEventText(startEvent).detail ?? ''}` : ''}`
    : connection.status === 'connected'
      ? 'Aguardando o jogo iniciar a sessão…'
      : 'Jogo não conectado — as marcações manuais funcionam normalmente.';

  const onUndo = () => {
    const removed = undoLast();
    if (removed) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  };

  const finish = () => {
    const id = end();
    if (id !== null) router.replace(`/session/${id}`);
  };

  const onEnd = () => {
    Alert.alert('Encerrar observação?', 'A sessão será fechada e você verá a linha do tempo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Encerrar', style: 'destructive', onPress: finish },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.muted} numberOfLines={1}>
          {session.label}
        </Text>
        <LiveClock originMs={timelineOriginMs(session, game)} frozenAt={endEvent ? endEvent.t : null} />
        <Text style={[styles.gameLine, game && styles.gameLineLinked]} numberOfLines={1}>
          {gameLine}
        </Text>
      </View>

      <SessionSummary game={game} observerEvents={events} compact />

      {ended && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>O jogo encerrou a sessão. Marque o que faltar e encerre a observação.</Text>
          <Pressable style={styles.bannerButton} onPress={finish}>
            <Text style={styles.bannerButtonText}>Encerrar</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.grid}>
        {BUTTON_EVENT_TYPES.map((t) => (
          <Pressable
            key={t.id}
            // onPressIn (e não onPress): o horário é o do contato do dedo, sem
            // somar o tempo até soltar.
            onPressIn={() => {
              mark(t.id, Date.now());
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }}
            style={({ pressed }) => [styles.eventButton, { backgroundColor: t.color, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.eventLabel} numberOfLines={2}>
              {t.label}
            </Text>
            <Text style={styles.eventCount}>{counts.get(t.id) ?? 0}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.timeline}>
        <TimelineList items={timeline} follow emptyText="Os eventos do jogo e as suas marcações aparecem aqui." />
      </View>

      <View style={styles.toolbar}>
        <Pressable style={styles.secondaryButton} onPress={onUndo}>
          <Text style={styles.secondaryButtonText}>Desfazer</Text>
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
  container: { flex: 1, padding: 12, gap: 10 },
  header: { alignItems: 'center' },
  muted: { color: colors.muted, fontSize: 13 },
  gameLine: { color: colors.muted, fontSize: 12 },
  gameLineLinked: { color: colors.text, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF4D5',
    borderRadius: radius,
    borderWidth: 1,
    borderColor: '#F3D673',
    padding: 10,
  },
  bannerText: { flex: 1, color: colors.text, fontSize: 13 },
  bannerButton: { backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  bannerButtonText: { color: '#fff', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eventButton: {
    width: '48%',
    flexGrow: 1,
    minHeight: 64,
    borderRadius: radius,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  eventLabel: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 15 },
  eventCount: { color: '#fff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeline: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
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
