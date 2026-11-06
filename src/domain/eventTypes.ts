/**
 * Catálogo de eventos que o observador pode marcar.
 *
 * Para adicionar/remover um botão, basta editar esta lista. O `id` é o que vai
 * para o banco e para o CSV, então evite renomear um id que já tem dados gravados.
 */
export type EventCategory = 'comportamento' | 'ronda' | 'sistema';

export interface EventTypeDef {
  id: string;
  label: string;
  color: string;
  category: EventCategory;
  /** Eventos de sistema são gravados automaticamente e não viram botão. */
  manual: boolean;
}

export const EVENT_TYPES: readonly EventTypeDef[] = [
  { id: 'susto', label: 'Se assustou', color: '#E5484D', category: 'comportamento', manual: true },
  { id: 'escondeu', label: 'Se escondeu', color: '#3E63DD', category: 'comportamento', manual: true },
  { id: 'capturado', label: 'Foi capturado', color: '#1C2024', category: 'comportamento', manual: true },
  { id: 'hesitou', label: 'Hesitou / ficou parado', color: '#AB6400', category: 'comportamento', manual: true },
  { id: 'explorou_ronda', label: 'Explorou a ronda fixa', color: '#8E4EC6', category: 'ronda', manual: true },
  { id: 'antecipou_ronda', label: 'Antecipou a ronda', color: '#12A594', category: 'ronda', manual: true },

  { id: 'app_segundo_plano', label: 'App foi para 2º plano', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'app_voltou', label: 'App voltou', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'pausa', label: 'Partida pausada', color: '#8B8D98', category: 'sistema', manual: false },
  { id: 'retomada', label: 'Partida retomada', color: '#8B8D98', category: 'sistema', manual: false },
];

export const MANUAL_EVENT_TYPES = EVENT_TYPES.filter((t) => t.manual);

const byId = new Map(EVENT_TYPES.map((t) => [t.id, t]));

export function getEventType(id: string): EventTypeDef {
  return byId.get(id) ?? { id, label: id, color: '#8B8D98', category: 'sistema', manual: false };
}
