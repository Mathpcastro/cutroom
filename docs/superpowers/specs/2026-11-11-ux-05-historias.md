# Spec 5 — Histórias: séries, personagens e roteiros escritos pela IA

## Problema

"História" hoje é só um botão em Criar Reel que muda o pedido enviado à IA. Não existe série, elenco, lista de episódios nem roteiro que o usuário possa ver e ajustar. O motor de episódios já existe e não está ligado a nada disso.

## Estado atual

- Motor: `CRM.autoStory` e `CRM.parseStory` em `resources/film-kit/cutroom-motion.js`; formato `historia` em `electron/core/formats.ts`; receita em `resources/film-recipes/historia/`. Roteiro em texto: `# Episódio N: Título`, `[cena: lugar, dia|noite]`, `Nome (humor): fala`; linha sem nome = narrador. Cenários: quarto, escritorio, rua, cafe. Humores: animado, sonolenta, pensativa, confiante, brava, nervoso, surpresa.
- App: `ReelCreator.tsx` tem `storyHtml`, `storySpoken` e `STORY_SAMPLE`, mas o fluxo atual usa `draft.narrative` + `planSalesReel(..., story)` e **não** chama `autoStory`.
- Avatares: um avatar padrão por perfil (`profile.defaultAvatar`); amostras `strategist`, `companion`, `expert` no kit. Cada filme congela a revisão do avatar.
- Voz: uma voz por perfil. Vozes por personagem só pelo MCP (`film_voiceover{audio}` com diálogo gerado fora).
- IA: `structuredReply` (`salesReels.ts`) devolve JSON validado por esquema.

## Requisitos

### A. Tela "Histórias" com três níveis

1. **Séries** — cartões com capa (quadro do último episódio), título, número de episódios e "próximo episódio". Botão **Nova série**.
2. **Dentro da série** — três abas:
   - **Episódios**: lista numerada com estado (Ideia, Roteiro, Pronto, Agendado, Publicado), miniatura e ação principal. Botão **Novo episódio**.
   - **Personagens**: o elenco fixo da série.
   - **Sobre a série**: premissa, tom, cenário habitual, o que nunca muda (bíblia da série).
3. **Dentro do episódio** — roteiro editável à esquerda, prévia à direita.

### B. Criar a série com uma frase

- "Sobre o que é a sua série?" + **Criar com IA**. A IA devolve, para aprovar e editar: título, premissa em 2 frases, tom, 2 a 4 personagens (nome, papel, jeito de falar, uma mania) e **ideias para os 5 primeiros episódios** (título + uma linha).
- A série pode ser ligada ao produto (aparece em cena de vez em quando) ou ser só entretenimento. Pergunta única no começo: "Essa série deve mostrar o seu produto?" (Nunca / Às vezes / Sempre no final).

### C. Personagens

- Cada personagem tem: nome, papel, descrição curta, jeito de falar, **avatar** e **voz**.
- Avatar: escolher entre os avatares do perfil, as bases do app ou "Criar novo" (abre o criador de avatar e volta). O protagonista usa por padrão o avatar padrão do perfil.
- Voz: escolher na lista de vozes disponíveis no provedor configurado (local/Kokoro, ElevenLabs, OpenAI), com botão **Ouvir** numa frase de exemplo do próprio personagem. Padrão: vozes diferentes para cada um, escolhidas automaticamente entre as instaladas.
- O narrador é um personagem especial (sem avatar), com voz própria.
- Mudar um personagem não altera episódios já prontos (cada episódio congela elenco e revisões de avatar, como os filmes fazem hoje).
- Limite inicial: 4 personagens em cena por episódio (o motor posiciona até 3 + narrador; validar e avisar).

### D. Roteiro escrito pela IA

