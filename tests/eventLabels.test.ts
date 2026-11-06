import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gameEventText } from '../src/lib/eventLabels.ts';

const text = (type: string, data: Record<string, unknown> = {}) => gameEventText({ type, data });
const seeker = (from: string, to: string, reason?: string) => text('seeker_state', reason ? { from, to, reason } : { from, to });

describe('gameEventText', () => {
  it('textos do contrato v1', () => {
    assert.equal(text('session_start', { build: 'b1', map: 'mansao', model: 'ronda_fixa' }).label, 'Sessão iniciada');
    assert.equal(text('session_start', { build: 'b1', map: 'mansao', model: 'ronda_fixa' }).detail, 'mansao · ronda_fixa · build b1');
    assert.equal(text('tutorial_end', { durationSec: 40.6 }).label, 'Tutorial concluído em 41 s');
    assert.equal(text('player_caught', { attempt: 2 }).label, 'Monstro pegou o jogador (tentativa 2)');
    assert.equal(text('attempt_start', { attempt: 3 }).label, 'Nova tentativa (3)');
    assert.equal(text('key_collected', { keyId: 'k', total: 2, required: 3 }).label, 'Chave coletada (2/3)');
    assert.equal(text('bottle_thrown', { total: 4 }).label, 'Garrafa arremessada (total 4)');
    assert.equal(text('player_escaped', { totalTimeSec: 150, attempts: 2 }).label, 'Jogador escapou');
    assert.equal(text('session_end', { reason: 'escaped' }).label, 'Sessão encerrada');
  });

  it('regras do seeker_state', () => {
    assert.equal(seeker('patrol', 'alert').label, 'Monstro entrou em alerta');
    assert.equal(seeker('alert', 'chase').label, 'Monstro achou o jogador (caça)');
    assert.equal(seeker('patrol', 'chase').label, 'Monstro achou o jogador (caça)');
    assert.equal(seeker('chase', 'alert').label, 'Monstro perdeu o jogador');
    assert.equal(seeker('chase', 'patrol').label, 'Monstro perdeu o jogador');
    assert.equal(seeker('alert', 'patrol').label, 'Monstro voltou à patrulha');
    assert.equal(seeker('alert', 'chase', 'saw_player').detail, 'motivo: saw_player');
  });

  it('transições fora das regras e dados faltando não quebram', () => {
    assert.equal(seeker('patrol', 'patrol').label, 'Monstro: patrol → patrol');
    assert.equal(text('seeker_state').label, 'Monstro mudou de estado');
    assert.equal(text('player_caught').label, 'Monstro pegou o jogador');
    assert.equal(text('key_collected', { total: '2' }).label, 'Chave coletada');
    assert.equal(text('tutorial_end', { durationSec: null }).label, 'Tutorial concluído');
  });

  it('tipo desconhecido aparece com o nome cru', () => {
    assert.deepEqual(text('door_opened', { id: 3 }), { label: 'door_opened', tone: 'neutral' });
  });
});
