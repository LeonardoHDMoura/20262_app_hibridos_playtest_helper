# Playtest Helper: marcador de eventos para o observador

App em Expo (React Native + TypeScript) para usar **durante o playtest do jogo Unity**. Uma pessoa joga e outra segura o celular e toca em botões como *“se assustou”*, *“explorou a ronda fixa”*, *“se escondeu”* ou *“foi capturado”*. Cada toque grava o tempo em relação ao início da partida. No fim, o app mostra a **linha do tempo da sessão** e exporta um **CSV**.

O objetivo é ter evidência concreta para a **seção 6.6 (comportamento)** e para o **problema da ronda fixa**.

**Trilhas:** Estado e efeitos / Estado global (`useReducer`) + Persistência (`expo-sqlite`).

## Como rodar

```bash
npm install
npx expo start
```

Abra no **Expo Go** (Android/iOS) lendo o QR code. Os módulos usados (`expo-sqlite`, `expo-haptics`, `expo-keep-awake`, `expo-router`) já vêm no Expo Go, então não é preciso fazer um build nativo.

| Script | O que faz |
| --- | --- |
| `npm test` | Testes do reducer e do cálculo de tempo (test runner nativo do Node) |
| `npm run typecheck` | `tsc` no app e nos testes |
| `npm run lint` | ESLint (config do Expo) |

## Relay (eventos automáticos do jogo)

```
[Jogo Unity] --HTTP POST--> [Relay Node no PC :8787] --WebSocket--> [App Expo no celular]
```

O Expo Go não consegue abrir um servidor no celular, mas o cliente `WebSocket` já vem no React Native. Por isso um script Node pequeno, que roda no PC, faz a ponte. Ele fica em [`relay/`](relay/) e tem o próprio `package.json`.

```bash
cd relay
npm install
npm start                       # imprime os IPs para digitar no app
npm run simulate                # em outro terminal: sessão falsa em tempo real (~2,5 min)
npm run simulate -- --speed 5   # a mesma sessão, 5x mais rápida
```

| Rota | O que faz |
| --- | --- |
| `POST /events` | Recebe um evento ou uma lista. Responde `204`, ou `400` com a mensagem de erro. Um lote com algum evento inválido é rejeitado inteiro |
| `GET /health` | `{ ok, clients, sessionId, events }` |
| WebSocket `/ws` | Ao conectar, envia `{ kind: "replay", events }`. Depois, `{ kind: "event", event }` a cada evento novo |

- Um `session_start` com `sessionId` novo descarta o buffer da sessão anterior. Eventos repetidos (mesmo `sessionId + seq`) e eventos de outra sessão são ignorados.
- Se o relay for reiniciado no meio de uma partida, ele adota o `sessionId` do primeiro evento que chegar.
- Variáveis de ambiente: `PORT` (padrão `8787`) e `HOST` (padrão `0.0.0.0`).
- O simulador cobre tutorial, alertas, caças, perdas do jogador, uma captura, chaves, garrafas e a fuga. Ele também manda um lote e um reenvio duplicado de propósito.

Teste manual:

```bash
curl http://localhost:8787/health
curl -X POST http://localhost:8787/events -H "Content-Type: application/json" -d "{\"v\":1,\"sessionId\":\"teste\",\"seq\":0,\"type\":\"session_start\",\"t\":0,\"data\":{}}"
```

**Avisos de rede**

- O celular e o PC precisam estar na **mesma rede**. O PC pode estar no cabo, desde que seja o mesmo roteador. Com `npx expo start --tunnel`, o app carrega, mas o relay **não** passa pelo túnel: o endereço continua sendo o IP local do PC.
- Na primeira execução, o Firewall do Windows pode pedir permissão para o Node. Permita em **redes privadas**.
- Redes de faculdade costumam isolar os aparelhos entre si. O plano B é ligar o roteador do celular (hotspot) e conectar o PC nele.
- Se o relay listar mais de um IP, use o da placa ligada ao roteador. Adaptadores virtuais (VirtualBox, vEthernet) não são alcançáveis pelo celular.

## Fluxo

1. **Início:** digite o participante (ex.: `P03`) e toque em **Iniciar partida** no instante em que o jogador começa.
2. **Partida:** um relógio grande e seis botões coloridos com contador. Também há **Desfazer** (remove o último toque), **Pausar/Retomar** e **Encerrar**. A tela não apaga durante a partida.
3. **Linha do tempo:** um resumo por tipo, um gráfico em raias (uma linha por tipo de evento), a lista completa com `mm:ss.d` e o botão **Compartilhar CSV**.

Os tipos de evento ficam em [`src/domain/eventTypes.ts`](src/domain/eventTypes.ts). Para mudar os botões, basta editar essa lista.

## Pergunta norteadora

> *Como registrar eventos de observação com marcação de tempo precisa usando `useReducer` e `expo-sqlite`, garantindo que nada se perca se o app for para segundo plano?*

### 1. Tempo preciso: timestamps absolutos, não cronômetro

