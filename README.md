# Playtest Helper: marcador de eventos para o observador

App em Expo (React Native + TypeScript) para usar **durante o playtest do jogo Unity**. Uma pessoa joga e outra segura o celular e toca em botões como *“se assustou”*, *“se escondeu”*, *“previu a rota do Monstro”* ou *“não entendeu mecânica do jogo”*. Cada toque grava o tempo em relação ao início da partida. No fim, o app mostra a **linha do tempo da sessão** e exporta um **CSV**.

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
| WebSocket `/ws` | Ao conectar, envia `{ kind: "replay", events }`. Depois, `{ kind: "event", event }` a cada evento novo, e `{ kind: "ping" }` a cada 15 s para o app saber que a conexão está viva |

**No app:** toque no indicador **“Jogo: …”** no topo de qualquer tela para abrir a tela de conexão. Ali você digita o endereço (que fica salvo), vê o estado da conexão e os eventos crus recebidos. A reconexão é automática, com espera de 1 s, 2 s, 4 s… até 10 s. Sem 40 s de mensagens, a conexão é considerada morta. Ao voltar, o replay preenche o que faltou e os eventos repetidos (`sessionId + seq`) são ignorados.

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

1. **Início:** digite o participante (ex.: `P03`) e toque em **Iniciar partida**. Se o relay estiver conectado, o `session_start` do jogo também cria uma sessão sozinho.
2. **Partida:** um relógio, seis botões coloridos com contador e a **linha do tempo unificada**, que junta os eventos do jogo (fundo cinza, etiqueta “Jogo”) e as marcações (etiqueta azul “Observador”). A lista acompanha o item mais novo, a não ser que você role para cima. Também há **Desfazer** (remove o último toque) e **Encerrar**. A tela não apaga durante a partida.
3. **Linha do tempo:** um resumo por tipo, um gráfico em raias (uma linha por tipo de evento), a lista completa com `mm:ss.d` e o botão **Compartilhar CSV**.

Os tipos de evento ficam em [`src/domain/eventTypes.ts`](src/domain/eventTypes.ts). Os botões atuais são: *Se assustou*, *Se escondeu*, *Não viu uma chave*, *Correu fora de caça*, *Previu a rota do Monstro* e *Não entendeu mecânica do jogo*.

Para mudar os botões, edite essa lista, mas **nunca renomeie nem apague um `id` que já tem dados gravados**: o banco e o CSV guardam o `id`. Para tirar um botão, marque o tipo como `retired: true`. Ele some da tela da partida, mas as sessões antigas continuam com o mesmo nome, cor, contagem e raia. Foi assim que saíram os botões da primeira versão (*Foi capturado*, *Hesitou / ficou parado*, *Explorou a ronda fixa*, *Antecipou a ronda*).

## Pergunta norteadora

> *Como registrar eventos de observação com marcação de tempo precisa usando `useReducer` e `expo-sqlite`, garantindo que nada se perca se o app for para segundo plano?*

### 1. Tempo preciso: timestamps absolutos, não cronômetro

O app **não conta tempo** com `setInterval`. Timers de JS congelam em segundo plano, e `performance.now()` volta a zero se o processo morre. Ele grava o **instante absoluto** (`Date.now()`) do início da partida e de cada toque. O tempo de partida é sempre **derivado**:

```ts
// src/domain/session.ts
t = (horário do toque - origem) / 1000
// origem = início manual, ou o t = 0 do jogo quando ele está ligado
```

**Sincronização com o jogo:** cada evento do jogo diz “aconteceu em `t`” e chega num instante conhecido. `chegada − t` nunca é menor que a origem real, então o app guarda o **menor** valor visto. No `session_start` ao vivo, isso é exatamente `Date.now() − t·1000`. Se o app conectou no meio da partida, o `session_start` vem atrasado pelo replay, e o primeiro evento ao vivo corrige a origem. Marcações feitas antes do jogo começar ficam com `t` negativo. Não há pausa, porque o `t` do jogo também não para no pause.

