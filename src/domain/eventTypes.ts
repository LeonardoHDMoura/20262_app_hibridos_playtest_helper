/**
 * Catálogo de eventos que o observador pode marcar.
 *
 * O `id` é o que vai para o banco e para o CSV: nunca renomeie nem apague um id
 * que já tem dados gravados. Para tirar um botão, marque o tipo como `retired`:
 * ele some da tela da partida, mas as sessões antigas continuam mostrando esse
 * tipo com o mesmo nome, cor e contagem de antes.
 */
export type EventCategory = 'comportamento' | 'ronda' | 'sistema';

export interface EventTypeDef {
  id: string;
  label: string;
  color: string;
  category: EventCategory;
  /** Eventos de sistema são gravados automaticamente e não viram botão. */
  manual: boolean;
  /** Marcação antiga: não vira mais botão, mas continua legível nas sessões salvas. */
  retired?: boolean;
}

export const EVENT_TYPES: readonly EventTypeDef[] = [
  { id: 'susto', label: 'Se assustou', color: '#E5484D', category: 'comportamento', manual: true },
  { id: 'escondeu', label: 'Se escondeu', color: '#3E63DD', category: 'comportamento', manual: true },
  { id: 'nao_viu_chave', label: 'Não viu uma chave', color: '#978365', category: 'comportamento', manual: true },
  { id: 'correu_fora_caca', label: 'Correu fora de caça', color: '#D6409F', category: 'comportamento', manual: true },
  { id: 'previu_rota', label: 'Previu a rota do Monstro', color: '#00A2C7', category: 'ronda', manual: true },
  {
    id: 'nao_entendeu_mecanica',
    label: 'Não entendeu mecânica do jogo',
    color: '#6E56CF',
    category: 'comportamento',
    manual: true,
  },

  // Botões da primeira versão. Ficam aqui só para as sessões já gravadas.
  { id: 'capturado', label: 'Foi capturado', color: '#1C2024', category: 'comportamento', manual: true, retired: true },
  { id: 'hesitou', label: 'Hesitou / ficou parado', color: '#AB6400', category: 'comportamento', manual: true, retired: true },
  { id: 'explorou_ronda', label: 'Explorou a ronda fixa', color: '#8E4EC6', category: 'ronda', manual: true, retired: true },
  { id: 'antecipou_ronda', label: 'Antecipou a ronda', color: '#12A594', category: 'ronda', manual: true, retired: true },

  { id: 'app_segundo_plano', label: 'App foi para 2º plano', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'app_voltou', label: 'App voltou', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'pausa', label: 'Partida pausada', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'retomada', label: 'Partida retomada', color: '#8B8D98', category: 'sistema', manual: false },
];

/** Tudo que é marcação do observador, inclusive os tipos aposentados. */
export const MANUAL_EVENT_TYPES = EVENT_TYPES.filter((t) => t.manual);

/** Os botões da tela da partida. */
export const BUTTON_EVENT_TYPES = MANUAL_EVENT_TYPES.filter((t) => !t.retired);

const byId = new Map(EVENT_TYPES.map((t) => [t.id, t]));

export function getEventType(id: string): EventTypeDef {
  return byId.get(id) ?? { id, label: id, color: '#8B8D98', category: 'sistema', manual: false };
}