- **Novo episódio** → escolher uma das ideias sugeridas ou escrever uma linha → **Escrever roteiro**. A IA recebe: bíblia da série, personagens com jeito de falar, resumo dos episódios anteriores (para continuidade e ganchos), e a regra do produto.
- Saída em esquema validado (não texto livre): título, cenas com lugar e período, falas com personagem, humor e texto, e o gancho final. O app converte para o formato de texto do motor.
- Regras passadas à IA: 25–45 s; falas de até 12 palavras; abrir no meio da ação; um conflito; uma virada; terminar em gancho para o próximo; só usar os cenários e humores que o motor suporta; nomes exatamente como no elenco.
- **Editor de roteiro em blocos**, não em texto cru: cada fala é uma linha com seletor de personagem, seletor de humor e o texto; cenas como divisores com lugar e período; arrastar para reordenar; "+ fala", "+ cena". Um botão "Ver como texto" mostra o formato do motor para quem quiser.
- Ações de IA por trecho: "Reescrever esta fala", "Deixar mais engraçado", "Encurtar", "Outro final". E um campo livre "O que mudar no roteiro?".
- Contador de duração estimada e aviso quando passar de 45 s ou quando uma fala tiver mais de 12 palavras.
- "Sugerir próximos episódios" gera mais 5 ideias a partir do que já aconteceu.

### E. Do roteiro ao vídeo

- **Gerar episódio**: narração por personagem (cada fala com a voz do seu personagem, juntadas em um áudio com os tempos por palavra), depois `CRM.autoStory` com o elenco real (`cast` por nome → avatar congelado), título e número do episódio vindos da série.
  - Serviço novo no processo principal para o diálogo: recebe as falas com voz, gera cada trecho com o provedor, concatena com pausas curtas e devolve áudio + tempos. A UI e uma ferramenta MCP (`film_dialogue`) usam o mesmo serviço.
  - Sem voz diferente disponível (ex.: só uma voz local instalada): avisar e usar a mesma voz, sem bloquear.
- Prévia por quadros antes do vídeo final, como nos outros formatos.
- Cartão final "Continua no próximo episódio" com o CTA configurável por série ("Segue pra parte 2").
- Depois de pronto, as mesmas ações da Spec 4: Postar, Agendar, Colocar no piloto automático. O piloto pode receber "1 episódio por dia desta série".
- Legenda sugerida com número e título do episódio e uma pergunta para os comentários.

### F. Dados

- Guardar por perfil, no processo principal: `<userData>/profiles/<profileId>/series/<seriesId>/series.json` (bíblia, personagens, ideias) e `episodes/<n>.json` (roteiro estruturado, estado, filme vinculado, resumo de 1–2 frases para continuidade).
- Esquemas com validação (zod), escrita atômica e transações por perfil, como `ProfileService`.
- Migração: nenhuma (não há séries hoje). O `STORY_SAMPLE` vira a série de exemplo "O primeiro cliente", oferecida no estado vazio.

### G. MCP

Ferramentas novas, usando os mesmos serviços da interface: `series_list`, `series_create`, `series_get`, `series_update`, `character_upsert`, `episode_create`, `episode_write_script` (IA), `episode_update`, `episode_generate`, `film_dialogue`. Apagar série exige confirmação, como `profile_delete`.

## Critérios de aceite

- [ ] Criar uma série a partir de uma frase, aprovar o elenco e gerar o episódio 1 sem escrever nenhuma fala à mão.
- [ ] O episódio 2 cita ou continua algo do episódio 1 (o resumo anterior entra no pedido à IA).
- [ ] Cada personagem fala com a sua voz e só mexe a boca na própria fala.
- [ ] Editar uma fala no editor em blocos e gerar de novo altera só aquela fala no vídeo.
- [ ] Roteiro fora das regras do motor (cenário ou humor desconhecido, personagem fora do elenco, mais de 4 em cena) é apontado no editor antes de gerar, com a correção sugerida.
- [ ] Trocar o avatar ou a voz de um personagem não muda episódios já prontos.
- [ ] A série, os personagens e os roteiros sobrevivem a reiniciar o app e ficam separados por perfil.
- [ ] Um agente consegue fazer o mesmo fluxo só pelo MCP.

## Testes

- Esquemas e armazenamento de séries/episódios (isolamento por perfil, escrita atômica).
- Conversão roteiro estruturado ↔ texto do motor (ida e volta sem perda) e validação contra `CRM.parseStory`.
- Montagem do pedido à IA (inclui bíblia, elenco e resumos; não inclui segredos) e validação da resposta com esquema.
- Serviço de diálogo com provedor simulado: ordem das falas, tempos contínuos, pausas.
- Teste de componente do editor em blocos (adicionar, reordenar, validar).

## Fora do escopo

- Cenários novos além dos quatro existentes (pode virar spec própria).
- Animação de personagens andando ou interagindo fisicamente.
- Histórias com mais de 4 personagens em cena.