O app **não conta tempo** com `setInterval`. Timers de JS congelam em segundo plano, e `performance.now()` volta a zero se o processo morre. Ele grava o **instante absoluto** (`Date.now()`) do início da partida e de cada toque. O tempo de partida é sempre **derivado**:

```ts
// src/domain/session.ts
tempo = agora - startedAt - pausedMs - (pausa atual em andamento)
```

Por isso o relógio continua certo depois de o app ficar 5 minutos em segundo plano ou de ser morto e reaberto. O `setInterval` do [`LiveClock`](src/components/LiveClock.tsx) serve só para redesenhar a tela.

Além disso, o horário é capturado no **`onPressIn`**, quando o dedo toca a tela, e não no `onPress`, que só dispara ao soltar e somaria de 100 a 300 ms a cada marcação.

### 2. Estado global com `useReducer`

[`sessionReducer`](src/domain/session.ts) é uma **função pura**: não acessa relógio, banco nem React Native. O horário já chega dentro da action:

| Action | Efeito |
| --- | --- |
| `HYDRATE` | Restaura a sessão aberta que veio do banco |
| `START` | Começa uma nova partida |
| `ADD_EVENT` / `REMOVE_EVENT` | Marca ou desfaz um evento (ignora duplicados e eventos de outra sessão) |
| `PAUSE` / `RESUME` | Pausa ou retoma, acumulando `pausedMs` |
| `END` | Encerra a partida e limpa o estado ativo |

O [`SessionProvider`](src/state/SessionProvider.tsx) envolve o app inteiro (em [`_layout.tsx`](src/app/_layout.tsx)) e expõe dois contextos, `useSessionState()` e `useSessionActions()`. Por estarem separados, um componente que só dispara ações não re-renderiza a cada evento.

### 3. Persistência: **persistir primeiro, despachar depois**

Toda ação passa pelo SQLite **antes** de chegar ao reducer:

```
toque → Date.now() → INSERT (runSync, commit no disco) → dispatch(ADD_EVENT) → UI
```

- As escritas usam a API **síncrona** do `expo-sqlite` (`runSync`). Quando a função retorna, a linha já está commitada. Um INSERT pequeno leva bem menos de 1 ms, então a UI não trava.
- O banco usa `PRAGMA journal_mode = WAL`.
- Assim, **não existe estado “só na memória”**. Se o Android matar o app em segundo plano um instante depois do toque, o evento já está gravado. Também não é preciso “salvar às pressas” no `AppState`, que não é confiável porque o sistema pode matar o processo sem aviso.

Schema ([`src/db/database.ts`](src/db/database.ts)), migrado com `PRAGMA user_version`:

```sql
sessions(id, label, started_at, ended_at, paused_ms, paused_at)
events(id, session_id → sessions, type, t_ms, wall_ms, note)
```

### 4. Segundo plano e reabertura

- **Reidratação:** ao abrir, o provider procura uma sessão com `ended_at IS NULL` e despacha `HYDRATE`. A partida continua de onde estava, com o relógio certo (ver item 1).
- **`AppState`:** quando o app vai para o segundo plano ou volta, o provider grava os eventos automáticos `app_segundo_plano` e `app_voltou`. Eles aparecem na raia “Sistema” da linha do tempo e mostram **lacunas de observação**, o que é útil para não tirar conclusões erradas de um trecho em que ninguém estava olhando.
- **`useKeepAwake`** na tela da partida impede que a tela apague sozinha.

## Estrutura

```
src/
  app/                  rotas (expo-router)
    _layout.tsx         SQLiteProvider + SessionProvider + Stack
    index.tsx           início: nova partida / retomar / histórico
    live.tsx            botões de marcação durante a partida
    session/[id].tsx    linha do tempo + CSV
  domain/               código puro e testável
    session.ts          tipos, reducer, cálculo de tempo
    eventTypes.ts       catálogo de botões
    format.ts           mm:ss.d, CSV, contagens
  db/database.ts        schema, migração e consultas expo-sqlite
  state/SessionProvider.tsx   useReducer + contextos + efeitos (AppState, hidratação)
  components/           LiveClock, TimelineChart, tema
tests/session.test.ts   testes do reducer e do tempo
```

## CSV exportado

```
sessao,participante,tempo_ms,tempo,evento_id,evento,categoria,horario_iso,nota
3,P03,12450,00:12.4,susto,Se assustou,comportamento,2026-11-05T22:14:03.120Z,
3,P03,47810,00:47.8,explorou_ronda,Explorou a ronda fixa,ronda,2026-11-05T22:14:38.480Z,
```

## Próximos passos possíveis

- Juntar com a **sugestão 1** (estatísticas do playtest) e cruzar com a telemetria do Unity pelo `horario_iso`.
- Campo de nota rápida por evento (a coluna `note` já existe no banco e no CSV).
- Comparar sessões: tempo até a primeira captura, quantos “antecipou a ronda” depois da primeira volta da patrulha etc.
