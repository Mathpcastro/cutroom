# Spec — Minicurso "Videosell 0.8: do zero ao piloto automático"

Spec para o Codex produzir o minicurso do Videosell 0.8.0. Ela descreve o que o aluno precisa aprender, a ordem das aulas, o que mostrar na tela, o roteiro falado e como cada conexão funciona. Tudo aqui foi conferido no app 0.8.0 (branch `feat/ux-2`, PR #11). Onde houver dúvida, **o app manda**: abra a tela e confira antes de gravar.

---

## 1. Objetivo e público

- **Aluno:** dono de SaaS, infoprodutor ou prestador de serviço que vende pelo Instagram e não tem tempo (ou vontade) de gravar vídeos.
- **Promessa do curso:** em menos de 1 hora o aluno instala o app, conecta a IA e o Instagram, cria o avatar, faz o primeiro Reels e deixa o piloto automático postando sozinho.
- **Resultado verificável ao fim:**
  - 1 avatar salvo;
  - 1 Reels pronto;
  - 3 ou mais Reels agendados no piloto;
  - 1 série de Histórias criada.
- **Tom:** direto, sem jargão técnico (nada de "render", "MCP", "timing" nas aulas principais; MCP só no módulo bônus), frases curtas, sempre mostrando a tela.
- **Proibido no curso:**
  - prometer resultado de vendas;
  - mostrar chaves ou tokens na tela;
  - falar "grátis" para o produto;
  - colocar selo ou aviso de patrocínio;
  - postar no Instagram de verdade sem que o dono da conta confirme.

## 2. Formato e entrega

- **Tamanho:** 6 módulos, 15 aulas curtas (2 a 6 min cada), mais 1 módulo bônus para agentes (MCP).
- **Entregáveis do Codex, por aula:**
  1. roteiro falado completo (texto final para narrar ou gravar);
  2. roteiro de tela, passo a passo com o nome exato de cada botão;
  3. checklist "o aluno conseguiu se…";
  4. título e descrição para a plataforma (Cakto);
  5. capítulos (marcações de tempo) depois da gravação.
- **Gravação:**
  - Tela do app em 1920×1080, tema **Escuro**, fonte **115%**, idioma **Português**, com um perfil de gravação limpo (ver seção 9).
  - Narração na voz do Matheus. Gravação ao vivo ou voz clonada: ver a memória `reference_voz-clonada-higgsfield` (voz clonada no Higgsfield, modelo Eleven v4).
- **Edição:** seguir a skill `edicao-padrao-videos`:
  - cortes de respiro e de muletas;
  - zoom na tela quando clicar;
  - cartão de título por aula;
  - abertura promocional a partir da aula 2.
  - Nada de tela parada mais de 3 s: acelere com a etiqueta "» 8x" quando o app estiver gerando.

## 3. Mapa do app 0.8.0 (nomes exatos da interface)

**Barra lateral** (5 lugares, mais Ajustes):

| Item | Para que serve |
|---|---|
| **Criar** | Caixa "O que você quer postar hoje?" → **Criar Reels**. Atalhos: "Usar uma pauta do Radar", "Recriar um vídeo de referência", "Continuar uma história". **Ajustar** abre apresentação (com ou sem avatar), estrutura (vídeo direto ou história), estilo visual e idioma. |
| **Meus Reels** | Abas **Biblioteca de vídeos** (capas, clique para assistir, postar ou pôr no piloto) e **Projetos** (Rascunho, Pronto, Agendado, Publicado). |
| **Piloto automático** | Barra com o estado, **Reels por dia** (1 a 5, cada um no seu horário, com 1 h mínima entre eles), **Dias** e **Ligar/Pausar**. Calendário de 2 semanas em kanban (arrastar entre dias, com limite por dia). Painel **Prontos** e **Criar sozinho**. |
| **Ideias** | **Pautas** (Radar, Modelador, Seus melhores Reels) e **Desempenho** (Instagram Analytics). |
| **Histórias** | **Série pronta com IA**, **Com uma frase** e **Manual**. Dentro da série: **Episódios**, **Personagens** e **Sobre a série**; editor de episódio em blocos. |
| **Ajustes** (rodapé) | Perfil e marca, Avatares (Seu avatar), Vozes, Biblioteca da marca, Instagram, Inteligência artificial, Usar pelo meu agente (MCP), Editor avançado e Preferências (aparência, tamanho do texto, idioma). |

**Bloco do rodapé da lateral:**

- perfil ativo, com **+** para criar outro perfil;
- linha do Instagram (ponto verde = pronto para postar);
- linha da IA ("Codex · modelo", clique para trocar modelo e raciocínio);
- **Ajustes**;
- botão de tema.

## 4. Conexões (explicar com calma: é onde o aluno trava)

### 4.1 IA (escreve roteiros, pautas e histórias)

- **Padrão: Codex com a conta do ChatGPT.**
  - O app conecta sozinho ao abrir quando o computador já tem uma sessão.
  - Sem sessão: lateral › linha da IA (ou **Conectar a IA** no Início) › **Codex** › **Conectar**. O login do ChatGPT abre no navegador; depois de entrar, o app conecta sozinho (espera até 3 min).
- **Modelo e raciocínio:** clique em "Codex · <modelo>" na lateral. Escolha o modelo e o raciocínio (Baixo a Máximo). "Mais raciocínio escreve melhor, mas demora mais." A escolha vale para todo o app.
- **Outras opções** (mesma janela, botão **Trocar de IA**):
  - **Claude API**, com chave de console.anthropic.com › API Keys (cobra por uso);
  - **DeepSeek**;
  - **OpenRouter**;
  - **API compatível com OpenAI** (ex.: Ollama local: endereço + modelo).
- **Não existe** "Claude via terminal". Os termos da Anthropic não permitem usar a assinatura do Claude dentro de outro app. Para usar o Claude como agente, use o MCP (seção 6).

### 4.2 Instagram (Composio)

Em Ajustes › **Instagram**, um assistente de 3 passos. Cada passo mostra ✓ quando termina.

1. **Crie sua conta no Composio:** botão **Abrir o Composio** (app.composio.dev). "Já tenho conta" pula o passo.
2. **Cole a chave do seu projeto:**
   - caminho no painel: *Settings › Project Settings › API Keys*;
   - botões **Colar** e **Conectar**.
   - O app recusa a chave pessoal (`uak_…`) e confere a chave antes de salvar. Chave errada: "Essa chave não foi aceita…".
   - Quem usa o Carrossell usa a mesma chave: as contas conectadas lá aparecem aqui.
3. **Conecte o Instagram:**
   - botão **Conectar minha conta do Instagram** abre a autorização; depois clique em **Já conectei**;
   - a conta precisa ser **Profissional (Criador ou Empresa)**: conta pessoal não posta por aplicativo;
   - contas pessoais ou expiradas aparecem com o motivo e a ação (Reconectar, Mudar para profissional).

**Regra do curso:** gravar com a chave já colada e a tela borrada no campo, ou com o campo vazio. **Nunca mostrar uma chave.**

### 4.3 Voz

- Ajustes › **Vozes**: provedor padrão (Kokoro offline e sem créditos, voz local do Windows, ElevenLabs ou OpenAI com a chave da pessoa) e voz padrão.
- Nas Histórias, cada personagem tem a sua voz (botão **Ouvir**).

### 4.4 Marca (o que a IA sabe)

Ajustes › **Perfil e marca**, com três caminhos:

- **Pelo link do produto:** o app lê a página e a IA preenche;
- **Com um prompt:** copia um prompt para o ChatGPT ou Claude e você cola a resposta;
- **Preencher manualmente.**

Campos: nome, site, "O que vende e para quem", "Oferta e próxima ação", tom e cores. No primeiro uso, o mesmo passo aparece como "O que você vende?", com os caminhos **Gerar com a minha IA**, **Copiar prompt para o meu ChatGPT ou Claude** e **Responder a entrevista** (6 perguntas, sem IA).

### 4.5 Biblioteca da marca (o que a IA usa e segue)

Ajustes › **Biblioteca da marca**, com quatro abas:

- **Fotos e prints:** adicionar fotos, prints ou gravação MP4 (vários de uma vez). Os vídeos podem mostrar esses arquivos.
- **Provas:** resultados e depoimentos reais. A IA nunca inventa números.
- **Estilo:** imagens de como você quer que os vídeos pareçam. Não aparecem no vídeo.
- **Regras para a IA:** ex.: "nunca prometer resultado", "terminar sempre com o link da bio". Valem em todo vídeo.

## 5. Estrutura do minicurso (módulos e aulas)

Para cada aula: **objetivo**, **tela**, **roteiro** (o Codex escreve o texto final a partir dos pontos) e **checklist**.

### Módulo 1 — Começar

**1.1 O que o Videosell faz (3 min)**

- **Objetivo:** entender a promessa e o caminho completo.
- **Tela:** abrir o app; mostrar a lateral (Criar, Meus Reels, Piloto, Ideias, Histórias) e um Reels pronto em Meus Reels.
- **Pontos:**
  - vídeos de vendas em pixel art com um avatar e a sua voz;
  - você escreve uma frase, ele faz o roteiro, a voz, as cenas e o vídeo;
  - o piloto posta sozinho.
- **Checklist:** o aluno sabe os 5 lugares da lateral.

**1.2 Instalar e abrir (2 min)**

- **Tela:** página de download → instalador `CutRoom Setup 0.8.0.exe` → abrir. O app atualiza sozinho nas próximas versões.
- **Checklist:** o app abre no primeiro uso.

**1.3 Primeiro uso em 4 passos (5 min)**

- **Tela:** o guia (O que você vende → Seu apresentador → Sua voz → Onde postar), com barra de progresso. Mostrar os três caminhos do passo 1 e escolher **Gerar com a minha IA** com o link do produto.
- **Pontos:** cada passo pode ser pulado e retomado; o que faltar vira pendência discreta no Início.
- **Checklist:** perfil criado com a marca preenchida.

### Módulo 2 — Conectar

**2.1 Conectar a IA (Codex) e escolher o modelo (4 min)** — seção 4.1. Mostrar a linha "Codex · modelo" na lateral e a janela de modelo e raciocínio.

**2.2 Conectar o Instagram (6 min)** — seção 4.2, passo a passo. Mostrar o ponto verde na lateral. Explicar a conta profissional.

**2.3 Voz (3 min)** — seção 4.3. Kokoro já pronto; como trocar por ElevenLabs.

### Módulo 3 — Seu avatar e a sua marca

**3.1 Criar o avatar em uma tela (5 min)**

- **Tela:** Ajustes › Avatares (ou a pendência "Aprovar um avatar" no Início). Mostrar:
  - **Sugerir com IA pela marca**, que preenche nome, personalidade, estilo e cores;
  - a prévia ao vivo: é o motor de verdade, falando, piscando e mudando de pose (botões de pose e "Falando");
  - trocar **Rosto e corpo**, **Pele**, **Cabelo** e **Cor do cabelo**, **Roupa** e **Cor da roupa** (a cor da marca vem primeiro), **Detalhes**, **Acessório** (Nenhum, Fone, Óculos), **Nome** e **Personalidade**;
  - **Salvar avatar**: "Pronto. Os próximos vídeos já usam este avatar."
- **Checklist:** avatar salvo; o resumo do Início mostra "Com o avatar <nome>".

**3.2 Marca e Biblioteca (5 min)** — seções 4.4 e 4.5. Adicionar 3 fotos ou prints, 1 regra e 1 referência de estilo.

### Módulo 4 — Criar Reels

**4.1 Primeiro Reels com uma frase (6 min)**

- **Tela:** Criar → frase → **Criar Reels** (ou Ctrl+Enter).
- **Pontos:**
  - as 4 etapas: Roteiro → Voz → Cenas → Vídeo;
  - "Pode sair desta tela: a criação continua" (indicador na barra de cima);
  - o vídeo sai pronto, sem exportar.
- **Resultado:** tocar o vídeo e mostrar **Postar agora**, **Colocar no piloto automático** e **Ajustar** ("O que você quer mudar?", com a versão anterior ao lado e **Voltar à anterior**).
- **Checklist:** 1 Reels pronto em Meus Reels.

**4.2 Ideias que o Radar sugere (5 min)**

- **Tela:** Ideias › Pautas. O Radar gera 30 pautas sozinho (sem tema) e marca as **10 mais fortes**.
- **Pontos:**
  - abrir uma pauta para ver "Por que para", "Entrega" e "Por que testar primeiro";
  - **Criar vídeo** vai direto para as 4 etapas;
  - **Novas pautas** aceita um tema opcional;
  - **Modelador**: cole um Reels que funcionou e saem 10 pautas no mesmo princípio, sem copiar;
  - **Seus melhores Reels** usa o Desempenho.
- **Checklist:** um vídeo criado a partir de uma pauta.

**4.3 Recriar um vídeo de referência (4 min)**

- **Tela:** atalho "Recriar um vídeo de referência" → escolher o arquivo ou colar um link do X/.mp4 → **Analisar** → o card mostra quadros, ritmo, paleta e gancho → gerar.
- **Pontos:** copia a estrutura, não o conteúdo; Instagram e TikTok pedem o arquivo baixado.

**4.4 Meus Reels (3 min)** — biblioteca com capas, filtros (Pronto, Agendado, Publicado), assistir, postar, pôr no piloto; aba Projetos com a ação de cada estado.

### Módulo 5 — Piloto automático

**5.1 Ligar o piloto (6 min)**

- **Tela:** Piloto automático.
- **Pontos:**
  - escolher **Reels por dia** (1 a 5) e os horários (o app explica se ficarem a menos de 1 h);
  - escolher **Dias** (todo dia, dia sim dia não, dias da semana);
  - **Ligar**: o app mostra a prévia no calendário e pede **uma** confirmação ("Confirmar e ligar");
  - texto honesto: "Na hora marcada, o Videosell abre sozinho e publica. Se o computador estiver desligado, publica quando ligar (até 6 horas depois)."
- **Checklist:** 3 Reels agendados.

**5.2 Organizar como kanban (4 min)**

- **Pontos:**
  - arrastar vídeos entre os dias e da lista **Prontos** para um dia;
  - o contador `1/2` mostra o limite do dia;
  - clicar num vídeo abre o painel: legenda, data e hora, Antes/Depois, Publicar agora, Remover da fila;
  - **Pular este dia**;
  - aviso "Sua fila acaba…" e notificações do Windows.
- **Checklist:** um vídeo movido para outro dia.

**5.3 Criar sozinho (3 min)** — aba **Criar sozinho**: pautas do Radar viram rascunhos automaticamente. Ele **não publica**: os rascunhos esperam revisão.

### Módulo 6 — Histórias

**6.1 Série pronta com IA (6 min)**

- **Tela:** Histórias › **Série pronta com IA**.
- **Pontos:**
  - escolher Gênero, Episódios (3/5/7), Personagens (2/3), "O produto aparece?", "Onde se passa" e uma ideia opcional (em branco, a IA decide pela marca);
  - **Criar série pronta**: a IA cria o elenco, escreve todos os episódios e gera os vídeos (pode sair da tela);
  - ao terminar: **Ligar piloto automático: 1 episódio por dia**.
- **Checklist:** série com episódios prontos e agendados.

**6.2 Ajustar personagens e roteiro (5 min)**

- **Pontos:**
  - Personagens: avatar e voz (botão **Ouvir**);
  - editor do episódio em blocos (personagem, humor e fala), com ações de IA por fala (reescrever, deixar mais engraçado, encurtar), "O que mudar no roteiro?" e **Outro final**;
  - duração estimada (25 a 45 s);
  - os avisos mostram o que o motor não suporta;
  - **Gerar de novo**.

### Bônus — Usar pelo seu agente (Claude ou Codex) via MCP

**B.1 Conectar o agente (5 min)**

- **Tela:** Ajustes › **Usar pelo meu agente (MCP)** (ou a janela da IA › aba **Pelo meu agente**).
- Três botões **Copiar**:
  - **Claude (aplicativo):** Configurações › Desenvolvedor › Editar configuração; cole dentro de `mcpServers` e reinicie o Claude;
  - **Codex:** cole no fim de `~/.codex/config.toml` e reinicie;
  - **Claude Code (terminal):** rode o comando `claude mcp add videosell …` uma vez.
- **Ensinar o meu agente a usar o Videosell** instala a skill `cutroom-videos` em `~/.claude/skills` e `~/.codex/skills`.
- **Usar só pelo meu agente** faz o app parar de pedir para conectar a IA.
- **Regra:** o Videosell precisa estar aberto. A ponte só conversa com o app neste computador (127.0.0.1), com token.

**B.2 Pedidos prontos para o agente (4 min)** — exemplos na seção 6.3. Mostrar um pedido no Claude e o vídeo aparecendo em Meus Reels.

## 6. MCP — referência para o Codex (não ler em voz alta no curso)

### 6.1 Como funciona

- O app expõe um servidor MCP local. A ponte `tools/cutroom-claude-desktop-bridge.cjs` roda no próprio executável do app (`ELECTRON_RUN_AS_NODE=1`), então não precisa de Node instalado.
- A configuração pronta vem do botão Copiar (IPC `mcpSetup`).

### 6.2 Ferramentas (70), por grupo

- **Projeto do editor:** `get_project`, `edit_project`, `transcribe`, `inspect_frame`, `create_blank_canvas`, `import_media`, `export_video`.
- **Áudio e marca:** `add_audio`, `list_voices`, `add_voiceover`, `search_music`, `add_music`, `get_brand`.
- **Formatos:**
  - `list_formats` e `get_format_guide`;
  - formatos: `avatar`, `ui-motion`, `professor`, `landing-flyover`, `historia`, `pixel`, `e-se`, `kurzgesagt`.
- **Filmes (vídeo em código):**
  - `create_film` e `update_film_avatar`;
  - `film_voiceover` (uma voz) e `film_dialogue` (uma voz por fala);
  - `film_asset`, `write_film_file`, `read_film_file`, `film_capture_page`;
  - `list_effects` e `film_add_effect` (236 efeitos);
  - `film_check`, `film_stills`, `film_review`;
  - `render_film` (MP4 em `Vídeos/CutRoom`);
  - `list_films`, `render_frame`, `review_video`, `job_status`.
- **Referência:** `analyze_reference` (arquivo, link do X ou .mp4).
- **Instagram e piloto:**
  - `instagram_accounts`;
  - `publish_reel` (só com `confirm:true`, depois da confirmação do usuário no chat);
  - `schedule_reel`, `cancel_scheduled_reel`;
  - `schedule_reels_daily` (`times` com 1 a 5 horários, `days` = `daily`/`alternate`/dias da semana, `pilot`).
- **Perfis:** `profile_create`, `profile_get`, `profile_list`, `profile_update`, `profile_duplicate`, `profile_delete`, `profile_select`, `profile_list_projects`.
- **Histórias:** `series_list`, `series_create`, `series_get`, `series_update`, `series_delete` (`confirm:true`), `character_upsert`, `episode_create`, `episode_write_script` (devolve o brief para o agente escrever), `episode_update`, `episode_generate`.
- **Avatar avançado:** `avatar_get_contract`, `avatar_create_candidate`, `avatar_render`, `avatar_validate`, `avatar_review`, `avatar_select_candidate`, `avatar_revise_part`, `avatar_save_revision`, `avatar_compare_revisions`, `avatar_cancel`, `avatar_import_reference`, `avatar_analyze_reference`.
- **Outros:** `open_studio`.

### 6.3 Pedidos de exemplo (para a aula B.2)

- "Crie um Reels no Videosell sobre <tema>, com o meu avatar, e me mostre o vídeo antes de postar."
- "Liste as minhas contas do Instagram no Videosell e agende estes 3 vídeos, 2 por dia, às 12h e às 18h, a partir de amanhã." (O agente pede confirmação.)
- "Crie uma série de 5 episódios no Videosell sobre <ideia>, escreva os roteiros e gere o episódio 1."
- "Analise este vídeo de referência <link> e recrie no formato pixel com o meu avatar."

## 7. Erros comuns (criar uma aula curta ou um PDF de apoio)

| Sintoma | Causa | O que fazer |
|---|---|---|
| "Conecte a IA para criar" | IA desconectada | Lateral › linha da IA › Codex › Conectar (login no navegador) |
| "Essa chave não foi aceita" | Chave pessoal ou incompleta | Copiar a chave do **projeto** no Composio |
| Conta aparece com "conta pessoal" | Instagram pessoal | Mudar para conta Profissional e clicar em Já conectei |
| Reels "Atrasado" | Computador desligado por mais de 6 h | Abrir o painel do item › Publicar agora ou Remover |
| "Esse dia já tem N Reels" | Limite do dia no kanban | Aumentar Reels por dia ou arrastar para outro dia |
| "Uma das vozes ainda está sendo preparada" | Voz offline baixando | Esperar e clicar em Tentar de novo |

## 8. Regras de texto para os roteiros

- Português do Brasil, segunda pessoa ("você"), frases de até 15 palavras.
- Sempre: o nome exato do botão, entre aspas na legenda.
- Sem jargão: "vídeo" e não "render"; "agendar" e não "schedule"; "agente" e não "MCP" (exceto no bônus, onde explicar MCP numa frase: "uma porta para o seu Claude ou Codex controlar o Videosell").
- Cada aula termina com o próximo passo ("na próxima aula…").
- Não citar números de vendas nem clientes que não existam. Exemplos de produto: usar o próprio Videosell.

## 9. Preparação da gravação

- **Perfil de gravação novo** (botão **+** na lateral), chamado "Videosell" e com a marca preenchida pelo link.
- **Avatar** criado na aula 3.1 (gravar a criação de verdade).
- **3 ou 4 Reels bons** já gerados antes do módulo 5, para o calendário não ficar vazio.
- **Instagram conectado** com uma conta de teste profissional. Não publicar sem confirmação do dono.
- **Esconder** notificações do Windows durante a gravação.
- **Versão:** 0.8.0 (confira pelo nome do instalador, `CutRoom Setup 0.8.0.exe`).

## 10. Critérios de aceite do minicurso

- [ ] As 15 aulas e o bônus cobrem as seções 3 a 6, sem pular nenhuma conexão.
- [ ] Todo nome de botão e de tela bate com o app 0.8.0.
- [ ] Nenhuma chave, token ou e-mail aparece em tela ou no roteiro.
- [ ] Nenhuma publicação real feita sem confirmação.
- [ ] Cada aula tem roteiro falado, roteiro de tela, checklist, título e descrição.
- [ ] O aluno que seguir só os vídeos termina com avatar, 1 Reels pronto, 3 agendados e 1 série.
- [ ] Duração total entre 60 e 80 minutos.
