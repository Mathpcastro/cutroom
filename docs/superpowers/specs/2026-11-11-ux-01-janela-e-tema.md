# Spec 1 — Janela unificada e tema escuro

## Problema

1. No Windows, a faixa dos botões de minimizar, maximizar e fechar aparece numa cor diferente do topo do estúdio.
2. O estúdio só existe em tema claro. O usuário quer escolher tema escuro.

## Estado atual

- `electron/main.ts`: a janela usa `titleBarStyle: "hidden"` com `titleBarOverlay { color, symbolColor, height: 40 }`. As cores vêm de `appearance` (`mode`, `background`, `foreground`), salvo em `appearance.json` e atualizado pelo IPC `setAppearance`.
- `src/lib/themes.ts` (`applyTheme`): envia para `setAppearance` os tokens `--panel` e `--text` do **editor avançado**. O estúdio (`.videosell-studio`) tem outra paleta, então a faixa nativa fica com a cor do editor por cima do estúdio.
- `src/components/studio/studio.css`: tokens fixos no seletor `.videosell-studio` (`--studio-ink #141318`, `--studio-paper #f7f6f1`, `--studio-violet #7c5cff`, `--studio-violet-deep #6445d8`, `--studio-lime #c8ff5a`, `--studio-muted`, `--studio-line`), além de muitas cores escritas direto nas regras (branco, `#fff`, sombras).
- Tamanho de fonte: `data-font-scale` 100/115/130 em `VideosellStudio.tsx`, salvo em `localStorage`.

## Requisitos

### A. Topo unificado

- A faixa dos controles da janela deve ter **exatamente a mesma cor** da área que está embaixo dela em cada tela e em cada tema: no estúdio, a cor do topo do conteúdo e da barra lateral; no editor avançado, a cor do topo do editor.
- A cor muda junto quando o usuário troca de tela (estúdio ↔ editor avançado) ou de tema, sem piscar.
- O topo do estúdio ganha uma **barra própria de 40 px** que ocupa a largura toda, arrastável (`-webkit-app-region: drag`), com:
  - à esquerda, a marca (símbolo + "Videosell") alinhada com a barra lateral;
  - ao centro, o nome da tela atual;
  - à direita, espaço reservado para os controles nativos usando `env(titlebar-area-*)` (ou 140 px de reserva quando indisponível). Nenhum botão do app fica embaixo dos controles.
- Botões e campos dentro da barra usam `-webkit-app-region: no-drag`.
- A barra lateral começa **abaixo** dessa barra, para a faixa de cima ser uma cor só de ponta a ponta. Se a lateral e o conteúdo tiverem cores diferentes, a barra de cima usa a cor da lateral e o overlay nativo também.
- Os símbolos dos controles (`symbolColor`) têm contraste AA sobre a cor da barra nos dois temas.
- macOS: manter os controles nativos à esquerda (`titleBarStyle: "hiddenInset"`), com a mesma barra e reserva de 80 px à esquerda. Não quebrar o comportamento atual se isso não puder ser verificado: nesse caso, deixar o macOS como está e registrar.

### B. Tema escuro no estúdio

- Três opções em **Aparência**: `Claro`, `Escuro` e `Automático (sistema)`. Padrão: `Automático`.
- A escolha vale para o estúdio inteiro e também define o tema do editor avançado (claro → tema `light`, escuro → tema `graphite`), para a pessoa nunca ver dois temas no mesmo app. Quem já escolheu outro tema do editor (Nord, Tokyo Night…) mantém a escolha dentro do editor.
- Implementação por tokens: todas as cores do estúdio passam a vir de variáveis CSS com dois conjuntos (`[data-studio-theme="light"]` e `[data-studio-theme="dark"]`). Nenhuma cor literal sobra nas regras de `studio.css` nem em `style={{}}` dos componentes do estúdio, exceto as cores da marca e as amostras de cor de conteúdo (paleta do avatar, da referência).
- Tokens mínimos: `--studio-bg`, `--studio-surface`, `--studio-surface-2`, `--studio-sidebar`, `--studio-text`, `--studio-muted`, `--studio-line`, `--studio-accent` (violeta), `--studio-accent-text`, `--studio-pop` (lima), `--studio-danger`, `--studio-shadow`.
- Paleta do tema escuro (ponto de partida; ajustar para AA): fundo `#141318`, superfície `#1d1b24`, superfície 2 `#26232f`, texto `#f1eff7`, texto secundário `#a7a3b3`, linha `#34303f`, violeta `#8f75ff`, lima `#c8ff5a`.
- No tema escuro, o violeta do tema claro (`#6445d8`) não passa em contraste como texto: usar `--studio-accent-text` mais claro.
- Imagens e pré-visualizações de vídeo não mudam; molduras e sombras sim.
- A escolha é salva (junto do tamanho de fonte) e aplicada **antes da primeira pintura**, para não piscar claro ao abrir no escuro. `backgroundColor` da janela usa a cor do tema salvo.
- O seletor fica em um bloco "Aparência" na barra lateral ou em Ajustes, junto do tamanho de fonte, com rótulos claros ("Tema" e "Tamanho do texto").

## Critérios de aceite

- [ ] Em Windows, um print do topo da janela mostra uma faixa de cor única da esquerda até o botão de fechar, no estúdio e no editor, em claro e escuro.
- [ ] Trocar de tema atualiza a faixa nativa na hora; trocar de tela também.
- [ ] Arrastar a janela pela barra funciona; clicar nos botões da barra funciona; duplo clique na barra maximiza.
- [ ] Todas as telas do estúdio (Início, Criar Reel, Radar, Provas, Vídeos, Rotina, Avatares, Projetos, Vozes, Marca, Conexões, Analytics, criador de avatar, revisão) legíveis no escuro, sem texto escuro sobre fundo escuro nem cartão branco "estourado".
- [ ] `Automático` segue o tema do sistema e reage à mudança com o app aberto.
- [ ] Reabrir o app mantém tema e tamanho de fonte, sem piscar.
- [ ] Contraste AA conferido nos textos principais, secundários, botões e estados de foco dos dois temas.

## Testes

- Unidade: função que resolve o tema (`light | dark | system` + tema do sistema → tema efetivo) e o que é enviado ao `setAppearance`.
- `tests/videosell-studio.test.tsx`: o atributo `data-studio-theme` muda com a escolha e persiste.
- Verificação estática: teste que falha se `studio.css` tiver cor literal fora dos blocos de tokens (lista de exceções explícita).
- `tools/check-videosell-studio.mjs`: capturas em 1440 × 1000 e 1050 × 700 nos dois temas.

## Fora do escopo

- Redesenhar telas (isso é das specs 2 a 5).
- Novos temas além de claro e escuro.
- Mudar os temas internos do editor avançado.