Por isso o relógio continua certo depois de o app ficar 5 minutos em segundo plano ou de ser morto e reaberto. O `setInterval` do [`LiveClock`](src/components/LiveClock.tsx) serve só para redesenhar a tela.

Além disso, o horário é capturado no **`onPressIn`**, quando o dedo toca a tela, e não no `onPress`, que só dispara ao soltar e somaria de 100 a 300 ms a cada marcação.

### 2. Estado global com `useReducer`

[`sessionReducer`](src/domain/session.ts) é uma **função pura**: não acessa relógio, banco nem React Native. O horário já chega dentro da action:

| Action | Efeito |
| --- | --- |
| `HYDRATE` | Restaura a sessão aberta que veio do banco |
| `START` | Começa uma nova partida |
| `ADD_EVENT` / `REMOVE_EVENT` | Marca ou desfaz um evento (ignora duplicados e eventos de outra sessão) |
| `GAME_EVENTS` | Liga a sessão do jogo, junta os eventos sem repetir `sessionId + seq` e ajusta a origem do relógio |
| `END` | Encerra a partida e limpa o estado ativo |

O [`SessionProvider`](src/state/SessionProvider.tsx) envolve o app inteiro (em [`_layout.tsx`](src/app/_layout.tsx)) e expõe dois contextos, `useSessionState()` e `useSessionActions()`. Por estarem separados, um componente que só dispara ações não re-renderiza a cada evento.

### 3. Persistência: **persistir primeiro, despachar depois**

Toda ação passa pelo SQLite **antes** de chegar ao reducer. Isso vale para as marcações, os eventos do jogo, a ligação com o jogo e a origem do relógio:

```
toque → Date.now() → INSERT (runSync, commit no disco) → dispatch(ADD_EVENT) → UI
relay → INSERT OR IGNORE (transação) → dispatch(GAME_EVENTS) → UI
```

- As escritas usam a API **síncrona** do `expo-sqlite` (`runSync`). Quando a função retorna, a linha já está commitada. Um INSERT pequeno leva bem menos de 1 ms, então a UI não trava.
- O banco usa `PRAGMA journal_mode = WAL`.
- Assim, **não existe estado “só na memória”**. Se o Android matar o app em segundo plano um instante depois do toque, o evento já está gravado. Também não é preciso “salvar às pressas” no `AppState`, que não é confiável porque o sistema pode matar o processo sem aviso.

Schema v2 ([`src/db/database.ts`](src/db/database.ts)), migrado com `PRAGMA user_version`. A migração da v1 converte as marcações antigas:

```sql
sessions(id, label, started_at, ended_at, game_session_id, game_origin_ms)
timeline_items(id, session_id → sessions, source 'game'|'observer', game_session_id, seq,
               type, t, wall_ms, data, label, note)
UNIQUE (game_session_id, source, seq) WHERE source = 'game'   -- deduplicação
```

- `t` está em segundos desde o início da sessão. Quando a origem do relógio muda, o `t` das marcações é recalculado a partir de `wall_ms`, o horário do toque.
- Ao reabrir o app, a sessão volta já ligada ao jogo. O replay do relay só acrescenta o que faltou.
- Uma observação encerrada nunca é reaberta pelo replay.

Os testes de [`tests/database.test.ts`](tests/database.test.ts) rodam esse código contra um SQLite real (`node:sqlite`), incluindo a migração da v1.

### 4. Segundo plano e reabertura

- **Reidratação:** ao abrir, o provider procura uma sessão com `ended_at IS NULL` e despacha `HYDRATE`. A partida continua de onde estava, com o relógio certo (ver item 1).
- **`AppState`:** quando o app vai para o segundo plano ou volta, o provider grava os eventos automáticos `app_segundo_plano` e `app_voltou`. Eles aparecem na raia “Sistema” da linha do tempo e mostram **lacunas de observação**, o que é útil para não tirar conclusões erradas de um trecho em que ninguém estava olhando.
- **`useKeepAwake`** na tela da partida impede que a tela apague sozinha.

### 5. Resumo da sessão (derivado, nunca guardado)

