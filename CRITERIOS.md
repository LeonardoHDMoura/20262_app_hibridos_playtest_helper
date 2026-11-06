# Critérios de aceitação
 
## Recebimento em tempo real
- [ ] Com o app conectado ao relay, quando o monstro entra em caça no jogo, aparece no celular, em até 2 segundos, o item "Monstro achou o jogador (caça)" com o rótulo **Jogo** e o tempo da partida em `mm:ss`.
- [ ] Ao terminar o tutorial, aparece "Tutorial concluído em X s", e o resumo da sessão mostra o mesmo tempo.
- [ ] Depois de ser pego uma vez, coletar uma chave e arremessar duas garrafas, o resumo mostra **1 captura**, **1/N chaves** e **2 garrafas**, conferindo com o que aconteceu no jogo.
## Linha do tempo unificada
- [ ] Uma marcação manual tocada logo após o monstro entrar em caça aparece **depois** desse evento na linha do tempo, com o rótulo **Observador** e cor ou ícone diferente dos eventos do jogo.
- [ ] Após a captura e o recarregamento da cena, os eventos da nova tentativa continuam na **mesma sessão**, sem abrir uma linha do tempo nova.
## Conexão e persistência
- [ ] Ao desligar o Wi-Fi do celular por 10 segundos durante a partida e religá-lo, os eventos que aconteceram nesse intervalo aparecem na linha do tempo, **sem itens duplicados**.
- [ ] Ao fechar o app por completo e abrir de novo, a sessão (eventos do jogo e marcações manuais) continua lá, na mesma ordem.
- [ ] Com o relay desligado, o jogo roda normalmente, sem travar.
**Verificado em:** ( ) aparelho físico ( ) emulador
**Resultado:** ( ) passou ( ) reprovou
 