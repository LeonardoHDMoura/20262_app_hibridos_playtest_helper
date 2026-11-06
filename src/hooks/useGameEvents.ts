import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { backoffDelay, parseRelayMessage, type RelayMessage } from '../lib/relay.ts';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface GameConnection {
  status: ConnectionStatus;
  /** Tentativas seguidas que falharam desde a última conexão bem-sucedida. */
  failures: number;
}

/** Desiste de uma tentativa que não abriu nesse tempo (IP errado costuma travar ~20 s). */
const CONNECT_TIMEOUT_MS = 5_000;
/** O relay manda {kind:"ping"} a cada 15 s; sem nada por 40 s, a conexão está morta. */
const STALE_MS = 40_000;

/**
 * Mantém um WebSocket aberto com o relay e entrega cada mensagem válida para
 * `onMessage`. Usa o WebSocket nativo do React Native (funciona no Expo Go).
 *
 * - Reconecta sozinho com espera crescente (1 s, 2 s, 4 s… até 10 s).
 * - Ao voltar para o primeiro plano, tenta de novo na hora em vez de esperar.
 * - `url = null` desliga a conexão.
 *
 * A deduplicação não é feita aqui: após reconectar, o relay reenvia a sessão
 * inteira (replay) e quem consome as mensagens ignora o que já tem.
 */
export function useGameEvents(url: string | null, onMessage: (msg: RelayMessage) => void): GameConnection {
  const [conn, setConn] = useState<GameConnection>({ status: 'disconnected', failures: 0 });

  // Sempre chama a versão mais nova do callback sem reabrir a conexão.
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(retryTimer);
      clearTimeout(connectTimer);
      clearTimeout(staleTimer);
    };

    /** Solta um socket sem esperar o handshake de fechamento (que pode nunca vir). */
    const drop = (s: WebSocket) => {
      s.onopen = null;
      s.onmessage = null;
      s.onerror = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        // já estava fechado
      }
      if (socket === s) socket = null;
    };

    const scheduleRetry = () => {
      if (disposed) return;
      clearTimers();
      const delay = backoffDelay(failures);
      failures += 1;
      setConn({ status: 'reconnecting', failures });
      retryTimer = setTimeout(connect, delay);
    };

    const armStaleTimer = (s: WebSocket) => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        drop(s);
        scheduleRetry();
      }, STALE_MS);
    };

    function connect() {
      if (disposed) return;
      clearTimers();
      if (socket) drop(socket);
      setConn({ status: failures === 0 ? 'connecting' : 'reconnecting', failures });

      let s: WebSocket;
      try {
        s = new WebSocket(url as string);
      } catch {
        scheduleRetry();
        return;
      }
      socket = s;

      connectTimer = setTimeout(() => {
        drop(s);
        scheduleRetry();
      }, CONNECT_TIMEOUT_MS);

      s.onopen = () => {
        clearTimeout(connectTimer);
        failures = 0;
        setConn({ status: 'connected', failures: 0 });
        armStaleTimer(s);
      };
      s.onmessage = (e) => {
        armStaleTimer(s);
        const msg = parseRelayMessage(e.data);
        if (msg) onMessageRef.current(msg);
      };
      // onerror sempre é seguido de onclose; a reconexão fica num lugar só.
      s.onerror = () => {};
      s.onclose = () => {
        drop(s);
        scheduleRetry();
      };
    }

    connect();

    const appStateSub = AppState.addEventListener('change', (next) => {
      // Voltou para a tela e está sem conexão: tenta agora, sem esperar o backoff.
      if (next === 'active' && !socket) connect();
    });

    return () => {
      disposed = true;
      appStateSub.remove();
      clearTimers();
      if (socket) drop(socket);
    };
  }, [url]);

  // Sem endereço não há conexão: deriva o estado em vez de guardá-lo.
  return url ? conn : DISCONNECTED;
}

const DISCONNECTED: GameConnection = { status: 'disconnected', failures: 0 };
