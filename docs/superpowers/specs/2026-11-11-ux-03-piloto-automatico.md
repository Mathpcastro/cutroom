# Spec 3 — Piloto automático: uma tela, uma linha do tempo

## Problema

Hoje existem dois "pilotos" com nomes parecidos, em lugares diferentes, e nenhum mostra o quadro inteiro:

- **Piloto de criação** (`ReelPilot.tsx`, tela Rotina): gera rascunhos a partir de uma fila de pautas, só com o app aberto, e guarda o estado em `localStorage`.
- **Piloto automático de publicação** (`PublishSettings.tsx`): lista de caixas de seleção com nomes de arquivo `.mp4`, um horário e o botão "Ligar: 1 por dia". Publica pelo agendador do sistema (`reel-schedule.ts`, `Publisher.scheduleSeries`).

O usuário não enxerga a semana, não sabe o que vai sair quando, escolhe vídeos pelo nome do arquivo e usa uma legenda única para todos.

## Estado atual (serviços que continuam)

- `electron/core/publish.ts`: `schedule`, `scheduleSeries`, `cancelScheduled`, `runDue`, `publishLate`, `settings().scheduled` (status `scheduled | publishing | published | late | failed | cancelled`).
- `electron/core/reel-schedule.ts`: tarefa do sistema que abre o app com `--publicar-reels`; tolerância de 6 h.
- `src/components/studio/ReelWorkspace.tsx`: tela "Rotina" com "Aguardando revisão" e "Fila de publicação".
- Cada Reel gerado no app tem legenda sugerida (`plan.caption`) e projeto vinculado ao perfil.

## Requisitos

### A. Uma tela "Piloto automático" (substitui Rotina)

Três áreas, de cima para baixo:

1. **Estado, em uma frase** — "Ligado · próximo Reels amanhã às 18:00 em @usuario" ou "Desligado". Interruptor grande **Ligar / Pausar**. Se faltar algo, a frase diz o quê e o botão resolve ("Conecte o Instagram", "Adicione vídeos à fila").
2. **Calendário das próximas 2 semanas** — uma linha por dia, com a miniatura do vídeo, o horário e o estado (Agendado, Publicando, Publicado ✓, Atrasado, Falhou). Dias vazios aparecem como "Sem vídeo" com o botão "+".
   - Arrastar para trocar a ordem ou o dia; "Pular este dia"; "Publicar agora"; "Remover da fila".
   - Clicar num item abre o painel lateral com o vídeo tocando, a legenda editável e o horário.
3. **Fila de vídeos prontos** — miniaturas (não nomes de arquivo) dos Reels exportados e ainda não agendados, com "Adicionar ao piloto". Rascunhos aguardando revisão aparecem aqui com o selo "Revisar antes" e não podem ser agendados sem revisão.

### B. Regras da programação (em linguagem comum)

- "Postar **N Reels** por dia", com N de **1 a 5** (padrão 1), nos dias escolhidos (todo dia, dia sim/dia não, ou dias da semana marcados).
  - Cada Reels do dia tem o seu horário. Padrões sugeridos conforme N: 1 → 18:00; 2 → 12:00 e 18:00; 3 → 09:00, 13:00 e 18:00; 4 → 08:00, 12:00, 16:00 e 20:00; 5 → 08:00, 11:00, 14:00, 17:00 e 20:00. Todos editáveis.
  - Intervalo mínimo de 1 hora entre dois Reels do mesmo dia (validar e explicar).
  - Com mais de 1 por dia, o calendário mostra as faixas de horário dentro de cada dia e o aviso "Sua fila acaba em X dias" considera o consumo real.
  - Hoje `Publisher.scheduleSeries` e a ferramenta `schedule_reels_daily` aceitam um vídeo por dia em um horário: ampliar o serviço e o esquema para `times: string[]` (1 a 5 horários), mantendo `time` como atalho compatível. A tarefa do sistema (`reel-schedule.ts`) passa a ser registrada para cada horário.
  - Se o Instagram recusar por limite de publicações, o item fica como Falhou com o motivo, e os próximos seguem (Seção F).
