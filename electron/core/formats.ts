/**
 * Video formats CutRoom produces from scratch, as FILMS IN CODE (HyperFrames: HTML + GSAP + kit).
 * Each recipe is written for the agent that drives CutRoom (in-app chat, Claude Code, Codex) and
 * ships with a starter film in resources/film-recipes/<id>/ — CutRoom's own version of the format,
 * complete and rendering — that create_film{format} copies into the new film folder.
 * The formats are CutRoom's own, inspired by what performs on Reels/Shorts; no third-party prompt is copied.
 */
export interface VideoFormat {
  id: string;
  name: string;
  aspect: "9:16" | "16:9";
  length: string;
  goodFor: string;
  needs: string[];
  guide: string;
  checklist: string[];
}

const FLOW = `
## Fluxo (todo formato)
1. \`get_brand\` — o que vende, para quem, tom, oferta, CTA, cores e logo. Tudo no vídeo fala e parece a marca.
2. Roteiro falado completo, em português do Brasil, frases curtas, uma ideia por frase. Mostre ao usuário antes de gerar a voz. Sem jargão de IA ("revolucionário", "desbloqueie", "no mundo de hoje"). Números só os que o usuário deu.
3. \`create_film{name, format}\` — a pasta já vem com o filme inicial deste formato (a versão do CutRoom), \`CUTROOM.md\` e o kit.
4. \`film_voiceover{film, text}\` — sem provedor, usa a voz escolhida pelo usuário (ElevenLabs, ou Kokoro offline, sem créditos de API). Grava \`timing.js\`; se responder \`status:"generating"\`, chame de novo com o mesmo texto.
5. Adapte \`index.html\`: textos, telas, cores, e reancore cada cena com \`CR.at("palavra", n, segundosReserva)\`. \`data-duration\` e o \`tl.set({}, {}, D)\` final = \`voiceEnd + 1,5–2 s\`.
6. Música: \`search_music{query, kind:"music"}\` → \`film_asset{film, music:id}\` → \`<audio id="musica" data-volume="0.14" data-fade-out="1.5">\`. Efeitos (\`kind:"sfx"\`, whoosh/pop/click) cada um com \`id\` e \`data-track-index\` próprios, volume 0,3–0,5, na batida da cena.
7. Legenda pronta para o post (fórmula na seção Funil abaixo).
8. \`film_check\` → \`film_stills\` em 5–6 momentos (gancho, cada virada, final) → corrija → \`film_review\` (nota por item do checklist; corrija tudo abaixo de 8) → \`render_film\` (chame de novo até \`status:"done"\`).
9. Entregue o caminho do MP4 e a legenda; com a confirmação do usuário, \`publish_reel\` ou \`schedule_reels_daily\`. Se houver música CC BY, a linha de crédito vai na legenda.

## Funil orgânico (sem tráfego pago)
O vídeo existe para levar a pessoa do feed para a venda: **Reels (alcance) → visita no perfil → clique no link → venda**. Os carrosséis do Carrossell fazem o meio do caminho (confiança e prova) no mesmo perfil.
- **Gancho para quem não segue:** os primeiros 2 s falam com um desconhecido (a dor ou um número), nunca "oi, eu sou".
- **Laço aberto:** prometa cedo algo que só aparece no fim ("no final eu mostro o carrossel que trouxe 112 assinaturas").
- **Uma ideia só** por vídeo; o produto aparece como a saída, não como anúncio.
- **CTA de perfil** nos últimos 3 s, falado e na tela: \`CR.profileCTA(tl, CR.at("perfil", 1, D - 3))\` ("LINK NO PERFIL" + @ da marca apontando para a foto do perfil). Uma ação só: não peça para seguir, curtir, comentar e clicar ao mesmo tempo.
- **Final que volta ao começo** quando der (a última frase puxa a primeira): replay conta como retenção.
- **Legenda** (até ~300 caracteres): 1ª linha repete o gancho; 2–3 linhas de valor; "👉 O link está no perfil (@marca)"; crédito da música CC BY; 3–5 hashtags do nicho. Fixe um comentário com a mesma chamada.
- **Cadência:** 1 Reels por dia no mesmo horário (\`schedule_reels_daily\`) + 1 carrossel por dia no piloto automático do Carrossell. Perfil: bio com a promessa + link para a oferta, destaques com prova.
- Mude só uma variável por vez (gancho, formato ou horário) e compare visitas ao perfil e cliques, não curtidas.

## Ritmo que segura (vale para todos)
- Gancho em **imagem** nos 3 primeiros segundos: algo se mexendo + a frase mais forte do roteiro. Nada de logo ou "olá" no começo.
- Novo plano a cada 1,5–3 s (corte, troca de card, câmera que entra). Nada parado mais de 1,5 s: \`CR.camera\` em deriva lenta e soco nas palavras-chave.
- Mostre em vez de listar: cada frase importante vira uma demonstração (tela, número contando, antes/depois).
- Cada elemento entra até 0,15 s depois da palavra que ele mostra; contadores chegam ao número na palavra falada.
- Texto na tela ≤ 6 palavras, grande (títulos 120–190 px em 1080x1920), longe da faixa de baixo (interface do Reels: deixe livres os últimos ~380 px e a direita inferior).
- Virada no meio (a crença comum estava errada / o problema real é outro) e final com pergunta que divide os comentários ou CTA claro.
`;

