import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CONNECTION_COLOR, CONNECTION_LABEL } from '../components/ConnectionBadge.tsx';
import { colors, radius } from '../components/theme.ts';
import { toRelayUrl, type GameEvent } from '../lib/relay.ts';
import { useGameLink } from '../state/GameLinkProvider.tsx';

export default function SettingsScreen() {
  const { address, url, setAddress, connection, feed, clearFeed } = useGameLink();
  const [draft, setDraft] = useState(address);

  const draftUrl = toRelayUrl(draft);
  const changed = draft.trim() !== address;
  const canSave = draftUrl !== null && changed;

  // Mais novo primeiro.
  const rows = [...feed.events].reverse();

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={rows}
      keyExtractor={(e) => `${e.sessionId}#${e.seq}`}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Relay do jogo</Text>
            <Text style={styles.muted}>
              Digite o endereço que o relay mostra ao iniciar no PC (ex.: 192.168.0.12:8787). Celular e PC precisam
              estar na mesma rede.
            </Text>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="192.168.0.12:8787"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={() => canSave && setAddress(draft)}
            />
            <Text style={[styles.muted, draft.trim() && !draftUrl && { color: colors.danger }]}>
              {draft.trim() === '' ? 'Sem endereço: o app funciona só com marcações manuais.' : draftUrl ?? 'Endereço inválido.'}
            </Text>
            <View style={styles.buttons}>
              <Pressable
                style={[styles.primaryButton, !canSave && styles.disabled]}
                disabled={!canSave}
                onPress={() => setAddress(draft)}
              >
                <Text style={styles.primaryButtonText}>Salvar e conectar</Text>
              </Pressable>
              {address !== '' && (
                <Pressable style={styles.secondaryButton} onPress={() => setAddress('')}>
                  <Text style={styles.secondaryButtonText}>Desconectar</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: CONNECTION_COLOR[connection.status] }]} />
              <Text style={styles.cardTitle}>{CONNECTION_LABEL[connection.status]}</Text>
            </View>
            <Text style={styles.muted}>{url ?? 'nenhum relay configurado'}</Text>
            {connection.status === 'reconnecting' && (
              <Text style={styles.muted}>{connection.failures} tentativa(s) sem sucesso — tentando de novo sozinho.</Text>
            )}
            {feed.lastMessageAt !== null && (
              <Text style={styles.muted}>
                Último evento recebido às {new Date(feed.lastMessageAt).toLocaleTimeString('pt-BR')}
              </Text>
            )}
          </View>

          <View style={styles.feedHeader}>
            <Text style={styles.sectionTitle}>Eventos crus ({feed.events.length})</Text>
            {feed.received > 0 && (
              <Pressable onPress={clearFeed} hitSlop={8}>
                <Text style={styles.link}>Limpar</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.muted}>
            {feed.received} recebidos · {feed.duplicates} duplicados ignorados · {feed.replays} replay(s)
          </Text>
          {rows.length === 0 && <Text style={styles.muted}>Nenhum evento do jogo ainda.</Text>}
        </View>
      }
      renderItem={({ item }) => <RawEventRow event={item} />}
    />
  );
}

function RawEventRow({ event }: { event: GameEvent }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.seq}>#{event.seq}</Text>
        <Text style={styles.time}>{event.t.toFixed(1)} s</Text>
        <Text style={styles.type}>{event.type}</Text>
      </View>
      <Text style={styles.data} numberOfLines={2}>
        {event.sessionId.slice(0, 8)} · {JSON.stringify(event.data)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
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
  buttons: { flexDirection: 'row', gap: 8 },
  primaryButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: { fontWeight: '700', color: colors.text },
  disabled: { opacity: 0.4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  link: { color: colors.primary, fontWeight: '600' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'baseline' },
  seq: { width: 36, fontWeight: '700', color: colors.muted, fontVariant: ['tabular-nums'] },
  time: { width: 56, fontVariant: ['tabular-nums'], color: colors.text },
  type: { flex: 1, fontWeight: '600', color: colors.text },
  data: { fontSize: 11, color: colors.muted, fontFamily: 'monospace' },
});
