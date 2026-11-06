import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useGameEvents, type GameConnection } from '../hooks/useGameEvents.ts';
import { mergeGameEvents, toRelayUrl, type GameEvent, type RelayMessage } from '../lib/relay.ts';

const ADDRESS_KEY = 'relay.address';
const FEED_LIMIT = 500;

/** Eventos crus recebidos do relay (diagnóstico), já sem duplicados. */
export interface GameFeed {
  events: GameEvent[];
  /** Total de eventos recebidos, contando repetidos. */
  received: number;
  duplicates: number;
  replays: number;
  lastMessageAt: number | null;
}

type FeedAction = { type: 'MESSAGE'; events: GameEvent[]; replay: boolean; at: number } | { type: 'CLEAR' };

const initialFeed: GameFeed = { events: [], received: 0, duplicates: 0, replays: 0, lastMessageAt: null };

function feedReducer(state: GameFeed, action: FeedAction): GameFeed {
  if (action.type === 'CLEAR') return initialFeed;
  const merged = mergeGameEvents(state.events, action.events);
  return {
    events: merged.events.length > FEED_LIMIT ? merged.events.slice(-FEED_LIMIT) : merged.events,
    received: state.received + action.events.length,
    duplicates: state.duplicates + merged.duplicates,
    replays: state.replays + (action.replay ? 1 : 0),
    lastMessageAt: action.at,
  };
}

/** Recebe cada lote do relay com o instante de chegada (base da sincronização de relógio). */
export type GameEventsListener = (events: GameEvent[], info: { replay: boolean; receivedAt: number }) => void;

interface GameLinkValue {
  /** Endereço como o usuário digitou (ex.: "192.168.0.12:8787"). */
  address: string;
  /** URL do WebSocket derivada do endereço, ou null se vazio/inválido. */
  url: string | null;
  setAddress: (value: string) => void;
  connection: GameConnection;
  feed: GameFeed;
  clearFeed: () => void;
  /** Inscreve um ouvinte dos eventos do jogo; devolve a função de cancelar. */
  subscribe: (listener: GameEventsListener) => () => void;
}

const GameLinkContext = createContext<GameLinkValue | null>(null);

function readSavedAddress(): string {
  try {
    return Storage.getItemSync(ADDRESS_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Conexão com o relay do jogo, aberta uma única vez para o app inteiro. */
export function GameLinkProvider({ children }: { children: ReactNode }) {
  const [address, setAddressState] = useState(readSavedAddress);
  const url = useMemo(() => toRelayUrl(address), [address]);
  const [feed, dispatchFeed] = useReducer(feedReducer, initialFeed);

  const listenersRef = useRef(new Set<GameEventsListener>());

  const onMessage = useCallback((msg: RelayMessage) => {
    // Capturado assim que a mensagem chega, antes de qualquer processamento.
    const receivedAt = Date.now();
    if (msg.kind === 'ping') return;
    const events = msg.kind === 'replay' ? msg.events : [msg.event];
    const replay = msg.kind === 'replay';
    dispatchFeed({ type: 'MESSAGE', events, replay, at: receivedAt });
    for (const listener of listenersRef.current) listener(events, { replay, receivedAt });
  }, []);

  const subscribe = useCallback((listener: GameEventsListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const connection = useGameEvents(url, onMessage);

  const setAddress = useCallback((value: string) => {
    const trimmed = value.trim();
    try {
      Storage.setItemSync(ADDRESS_KEY, trimmed);
    } catch (err) {
      console.error('Falha ao salvar endereço do relay', err);
    }
    setAddressState(trimmed);
  }, []);

  const clearFeed = useCallback(() => dispatchFeed({ type: 'CLEAR' }), []);

  const value = useMemo(
    () => ({ address, url, setAddress, connection, feed, clearFeed, subscribe }),
    [address, url, setAddress, connection, feed, clearFeed, subscribe],
  );

  return <GameLinkContext.Provider value={value}>{children}</GameLinkContext.Provider>;
}

export function useGameLink(): GameLinkValue {
  const ctx = useContext(GameLinkContext);
  if (!ctx) throw new Error('useGameLink precisa estar dentro de <GameLinkProvider>');
  return ctx;
}