- Ao ligar, o app distribui a fila pelos próximos dias e mostra o resultado no calendário **antes** de confirmar.
- Vídeos adicionados depois entram no primeiro dia livre.
- **Legenda por vídeo**: cada item usa a legenda do próprio Reel (sugerida na criação), editável. Sem legenda única para todos. O crédito de música CC BY do filme entra sozinho no fim da legenda.

### C. Confirmação honesta, uma vez

- Ligar o piloto mostra um resumo ("7 Reels, de 12/11 a 18/11, às 18:00, em @usuario") e pede **uma** confirmação para o lote. Depois disso, cada vídeo **novo** que entrar na fila pede confirmação daquele vídeo (um clique em "Agendar este"). Nada é publicado sem ter sido confirmado.
- Texto fixo e curto explicando como funciona: "Na hora marcada, o Videosell abre sozinho e publica. Se o computador estiver desligado, publica quando ligar (até 6 horas depois). Depois disso, o vídeo fica como Atrasado e espera você."

### D. Criação automática como opção do mesmo piloto

- Um bloco recolhível "Criar os próximos Reels sozinho": usa as pautas do Radar para gerar **rascunhos** (com o app aberto e a IA conectada) e os coloca em "Revisar antes". Deixar claro que criação automática **não publica**: gera rascunhos para aprovar.
- Mover o estado do piloto de criação de `localStorage` para um arquivo por perfil no processo principal (`<userData>/profiles/<id>/pilot.json`), com o mesmo esquema validado, e migrar o que existir.
- Quando o piloto está ligado e a fila vai acabar em menos de 3 dias, mostrar o aviso "Sua fila acaba na quinta" com os botões "Criar mais Reels" e "Gerar pautas".

### E. Avisos fora do app

- Notificação do sistema quando um Reels é publicado, quando falha e quando a fila fica vazia (pode ser desligada em Aparência/Ajustes).
- Ao abrir o app com itens Atrasados ou com Falha, um aviso no topo leva direto ao item.

### F. Falhas

- Cada falha mostra o motivo traduzido (mesma tabela da Spec 2) e as ações "Tentar de novo" e "Remover". Uma falha não trava os dias seguintes.

## Critérios de aceite

- [ ] Existe um único lugar chamado "Piloto automático"; os textos "Rotina" e "Piloto de criação" saem da navegação.
- [ ] Em menos de 1 minuto e sem ler ajuda, dá para: ver o que sai em cada dia, ligar, pausar, trocar a ordem e mudar uma legenda.
- [ ] Os vídeos aparecem por miniatura e título, nunca só pelo nome do arquivo.
- [ ] Cada vídeo sai com a sua legenda.
- [ ] Dá para escolher de 1 a 5 Reels por dia; com 5, o calendário mostra os cinco horários de cada dia e a publicação respeita cada um.
- [ ] Sem Instagram conectado, a tela mostra o cartão da Spec 2 em vez de botões desabilitados.
- [ ] Reiniciar o app (ou o computador) mantém fila, calendário e estado; a tarefa do sistema continua correta depois de reordenar.
- [ ] As ferramentas MCP `schedule_reel`, `schedule_reels_daily`, `cancel_scheduled_reel` e `instagram_accounts` mostram e alteram a mesma fila que a tela.

## Testes

- `tests/reel-schedule.test.ts`: distribuição da fila (diário, dia sim/dia não, dias da semana, de 1 a 5 Reels por dia com horários próprios e intervalo mínimo), reordenação, pular dia, entrada de vídeo novo, legendas por item, migração do piloto de criação.
- Teste de componente: estados desligado, ligado, sem conexão, fila vazia, item atrasado, item com falha.
- Nenhuma publicação real nos testes (cliente Composio simulado).

## Fora do escopo

- Publicar com o computador desligado (exigiria servidor).
- Melhor horário calculado por Analytics (pode virar sugestão depois).
