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
| Supabase Realtime | Jogo grava numa tabela na nuvem e o app recebe as mudanças | **Não.** Exige internet no local do teste, conta e chave, e acrescenta latência da nuvem a dados que estão na mesma sala. |
| Servidor WebSocket dentro da Unity (sem relay) | Celular conecta direto no jogo | **Não.** Exige uma biblioteca de terceiros na Unity e mexe mais no projeto do jogo, que é cuidado por outra pessoa. |
| Servidor dentro do celular (jogo envia direto para o app) | Dispensar o PC como intermediário | **Não.** *A IA afirmou* que o Expo Go não consegue abrir um servidor no aparelho. **Confirmar na documentação** antes de descartar de vez. |
## Fontes oficiais lidas
- [ ] React Native: Networking (seção WebSocket) (https://reactnative.dev/docs/network)
- [ ] Expo: SQLite (https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [ ] Expo: Store data (https://docs.expo.dev/develop/user-interface/store-data)
- [ ] ws: biblioteca WebSocket para Node (https://github.com/websockets/ws)
- [ ] Unity: UnityWebRequest (https://docs.unity3d.com/ScriptReference/Networking.UnityWebRequest.html)
- [ ] Supabase: Realtime, só para justificar o descarte (https://supabase.com/docs/guides/realtime)
## Onde a IA errou
- Pedido: [o que foi pedido]
- O que veio: [a resposta errada]
- Como percebi: [erro de compilação, documentação, teste no aparelho]
- O certo: [o que a documentação confirma]
## Resultado e próximos passos no TCC
- [o que a prova de conceito demonstrou, critério por critério]
- Próximo passo no TCC: usar o app em sessões de playtest com jogadores reais para comparar o agente de RL com uma versão com FSM. A ideia é cruzar as marcações do observador ("percebeu um padrão", "se assustou") com os eventos do monstro, gerando a evidência com humanos que o artigo hoje não tem (seções 6.6 e 8).