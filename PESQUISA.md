# Diário de pesquisa
## Contexto do TCC
Um jogo de terror com uma rede neural aplicada para gerar uma experiência mais engajante para o usuário. O uso da IA tem o objetivo de criar um oponente que não segue padrões pré-definidos e apresenta um desafio.
## Pergunta de pesquisa
Como um app Expo pode receber, em tempo real e por WebSocket, os eventos do nosso jogo Unity (alerta, caça, perda e captura do jogador, tempo de tutorial, chaves e garrafas) e combiná-los com as marcações manuais do observador em uma linha do tempo salva com expo-sqlite, sem perder nem duplicar eventos quando a conexão cai durante o teste?
## Alternativas consideradas
| Opção | Serve para | Decisão |
|---|---|---|
| WebSocket nativo do React Native + relay Node (`ws`) no PC do jogo | Empurrar eventos da rede local para o celular com baixa latência, sem serviço externo | **Sim.** Funciona sem internet, a Unity só precisa de `UnityWebRequest` (nativo) e o relay permite reenviar o histórico ao reconectar. *Confirmar na documentação que o WebSocket roda no Expo Go.* |
| Polling HTTP com `fetch` (app pergunta ao relay a cada 1 s) | Buscar eventos novos periodicamente | **Não.** Mais simples, mas com atraso de até 1 s e tráfego constante. Fica como plano B se o WebSocket der problema. |
| Supabase Realtime | Jogo grava numa tabela na nuvem e o app recebe as mudanças | **Não.** Exige internet no local do teste, conta e chave, e acrescenta latência da nuvem a dados que estão na mesma sala. Pode criar problemas durante um evento (Eureka). |
| Servidor WebSocket dentro da Unity (sem relay) | Celular conecta direto no jogo | **Não.** Exige uma biblioteca de terceiros na Unity e mexe mais no projeto do jogo, que é cuidado por outra pessoa. |
| Servidor dentro do celular (jogo envia direto para o app) | Dispensar o PC como intermediário | **Não.** O React Native só oferece WebSocket de cliente. Seria viável com uma development build, mas o funcionamente com relay é melhor pois tem persistência e o jogo não precisa saber o IP do celular. |
## Fontes oficiais lidas
- [ ] React Native: Networking (seção WebSocket) (https://reactnative.dev/docs/network)
- [ ] Expo: SQLite (https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [ ] Expo: Store data (https://docs.expo.dev/develop/user-interface/store-data)
- [ ] ws: biblioteca WebSocket para Node (https://github.com/websockets/ws)
- [ ] Unity: UnityWebRequest (https://docs.unity3d.com/ScriptReference/Networking.UnityWebRequest.html)
- [ ] Supabase: Realtime, só para justificar o descarte (https://supabase.com/docs/guides/realtime)
## Onde a IA errou
- **Pedido:** Analisar quando o monstro perde o jogador de vista usando analise dos estados da IA, desconsiderando quando a IA captura o jogador.
- **O que veio:** Toda a vez que o monstro entra em caça ele considera, mas quando saía do estado de caça nunca considerava que perdeu, inflando o tempo de caça.
- **Como percebi:** Fiz o teste diretamente no jogo.
- **O certo:** Toda vez que o monstro sai do estado de caça, considera que perdeu o jogador, e caso haja uma captura ou um reset manual da tentativa ele também encerra a caça imediatamente.

- **Pedido:** Anotar um evento toda vez que o jogador pegar uma chave durante o tempo de jogo.
- **O que veio:** Toda a vez que pegava uma chave, registrava evento, inclusive quando pegava a chave obrigatória do tutorial.
- **Como percebi:** Fiz o teste diretamente no jogo.
- **O certo:** Só considerar o evento em chaves que foram criadas pelo KeySpawner, desconsiderando a chave colocada manualmente sem ter sido 'spawnada'.

- **Pedido:** Comparar alternativas para levar os eventos do jogo até o celular.
- **O que veio:** A alternativa "servidor dentro do celular" foi descartada com a afirmação de que "o Expo Go não consegue abrir um servidor no aparelho", sem mencionar nenhuma saída.
- **Como percebi:** Fui conferir na documentação oficial. 
- **O certo:** O servidor no celular é viável com development build. A afirmação da IA estava correta só para o Expo Go.

## Resultado e próximos passos no TCC
- A nossa prova de conceito mostrou que o aplicativo hibrido está funcionando em conjunto com o jogo e capturando métricas em tempo real, possui persistência em caso de instabilidade, permite a captura de métricas customizadas do observador e não compromete o funcionamento do jogo.
- Próximo passo no TCC: usar o app em sessões de playtest com jogadores reais para comparar o agente de RL com uma versão com FSM. A ideia é cruzar as marcações do observador ("se escondeu", "se assustou") com os eventos do monstro, gerando a evidência com humanos que o artigo hoje não tem (seções 6.6 e 8).