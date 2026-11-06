import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConnectionStatus } from '../hooks/useGameEvents.ts';
import { useGameLink } from '../state/GameLinkProvider.tsx';
import { colors } from './theme.ts';

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: 'conectado',
  connecting: 'conectando',
  reconnecting: 'reconectando',
  disconnected: 'desconectado',
};

export const CONNECTION_COLOR: Record<ConnectionStatus, string> = {
  connected: '#30A46C',
  connecting: colors.warning,
  reconnecting: colors.warning,
  disconnected: colors.muted,
};

/** Estado da conexão com o jogo, sempre visível no cabeçalho. Toque abre a configuração. */
export function ConnectionBadge() {
  const { connection } = useGameLink();
  const { status } = connection;
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Jogo ${CONNECTION_LABEL[status]}. Abrir configuração do relay`}
      style={styles.badge}
    >
      <View style={[styles.dot, { backgroundColor: CONNECTION_COLOR[status] }]} />
      <Text style={styles.text}>Jogo: {CONNECTION_LABEL[status]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: '600', color: colors.text },
});
