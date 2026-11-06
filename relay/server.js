#!/usr/bin/env node
/**
 * Relay de eventos do playtest.
 *
 *   [Jogo Unity] --HTTP POST /events--> [este relay] --WebSocket /ws--> [App Expo]
 *
 * Guarda em memória os eventos da sessão atual do jogo e repassa cada evento novo
 * para todos os celulares conectados. Quem conecta depois recebe um "replay" com
 * tudo o que já aconteceu na sessão.
 *
 * Contrato de eventos v1: { v: 1, sessionId, seq, type, t, data }
 *
 * Variáveis de ambiente: PORT (padrão 8787), HOST (padrão 0.0.0.0).
 */
'use strict';

const http = require('node:http');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------------------
// Estado da sessão atual (em memória)
// ---------------------------------------------------------------------------

let currentSessionId = null;
/** @type {object[]} eventos da sessão atual, na ordem de chegada */
let buffer = [];
/** @type {Set<number>} seqs já recebidos na sessão atual */
let seenSeqs = new Set();

function resetSession(sessionId) {
  currentSessionId = sessionId;
  buffer = [];
  seenSeqs = new Set();
}

/** Devolve uma mensagem de erro, ou null se o evento segue o contrato v1. */
function validateEvent(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return 'evento precisa ser um objeto JSON';
  if (e.v !== 1) return `"v" precisa ser 1 (recebido: ${JSON.stringify(e.v)})`;
  if (typeof e.sessionId !== 'string' || e.sessionId.length === 0) return '"sessionId" precisa ser uma string não vazia';
  if (!Number.isInteger(e.seq) || e.seq < 0) return `"seq" precisa ser um inteiro >= 0 (recebido: ${JSON.stringify(e.seq)})`;
  if (typeof e.type !== 'string' || e.type.length === 0) return '"type" precisa ser uma string não vazia';
  if (typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0) return `"t" precisa ser um número >= 0 (recebido: ${JSON.stringify(e.t)})`;
  if (e.data !== undefined && (e.data === null || typeof e.data !== 'object' || Array.isArray(e.data))) {
    return '"data" precisa ser um objeto, se presente';
  }
  return null;
}

/**
 * Aplica um evento já validado ao buffer.
 * @returns {'accepted' | 'duplicate' | 'other-session'}
 */
function ingest(e) {
  const event = { v: e.v, sessionId: e.sessionId, seq: e.seq, type: e.type, t: e.t, data: e.data ?? {} };

  if (event.type === 'session_start' && event.sessionId !== currentSessionId) {
    if (currentSessionId) log(`nova sessão ${short(event.sessionId)} — descartando ${buffer.length} eventos de ${short(currentSessionId)}`);
    resetSession(event.sessionId);
  } else if (currentSessionId === null) {
    // Relay reiniciado no meio de uma partida (ou jogo iniciado antes do relay):
    // adota a sessão mesmo sem ter visto o session_start.
    log(`adotando sessão ${short(event.sessionId)} sem session_start`);
    resetSession(event.sessionId);
  } else if (event.sessionId !== currentSessionId) {
    return 'other-session';
  }

  if (seenSeqs.has(event.seq)) return 'duplicate';
  seenSeqs.add(event.seq);
  buffer.push(event);
  broadcast({ kind: 'event', event });
  return 'accepted';
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const headers = {
    // Permite POST vindo de um build WebGL do jogo rodando no navegador.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (body === undefined) {
    res.writeHead(status, headers).end();
  } else {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('corpo maior que 1 MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handlePostEvents(req, res) {
  let parsed;
  try {
    const raw = await readBody(req);
    parsed = JSON.parse(raw);
  } catch (err) {
    return send(res, 400, { error: `JSON inválido: ${err.message}` });
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0) return send(res, 400, { error: 'lista de eventos vazia' });

  // Lote é tudo-ou-nada: se um evento for inválido, nenhum é aceito, e o jogo
  // sabe exatamente qual corrigir.
  const errors = [];
  list.forEach((e, i) => {
    const msg = validateEvent(e);
    if (msg) errors.push(Array.isArray(parsed) ? `evento[${i}]: ${msg}` : msg);
  });
  if (errors.length > 0) {
    log(`400 ${errors.join(' | ')}`);
    return send(res, 400, { error: errors.join('; ') });
  }

  for (const e of list) {
    const result = ingest(e);
    const tag = result === 'accepted' ? '' : result === 'duplicate' ? '  (duplicado, ignorado)' : '  (outra sessão, ignorado)';
    log(`#${e.seq} t=${e.t.toFixed(1)}s ${e.type} ${JSON.stringify(e.data ?? {})}${tag}`);
  }
  send(res, 204);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') return send(res, 204);

  if (path === '/events') {
    if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
    handlePostEvents(req, res).catch((err) => {
      console.error(err);
      send(res, 500, { error: String(err) });
    });
    return;
  }

  if (path === '/health') {
    return send(res, 200, { ok: true, clients: wss.clients.size, sessionId: currentSessionId, events: buffer.length });
  }

  send(res, 404, { error: 'rotas: POST /events, GET /health, WebSocket /ws' });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

wss.on('connection', (socket, req) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('error', (err) => log(`erro no cliente: ${err.message}`));
  socket.on('close', () => log(`app desconectou (${wss.clients.size} conectado(s))`));

  const events = [...buffer].sort((a, b) => a.seq - b.seq);
  socket.send(JSON.stringify({ kind: 'replay', events }));
  log(`app conectou de ${req.socket.remoteAddress} — replay de ${events.length} evento(s) (${wss.clients.size} conectado(s))`);
});

// Celular que perde o Wi-Fi deixa a conexão "pendurada": o ping do protocolo
// WebSocket derruba essas conexões mortas no relay. A mensagem {kind:"ping"}
// faz o mesmo do lado do app, que não enxerga os pings do protocolo: se ficar
// muito tempo sem receber nada, o app reconecta.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
  broadcast({ kind: 'ping' });
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function short(id) {
  return id ? id.slice(0, 8) : '-';
}

function log(msg) {
  const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

/** IPs IPv4 da máquina com o nome da placa (ajuda a escolher o Wi-Fi e não um adaptador virtual). */
function localIPv4s() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })),
  );
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Feche o outro relay ou use PORT=8788 npm start.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Relay do playtest ouvindo em ${HOST}:${PORT}\n`);
  const ips = HOST === '0.0.0.0' ? localIPv4s() : [{ name: 'HOST', address: HOST }];
  if (ips.length === 0) {
    console.log('Nenhum IP de rede encontrado — o PC está conectado a alguma rede?');
  }
  for (const { name, address } of ips) {
    console.log(`  [${name}]`);
    console.log(`    No app, digite:  ${address}:${PORT}      (ws://${address}:${PORT}/ws)`);
    console.log(`    No jogo, envie:  POST http://${address}:${PORT}/events\n`);
  }
  if (ips.length > 1) {
    console.log('Use o IP da placa ligada ao roteador (Wi-Fi ou cabo). Adaptadores virtuais (VirtualBox, vEthernet) não são alcançáveis pelo celular.');
  }
  console.log(`Teste rápido: curl http://localhost:${PORT}/health`);
  console.log('Celular e PC precisam estar na mesma rede Wi-Fi.\n');
});

function shutdown() {
  log('encerrando relay');
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