[`summarizeGame`](src/lib/sessionSummary.ts) recalcula o resumo a partir dos eventos do jogo sempre que eles mudam. Ele aparece completo na tela da sessão e numa faixa compacta na tela da partida.

| Métrica | De onde vem |
| --- | --- |
| Tutorial | `tutorial_end.durationSec` |
| Tentativas | maior `attempt` / `attempts` visto (mínimo 1) |
| Capturas | quantidade de `player_caught` |
| Chaves | último `total` / `required` de `key_collected` |
| Garrafas | maior `total` de `bottle_thrown` |
| Entrou em alerta | transições `patrol → alert` |
| Entrou em caça | entradas em `chase` |
| Perdeu o jogador | toda saída de `chase`, menos o reset do monstro causado por uma captura |
| Tempo em caça | soma dos intervalos em `chase`. A captura encerra a caça. Uma caça ainda aberta conta até o `session_end` ou até o último evento |
| Eventos faltando | lacunas na sequência de `seq` |

**Decisão:** na linha do tempo, toda saída de `chase` aparece como "Monstro perdeu o jogador", como manda o contrato, inclusive a volta à patrulha logo depois de uma captura. O resumo conta do mesmo jeito, com uma exceção: o reset do monstro causado por uma captura.

- Um `player_caught` encerra a caça na hora.
- Um `attempt_start` no meio da caça também encerra, porque o jogo real pode reiniciar a tentativa sem mandar `player_caught`.
- A primeira saída de `chase` depois disso é o reset e não conta como perda. Isso também vale quando ela chega colada logo antes do `player_caught`.
- O resumo não depende de o jogo mandar esse reset. Uma saída de `chase` cuja entrada não chegou conta como perda, igual à linha do tempo.

## Estrutura

```
src/
  app/                  rotas (expo-router)
    _layout.tsx         SQLiteProvider + GameLinkProvider + SessionProvider + Stack
    index.tsx           início: nova partida / retomar / histórico
    live.tsx            marcação + linha do tempo ao vivo
    session/[id].tsx    linha do tempo de uma sessão encerrada + CSV
    settings.tsx        conexão com o relay + eventos crus
  domain/               código puro e testável
    session.ts          tipos, reducer, relógio, rota dos eventos do jogo
    eventTypes.ts       catálogo de botões
    format.ts           mm:ss.d, contagens
  lib/                  código puro e testável
    relay.ts            contrato v1, mensagens do relay, dedup
    eventLabels.ts      evento do jogo → texto
    timeline.ts         linha do tempo unificada
    exportCsv.ts        CSV
    sessionSummary.ts   resumo derivado dos eventos
  hooks/useGameEvents.ts      WebSocket com reconexão
  db/database.ts        schema, migração e consultas expo-sqlite
  state/                GameLinkProvider (conexão) e SessionProvider (useReducer + efeitos)
  components/           relógio, linha do tempo, gráfico em raias, resumo, indicador de conexão
relay/                  relay Node + simulador
tests/                  node:test (reducer, relay, textos, banco, resumo)
```

## CSV exportado

Uma linha por item da linha do tempo unificada. No observador, `horario_iso` é o horário do toque. No jogo, é a origem + `t` no relógio do celular.

```
sessao,participante,sessao_jogo,fonte,seq,tempo_s,tempo,tipo,texto,detalhe,horario_iso,dados,nota
3,P03,7aa9…,jogo,6,69.012,01:09,seeker_state,Monstro achou o jogador (caça),motivo: saw_player,2026-11-06T19:20:11.512Z,"{""from"":""alert"",""to"":""chase"",""reason"":""saw_player""}",
3,P03,7aa9…,observador,,70.240,01:10,susto,Se assustou,,2026-11-06T19:20:12.740Z,,
```

## Próximos passos possíveis

- Juntar com a **sugestão 1** (estatísticas do playtest) e cruzar com a telemetria do Unity pelo `horario_iso`.
- Campo de nota rápida por evento (a coluna `note` já existe no banco e no CSV).
- Comparar sessões: tempo até a primeira captura, quantos “previu a rota do Monstro” depois da primeira volta da patrulha etc.
