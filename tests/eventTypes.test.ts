import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUTTON_EVENT_TYPES, getEventType, MANUAL_EVENT_TYPES } from '../src/domain/eventTypes.ts';

describe('catálogo de marcações', () => {
  it('os botões da partida são os seis atuais, nesta ordem', () => {
    assert.deepEqual(
      BUTTON_EVENT_TYPES.map((t) => t.label),
      [
        'Se assustou',
        'Se escondeu',
        'Não viu uma chave',
        'Correu fora de caça',
        'Previu a rota do Monstro',
        'Não entendeu mecânica do jogo',
      ],
    );
  });

  it('tipos aposentados continuam com o mesmo nome e cor nas sessões salvas', () => {
    const old = {
      capturado: ['Foi capturado', '#1C2024'],
      hesitou: ['Hesitou / ficou parado', '#AB6400'],
      explorou_ronda: ['Explorou a ronda fixa', '#8E4EC6'],
      antecipou_ronda: ['Antecipou a ronda', '#12A594'],
    };
    for (const [id, [label, color]] of Object.entries(old)) {
      const def = getEventType(id);
      assert.equal(def.label, label);
      assert.equal(def.color, color);
      assert.equal(def.manual, true, `${id} ainda é marcação do observador, não evento de sistema`);
      assert.equal(def.retired, true);
      assert.ok(!BUTTON_EVENT_TYPES.includes(def), `${id} não vira botão`);
    }
  });

  it('ids e cores não se repetem entre as marcações', () => {
    const ids = MANUAL_EVENT_TYPES.map((t) => t.id);
    const colors = MANUAL_EVENT_TYPES.map((t) => t.color);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(colors).size, colors.length);
  });
});
