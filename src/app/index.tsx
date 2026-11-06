import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../components/theme.ts';
import { listFinishedSessions, type SessionSummary } from '../db/database.ts';
import { formatMs } from '../domain/format.ts';
import { sessionDuration } from '../domain/session.ts';
import { useSessionActions, useSessionState } from '../state/SessionProvider.tsx';

export default function HomeScreen() {
  const database = useSQLiteContext();
  const { status, session, game } = useSessionState();
  const { start } = useSessionActions();
  const [label, setLabel] = useState('');
  const [history, setHistory] = useState<SessionSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      listFinishedSessions(database).then(setHistory).catch(console.error);
    }, [database]),
  );

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const onStart = () => {
    start(label);
    setLabel('');
    router.push('/live');
  };

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={history}
      keyExtractor={(s) => String(s.id)}
      ListHeaderComponent={
        <View>
          {session ? (
            <View style={[styles.card, styles.activeCard]}>
              <Text style={styles.cardTitle}>Partida em andamento</Text>
              <Text style={styles.muted}>
                {session.label} · {game ? 'jogo ligado' : 'gravando'}
              </Text>
              <Pressable style={styles.primaryButton} onPress={() => router.push('/live')}>
                <Text style={styles.primaryButtonText}>Voltar para a partida</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nova partida</Text>
              <Text style={styles.muted}>
                Toque em “Iniciar” no mesmo instante em que o jogador começa. Todos os eventos são gravados em
                relação a esse momento.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Participante ou identificação (ex.: P03)"
                value={label}
                onChangeText={setLabel}
                returnKeyType="go"
                onSubmitEditing={onStart}
              />
              <Pressable style={styles.primaryButton} onPress={onStart}>
                <Text style={styles.primaryButtonText}>Iniciar partida</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.sectionTitle}>Sessões anteriores</Text>
          {history.length === 0 && <Text style={styles.muted}>Nenhuma sessão encerrada ainda.</Text>}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/session/${item.id}`)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.label}</Text>
            <Text style={styles.muted}>{new Date(item.startedAt).toLocaleString('pt-BR')}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.rowTitle}>{formatMs(sessionDuration(item, item.endedAt ?? item.startedAt))}</Text>
            <Text style={styles.muted}>
              {item.observerCount} marcações{item.gameCount > 0 ? ` · ${item.gameCount} do jogo` : ''}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
    marginBottom: 16,
  },
  activeCard: { borderColor: colors.primary, borderWidth: 2 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
});
