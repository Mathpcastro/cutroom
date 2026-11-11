# Spec 4 — Caminho de menor esforço: da ideia ao post

## Objetivo

O usuário deve conseguir sair de "abri o app" para "o Reels está agendado" com **uma frase digitada e três cliques**, sem precisar entender formatos, cenas ou arquivos. Tudo o que hoje é decisão obrigatória vira padrão inteligente com opção de ajuste.

## Estado atual

- Navegação com 12 itens (`StudioNav.tsx`): Início, Criar Reel, Instagram Analytics, Radar de pautas, Provas da marca, Vídeos exportados, Rotina, Meus avatares, Projetos, Vozes, Marca, Conexões.
- **Criar Reel** (`ReelCreator.tsx`): pedido livre + vídeo de referência + Apresentação (com/sem avatar) + Estrutura (direto/história) + Estilo visual + Idioma + Perfil e voz, tudo visível de uma vez.
- Depois de gerar: revisão (`ReelReview.tsx`) → exportar → ir para Vídeos exportados → ir para Rotina/Conexões para publicar.
- Primeiro uso: perfil, marca, avatar, voz, IA e Instagram são configurados em telas separadas, sem ordem indicada.

## Requisitos

### A. Início com uma caixa só

- O **Início** vira a tela de criar: uma caixa grande "O que você quer postar hoje?" com o botão **Criar Reels**. Abaixo, três atalhos de um clique que preenchem a caixa: "Usar uma pauta do Radar" (mostra 3 sugestões prontas), "Recriar um vídeo de referência", "Continuar uma história".
- Enviar só a frase já gera o vídeo com os padrões do perfil (avatar aprovado, voz do perfil, idioma do app, estilo automático). Nenhuma escolha é obrigatória.
- As opções atuais (apresentação, estrutura, estilo, idioma, voz, referência) ficam num bloco recolhido **"Ajustar"**, com um resumo de uma linha do que será usado: "Com o avatar Léo · voz Matheus · estilo automático · português".
- Lembrar as últimas escolhas por perfil.

### B. Uma tela de acompanhamento, sem trocar de lugar

Depois de "Criar Reels", a mesma tela mostra o progresso em etapas com nome comum (Roteiro → Voz → Cenas → Vídeo), com a prévia aparecendo assim que existir. O usuário pode sair e voltar: a geração continua e aparece um indicador no topo.

- A geração faz o vídeo final direto (render), sem pedir "exportar" como passo separado. A revisão por quadros continua disponível, mas não bloqueia.
- Falha em uma etapa mostra o que aconteceu e o botão "Tentar de novo a partir daqui", preservando roteiro e voz.

### C. Tela de resultado com as três ações que importam

Com o vídeo pronto e tocando:

1. **Postar agora** (confirmação com conta e legenda na mesma tela).
2. **Agendar** / **Colocar no piloto automático** (um clique, mostra o dia em que vai sair).
3. **Ajustar** — caixa "O que você quer mudar?" em linguagem livre ("deixa o começo mais forte", "troca a cena 2 pelo print do painel"), que aplica a mudança e mostra a nova versão ao lado da anterior, com "Voltar à anterior".

- A legenda já vem preenchida (sugestão da IA + crédito de música), editável ali.
- "Mais opções": baixar o MP4, abrir no editor avançado, ver quadros.

### D. Primeiro uso guiado (uma vez)

Na primeira abertura, um assistente de até 4 passos, cada um pulável e retomável, com barra de progresso:

1. **Sobre o que você vende** — colar o link do site/produto (leitura automática já existente em `product-page.ts`) ou escrever uma frase.
2. **Seu apresentador** — escolher uma das bases de avatar e seguir, ou "Decidir depois" (cria sem avatar).
3. **Sua voz** — voz local pronta por padrão; opções ElevenLabs/voz própria recolhidas.
4. **Onde postar** — o assistente da Spec 2, ou "Conectar depois".

Ao terminar, cai direto na caixa "O que você quer postar hoje?" com uma sugestão já escrita a partir do site.

- O que estiver faltando aparece como **lista de pendências** discreta no Início ("Conectar o Instagram", "Aprovar um avatar"), não como bloqueio. A IA não conectada é a única pendência que impede criar: nesse caso, o cartão explica e leva ao lugar certo.

### E. Navegação enxuta

Reduzir a barra lateral para 5 itens principais + Ajustes:

| Item | Reúne |
|---|---|
| **Criar** | Início + Criar Reel |
| **Meus Reels** | Projetos + Vídeos exportados (uma lista só, com estado: Rascunho, Pronto, Agendado, Publicado) |
| **Piloto automático** | Rotina (Spec 3) |
| **Ideias** | Radar de pautas + Analytics (os melhores Reels viram sugestões) |
| **Histórias** | Spec 5 |
| **Ajustes** (rodapé) | Perfil e marca, Avatares, Vozes, Provas da marca, Instagram, Aparência, Editor avançado |

- Nada some: tudo o que existe hoje continua acessível dentro desses grupos.
- Em **Meus Reels**, cada item tem uma ação principal conforme o estado (Revisar, Postar, Ver no Instagram) e o menu "Mais".

### F. Detalhes que tiram atrito

- Atalhos: `Ctrl+Enter` cria; `Ctrl+N` novo Reels; `Esc` fecha painéis.
- Todo botão desabilitado diz o motivo (texto ao lado ou dica), nunca fica mudo.
- Estados vazios com uma ação clara ("Você ainda não criou nenhum Reels" + botão).
- Tempos longos mostram estimativa ("cerca de 2 minutos") baseada nos renders anteriores.
- Mensagens de erro em português, com o que fazer.
- Nada de jargão na interface principal: "filme", "composição", "MCP", "render", "timing" ficam só no editor avançado e na documentação de agentes.

## Critérios de aceite

- [ ] Com perfil configurado: abrir o app → digitar uma frase → **Criar Reels** → **Colocar no piloto automático**, em no máximo 3 cliques depois da frase.
- [ ] Um usuário novo completa o primeiro uso e gera o primeiro vídeo sem abrir nenhuma tela de ajustes.
- [ ] A barra lateral tem no máximo 6 itens, e todas as funções atuais continuam alcançáveis.
- [ ] Sair da tela durante a geração não cancela nada; ao voltar, o estado está certo.
- [ ] Pedido de ajuste em linguagem livre gera nova versão sem perder a anterior.
- [ ] Nenhum botão desabilitado sem explicação nas telas principais.
- [ ] O fluxo pelo MCP (`create_film`, `film_voiceover`, `render_film`, `schedule_reel`) continua funcionando e os Reels criados por agentes aparecem em **Meus Reels**.

## Testes

- `tests/videosell-studio.test.tsx`: navegação nova, início com caixa única, resumo dos padrões, pendências.
- Teste do fluxo com serviços simulados: frase → plano → voz → vídeo → agendamento (sem IA nem Instagram reais).
- `tools/check-reel-flows.mjs` atualizado para o caminho novo, com contagem de cliques.

## Fora do escopo

- Mudar o motor de vídeo ou os formatos.
- Aplicativo para celular.
