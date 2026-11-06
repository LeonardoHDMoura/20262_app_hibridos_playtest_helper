#!/usr/bin/env node
/**
 * Simulador de uma sessão de playtest: envia ao relay os mesmos eventos que o
 * jogo Unity enviaria, em tempo real, seguindo o contrato v1.
 *
 * Uso:
 *   npm run simulate                       # tempo real (~2,5 min)
 *   npm run simulate -- --speed 5          # 5x mais rápido (~30 s)
 *   npm run simulate -- --url http://192.168.0.12:8787
 *
 * `t` é sempre o tempo realmente decorrido desde o session_start, então o
 * alinhamento com as marcações manuais do app continua correto em qualquer
 * velocidade (com --speed 5, o tutorial de ~40 s dura ~8 s e o t diz ~8).
 *
 * Para exercitar o relay, a sessão também manda um lote (dois eventos em um
 * POST) e reenvia um evento de propósito (o relay deve ignorar o duplicado).
 */
'use strict';

const { randomUUID } = require('node:crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SPEED = Math.max(0.1, Number(arg('speed', '1')) || 1);
const BASE_URL = arg('url', `http://localhost:${process.env.PORT || 8787}`).replace(/\/+$/, '');
const EVENTS_URL = `${BASE_URL}/events`;

const sessionId = randomUUID();
let seq = 0;
let startedAt = 0;

const elapsedSec = () => Math.round(((performance.now() - startedAt) / 1000) * 1000) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeEvent(type, data = {}) {
  return { v: 1, sessionId, seq: seq++, type, t: elapsedSec(), data };
}

async function post(body) {
  let res;
  try {
    res = await fetch(EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`\nNão consegui falar com o relay em ${EVENTS_URL} (${err.cause?.code ?? err.message}).`);
    console.error('Ele está rodando? Em outro terminal: cd relay && npm start');
    process.exit(1);
  }
  if (res.status !== 204) {
    console.error(`Relay respondeu ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
}

function show(e, note = '') {
  const mm = String(Math.floor(e.t / 60)).padStart(2, '0');
  const ss = String(Math.floor(e.t % 60)).padStart(2, '0');
  console.log(`  ${mm}:${ss}  #${String(e.seq).padStart(2)}  ${e.type.padEnd(15)} ${JSON.stringify(e.data)}${note}`);
}

async function send(type, data) {
  const e = makeEvent(type, data);
  await post(e);
  show(e);
  return e;
}

/** Espera até o instante `atSec` do roteiro (em segundos de "tempo de jogo" a 1x). */
async function at(atSec) {
  const targetMs = startedAt + (atSec * 1000) / SPEED;
  const wait = targetMs - performance.now();
  if (wait > 0) await sleep(wait);
}

const seeker = (from, to, reason) => send('seeker_state', reason ? { from, to, reason } : { from, to });

async function main() {
  console.log(`Simulando sessão ${sessionId}`);
  console.log(`Relay: ${EVENTS_URL}   velocidade: ${SPEED}x\n`);

  startedAt = performance.now();
  await send('session_start', { build: 'simulador-1.0', map: 'mansao', model: 'ronda_fixa' });

  // Tutorial (~40 s)
  await at(41);
  await send('tutorial_end', { durationSec: elapsedSec() });

  // Primeira tentativa
  await at(48);
  await seeker('patrol', 'alert', 'noise');
  await at(53);
  await seeker('alert', 'patrol', 'timeout');
  await at(60);
  await send('key_collected', { keyId: 'chave_cozinha', total: 1, required: 3 });

  await at(66);
  await seeker('patrol', 'alert', 'saw_player');
  await at(69);
  await seeker('alert', 'chase', 'saw_player');
  await at(77);
  await seeker('chase', 'alert', 'lost_sight');
  await at(83);
  await seeker('alert', 'patrol', 'timeout');

  await at(88);
  await send('bottle_thrown', { total: 1 });

  // Dois eventos no mesmo POST (lote)
  await at(95);
  const batch = [
    makeEvent('key_collected', { keyId: 'chave_biblioteca', total: 2, required: 3 }),
    makeEvent('bottle_thrown', { total: 2 }),
  ];
  await post(batch);
  batch.forEach((e) => show(e, '   (lote)'));

  // Reenvio proposital: o relay deve ignorar (mesmo sessionId + seq)
  await at(97);
  await post(batch[0]);
  show(batch[0], '   (reenvio proposital — deve ser ignorado)');

  await at(102);
  await seeker('patrol', 'chase', 'saw_player');
  await at(107);
  await send('player_caught', { attempt: 1 });
  await seeker('chase', 'patrol', 'reset');

  // Segunda tentativa
  await at(111);
  await send('attempt_start', { attempt: 2 });
  await at(119);
  await send('bottle_thrown', { total: 3 });
  await at(126);
  await seeker('patrol', 'alert', 'noise');
  await at(129);
  await seeker('alert', 'chase', 'saw_player');
  await at(135);
  await seeker('chase', 'alert', 'player_hidden');
  await at(140);
  await seeker('alert', 'patrol', 'timeout');
  await at(147);
  await send('key_collected', { keyId: 'chave_porao', total: 3, required: 3 });

  await at(154);
  await send('player_escaped', { totalTimeSec: elapsedSec(), attempts: 2 });
  await send('session_end', { reason: 'escaped' });

  console.log(`\nFim da simulação: ${seq} eventos enviados (+1 reenvio duplicado).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