const CHECK_COMMON = [
  "Gancho em imagem com movimento nos 3 primeiros segundos",
  "Novo plano a cada 1,5–3 s; nada parado mais de 1,5 s",
  "Cada card/elemento entra até 0,15 s depois da palavra falada",
  "Texto ≤ 6 palavras por card, legível no celular, fora da faixa de baixo",
  "Cores, logo e tom da marca do usuário",
  "Áudio: narração clara, música baixa (≈ 0,14), efeitos na batida, nada mudo",
  "Final com pergunta que divide ou CTA claro",
  "Funil: CTA 'link no perfil' falado e na tela nos últimos 3 s, com o @ da marca",
];

export const FORMATS: VideoFormat[] = ([
  {
    id: "professor",
    name: "Aula com apresentador em pixel art",
    aspect: "9:16",
    length: "35–55 s",
    goodFor: "Ensinar um erro comum do público e mostrar o produto como a saída. Explainer de nicho que gera salvamentos e comentários.",
    needs: ["prints ou telas reais do produto (opcional)"],
    guide: `# Aula com apresentador em pixel art
Um apresentador em pixel art no canto inferior (boca pela voz, piscada, joinha) "dá a aula" enquanto o quadro troca a cada frase: títulos que batem, cards, números contando, o produto real.

## Estrutura (≈ 45 s)
1. **Gancho (0–3 s):** contraste em duas linhas que batem uma depois da outra ("MIL CURTIDAS." / "ZERO VENDAS."), câmera com soco em cada uma.
2. **Diagnóstico (3–12 s):** o erro que o público comete, mostrado (feed de posts com curtidas e painel zerado, ou os 3 tipos lado a lado).
3. **Virada (12–25 s):** o que funciona, em passos de 1 a 3, cada passo num card que entra na palavra.
4. **Prova (25–38 s):** o produto real (prints do app ou slides reais) deslizando num celular; um número que conta até o resultado do usuário.
5. **Final (38–45 s):** pergunta que divide ("curtida ou assinatura?") + o apresentador faz joinha.

## Como montar
- \`CR.pixelPresenter(tl, {x, y, px:18, thumbs:[...]})\`: o moletom usa a cor de destaque da marca. Nunca use motion blur com pixel art.
- Quadro: um wrapper \`.cam > .punch\` com \`CR.camera(tl, ".cam", D, [socos], {inner:".punch"})\`.
- Legenda palavra a palavra no topo com \`CR.captions\` (palavras-chave em itálico serifado, cor de destaque).
- Celular: div com borda arredondada de 64 px e sombra; os prints deslizam dentro com \`x\` em passos.
- Troca de bloco com \`CR.wipe(tl, t)\` (meio-tom) no máximo 2 vezes.`,
    checklist: [...CHECK_COMMON, "Apresentador vivo o tempo todo (boca, piscada, balanço)", "Produto real aparece na prova"],
  },
  {
    id: "ui-motion",
    name: "UI motion: o produto funcionando",
    aspect: "9:16",
    length: "20–35 s",
    goodFor: "Mostrar o app/SaaS fazendo o trabalho: formas que viram interface, cursor clicando, estados que mudam. Ótimo para lançamento e anúncio.",
    needs: ["nome das telas e ações principais do produto", "cores da marca"],
    guide: `# UI motion: o produto funcionando
Formas simples (pílulas, círculos) se transformam na interface do produto; um cursor clica e cada clique muda o estado. Fundo limpo, muito movimento, poucas palavras.

## Estrutura (≈ 28 s)
1. **Gancho (0–2,5 s):** uma pílula da cor da marca estica e vira um campo de texto; o pedido do usuário é digitado (\`CR.type\`).
2. **Ação (2,5–14 s):** 3 a 4 estados do produto, um por frase: cursor vai até o botão (\`CR.cursor\` com \`click:true\`), clique → o card morfa (\`width/height/borderRadius\`) para o próximo estado; itens entram em cascata (\`stagger\` 0,06).
3. **Resultado (14–22 s):** o que o produto entrega aparece grande (lista pronta, vídeo, gráfico subindo) com um número contando.
4. **Final (22–28 s):** logo + frase de 4–6 palavras + CTA.

## Como montar
- Morfologia: uma única div \`.shape\` muda de forma com tweens de \`width\`, \`height\`, \`borderRadius\`, \`x\`, \`y\` (0,45 s, \`power3.inOut\`), e o conteúdo de cada estado faz fade por cima.
- Cursor: \`CR.cursor(tl, [{x,y,t}, {x,y,t,click:true}, ...])\`, chegando 0,1 s antes da palavra.
- Sombras suaves (\`0 30px 80px rgba(0,0,0,.18)\`), cantos 28–48 px, tipografia Instrument Sans.
- Efeito "click" em cada clique e um whoosh por troca de estado.`,
    checklist: [...CHECK_COMMON, "Cada clique muda visivelmente o estado", "Formas morfam (sem cortes secos entre telas)"],
  },
  {
    id: "landing-flyover",
    name: "Voo 3D pela landing page",
    aspect: "9:16",
    length: "14–20 s",
    goodFor: "Anúncio do SaaS a partir da própria landing page: a câmera desliza sobre a página deitada em 3D, sobe para mostrar tudo e fecha num cartão com a frase da marca.",
    needs: ["link da landing page", "frase final em duas partes (afirmação + cauda curta)"],
    guide: `# Voo 3D pela landing page
A página do usuário vira um plano deitado num chão claro; uma câmera contínua (sem cortes) desliza por ela, sobe para a vista de cima e termina num cartão com a frase da marca.

## Estrutura (≈ 16 s)
1. \`film_capture_page{film, url}\` — grava \`assets/pagina.jpg\` (1440 px de largura, até 9000 de altura).
2. **Voo (0–9 s):** o plano em \`perspective: 1400px\`, inclinado \`rotateX(52°)\`, desliza de cima para baixo em velocidade constante (\`y\` com \`ease:"none"\`, só aceleração no começo e freada no fim). 2–3 elementos da página (botão, card, print do produto) "levantam" do papel: cópias recortadas com \`clip-path\` e \`translateZ\` + sombra.
3. **Subida (9–11 s):** o \`rotateX\` vai a 0 e a escala diminui até a página inteira caber (vista de cima).
4. **Cartão (11–16 s):** fundo da marca, frase em duas linhas (a segunda curta e em itálico), logo; música bate aqui.

## Como montar
- Narração é opcional: este formato funciona só com música e 1–2 whooshes (na subida e no cartão). Sem narração, não grave voz e não inclua \`timing.js\` no HTML.
- Proibido: cortes, zoom que entra e sai, câmera girando de lado, texto sobre a página antes do cartão.
- Para recortes "levantados", use a mesma imagem com \`clip-path: inset(...)\` posicionada exatamente sobre o lugar dela na página.`,
    checklist: [
      "Uma câmera contínua, sem cortes, velocidade constante no voo",
      "Página nítida e legível no começo do voo",
      "2–3 elementos levantam com sombra",
      "Subida termina mostrando a página inteira",
      "Cartão final com a frase da marca e logo",
      "Música bate no cartão; whooshes na subida",
    ],
  },
  {
    id: "stickman",
    name: "Suspense de stickman (cenário 3D)",
    aspect: "9:16",
    length: "30–45 s",
    goodFor: "Prender pela tensão: \"Imagine que você lançou o seu SaaS hoje…\" com dia e hora correndo, regras, uma ameaça que cresce e um final com escolha que enche os comentários.",
    needs: ["a situação do cliente em 3–4 regras e uma virada"],
    guide: `# Suspense de stickman (cenário 3D)
Suspense em segunda pessoa: um boneco de palito 2D (contorno escuro grosso, corpo claro, olhos de ponto, um boné na cor da marca) vive dentro de um cenário 3D low-poly com luz de verdade (three.js no kit: \`kit/three\`). A atmosfera vem da luz: dia quente pela janela, noite fria com a tela e a fresta da porta.

## Estrutura (≈ 35 s)
1. **Gancho (0–3 s):** "Imagine que você…" + HUD com DIA e hora (monoespaçada, canto superior esquerdo). A câmera começa no personagem e abre para o quarto.
2. **Regras (3–12 s):** 3 regras curtas, cada uma num adesivo inclinado (título condensado) e paga na tela (o notebook mostra o post, o preço riscado, o relógio).
3. **Ameaça (12–20 s):** o tempo pula (DIA 7, 14, 30), a luz cai, um número piora (caixa em dias, curtidas em zero).
4. **Virada (20–27 s):** o celular em primeira pessoa vibra; a mensagem faz duas regras colidirem; contagem regressiva.
5. **Escolha (27–33 s):** duas opções ruins (verde e vermelha) + "COMENTA AQUI EMBAIXO" + CTA do perfil.

## Como montar
- O filme inicial já traz o quarto, a câmera por cortes (\`SHOTS\`), o boneco com poses (\`poseAt\`), as telas vivas em canvas (notebook, relógio, calendário) e o acabamento (bloom, vinheta, grão, franja de cor). Troque a história; mantenha a linguagem.
- Uma fala = um plano. Legenda de 1–3 palavras com a palavra-chave na cor da marca.
- Escreva números por extenso no roteiro (para a voz) e em algarismos na tela.
- Efeitos: vibração, coração, tique-taque, "impact" nos adesivos; música escura e sem vocal, baixa.
- Render 3D é mais lento (≈ 25 min para 35 s): confira com \`film_stills\` antes.`,
    checklist: [...CHECK_COMMON, "HUD de dia/hora sempre visível e atualizando", "Cada regra é paga na tela", "Final com escolha em que as duas opções parecem ruins"],
  },
  {
    id: "pixel",
    name: "Jogo em pixel art",
    aspect: "9:16",
    length: "25–35 s",
    goodFor: "Contar o funil como uma fase de videogame: moedas viram seguidores, o chefão é o algoritmo, os poderes são o carrossel e o Reels, e a fase termina na primeira venda. Leve, nostálgico e compartilhável.",
    needs: ["o obstáculo do público (o \"chefão\") e os 2 poderes do produto"],
    guide: `# Jogo em pixel art
Um jogo de plataforma desenhado num canvas de 180x320 em pixels inteiros e ampliado 6x sem suavização (\`image-rendering: pixelated\`), com HUD em fonte pixel (Press Start 2P), céu pontilhado, cidade em paralaxe e scanlines de CRT.

## Estrutura (≈ 30 s)
1. **Gancho:** "FASE 1" + o objetivo, o herói (boné na cor da marca) já correndo.
2. **Coleta:** cada post é uma moeda; o contador de seguidores sobe a cada pulo.
3. **Chefão:** o obstáculo do público com barra de vida; o post bonito quica nele; o herói perde uma vida (tremida de tela).
4. **Poderes:** dois blocos "?" soltam os poderes do produto; juntos viram COMBO (herói dourado, tiros, chefão explode em pixels).
5. **Funil:** placas PERFIL → LINK → VENDA passam e acendem; "FASE COMPLETA!" com fogos; CTA do perfil.

## Como montar
- Tudo em pixels inteiros (\`fillRect\` com coordenadas arredondadas); sprites como linhas de texto com paleta.
- A fonte pixel não tem acentos em maiúsculas: prefira palavras sem acento nos títulos (COMPLETA em vez de CONCLUÍDA).
- Efeitos: moeda, pulo, explosão, dano, power-up, laser, fanfarra; música chiptune.`,
    checklist: [...CHECK_COMMON, "Sprites grandes o bastante para ler no celular", "Cada etapa do funil vira um elemento do jogo"],
  },
  {
    id: "e-se",
    name: "E se… (cenário 2D)",
    aspect: "9:16",
    length: "30–50 s",
    goodFor: "Prender pela curiosidade: \"E se você postasse um carrossel por dia durante um ano?\". Linha do tempo com marcos, contador de tempo e consequências visuais.",
    needs: ["a pergunta \"e se\"", "3–5 marcos plausíveis (sem números inventados)"],
    guide: `# E se… (cenário 2D)
Um cenário 2D chapado (céu, chão, personagem simples) atravessa o tempo: um relógio/contador de dias corre, e cada marco muda o cenário. Termina com a resposta e a pergunta para o público.

## Estrutura (≈ 40 s)
1. **Gancho (0–3 s):** a pergunta na tela, grande, com o contador já correndo ("DIA 1").
2. **Marcos (3–30 s):** 3 a 5 saltos de tempo ("DIA 7", "DIA 30", "DIA 90", "DIA 365"): o contador corre até o marco na palavra falada; o cenário ganha algo novo a cada marco (mais seguidores na calçada, a loja abre, o céu muda do dia para a noite).
3. **Resposta (30–36 s):** a consequência principal, mostrada.
4. **Final (36–40 s):** "E você, começaria hoje?" — pergunta que divide.

## Como montar
- Cenário em camadas com paralaxe (fundo move 0,2x, meio 0,6x, frente 1x da câmera) — tudo em SVG/CSS, formas arredondadas, gradientes suaves.
- Contador: \`CR.count(tl, ".dia", de, até, t, duração, v => "DIA " + Math.round(v))\`.
- Céu: troca de cor com tween de \`background\` (dia → pôr do sol → noite) entre marcos.
- Seja honesto: marcos são possibilidades ("pode acontecer"), não promessas; números só os do usuário.`,
    checklist: [...CHECK_COMMON, "Contador de tempo visível e chegando no marco falado", "Cenário muda a cada marco", "Sem promessa de resultado inventada"],
  },
  {
    id: "kurzgesagt",
    name: "Explainer ilustrado (estilo livro científico)",
    aspect: "9:16",
    length: "40–60 s",
    goodFor: "Explicar um conceito do nicho com ilustração vetorial chapada, cores saturadas em fundo escuro, um mascote e muita profundidade. Autoridade e compartilhamento.",
    needs: ["o conceito em 3 partes"],
    guide: `# Explainer ilustrado (estilo livro científico)
Ilustração vetorial chapada (formas com gradiente suave, contorno grosso arredondado), fundo escuro azul/roxo, cores saturadas, um mascote simples reagindo. A câmera atravessa camadas.

## Estrutura (≈ 50 s)
1. **Gancho (0–3 s):** zoom rápido de muito longe para o objeto do assunto (um planeta, um celular gigante, um cérebro) com a pergunta.
2. **Parte 1 (3–18 s):** o conceito básico, com um diagrama que se monta peça por peça na palavra.
3. **Parte 2 (18–33 s):** o mecanismo (setas animadas, partículas fluindo de A para B, contador).
4. **Parte 3 (33–45 s):** a aplicação para o público (o mascote usando o produto).
5. **Final (45–50 s):** frase curta + CTA, mascote acenando.

## Como montar
- Paleta: fundo \`radial-gradient(#22305e, #0b1026)\`, objetos em azul/ciano/verde/laranja saturados, contorno 8–14 px numa cor mais escura do próprio objeto.
- Profundidade: 3 camadas (estrelas/partículas lentas, objeto principal, primeiro plano rápido). Zooms grandes (\`scale\` 0,2 → 1) com \`power3.inOut\`.
- Partículas: 20–60 círculos com posições de semente fixa (nunca \`Math.random\` sem semente) fluindo com \`stagger\`.
- Mascote: forma simples (blob com olhos), pisca e reage às viradas.`,
    checklist: [...CHECK_COMMON, "Ilustração chapada consistente (mesma paleta e contorno)", "Profundidade com camadas e zoom", "Diagramas se montam na palavra"],
  },
] as VideoFormat[]).map((f) => ({ ...f, guide: `${f.guide}\n${FLOW}` }));

export function formatGuide(id: string) {
  const format = FORMATS.find((f) => f.id === id);
  if (!format)
    throw new Error(`Formato desconhecido. Use um destes: ${FORMATS.map((f) => f.id).join(", ")}.`);
  return { id: format.id, name: format.name, aspect: format.aspect, length: format.length, guide: format.guide, checklist: format.checklist };
}
