import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ConnectionBadge } from '../components/ConnectionBadge.tsx';
import { DATABASE_NAME, migrateDbIfNeeded } from '../db/database.ts';
import { GameLinkProvider } from '../state/GameLinkProvider.tsx';
import { SessionProvider } from '../state/SessionProvider.tsx';
import { colors } from '../components/theme.ts';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
      <GameLinkProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.bg },
              headerRight: () => <ConnectionBadge />,
            }}
          >
            <Stack.Screen name="index" options={{ title: 'Playtest Helper' }} />
            <Stack.Screen name="live" options={{ title: 'Partida', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="session/[id]" options={{ title: 'Linha do tempo' }} />
            <Stack.Screen name="settings" options={{ title: 'Conexão com o jogo', headerRight: () => null }} />
          </Stack>
        </SessionProvider>
      </GameLinkProvider>
    </SQLiteProvider>
  );
}
