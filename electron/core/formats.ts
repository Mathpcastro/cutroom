/**
 * Video formats CutRoom produces from scratch. Each guide is written for the agent that drives
 * CutRoom (in-app chat, Claude Code, Codex): it only uses CutRoom tools, never a terminal.
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

const COMMON = `
## Regras do CutRoom (valem para todo formato)

**Fluxo**
1. \`get_brand\`: use o que a marca vende, para quem, o tom, a oferta e o CTA. Cores = \`palette.accent\` (destaque), \`palette.ink\` (texto/escuro), \`palette.paper\` (claro). Fontes = \`fonts.heading\`/\`fonts.body\` se existirem; senão Montserrat (títulos) e Barlow (texto). Se \`configured:false\`, pergunte ao usuário o essencial (produto, público, oferta) e siga.
2. Roteiro completo primeiro (texto falado), mostre ao usuário e só então gere a voz. Português do Brasil, frases curtas, uma ideia por frase, sem jargão de IA ("revolucionário", "no mundo de hoje", "desbloqueie").
3. \`create_blank_canvas{aspect, duration, color}\` com a duração estimada + 2 s (≈ 2,6 palavras por segundo). A duração final se ajusta depois com \`edit_project trim\`.
4. \`list_voices\` → \`add_voiceover{text, voice, start: 0.3}\`. A resposta traz \`timelineWords\`: o tempo de cada palavra na timeline. **Todo o visual é ancorado nesses tempos.** Gere a voz uma vez só (custa crédito do usuário).
5. Ajuste o canvas: \`edit_project trim{clipId, start:0, end: fim_da_última_palavra + 1.2}\`.
6. Cenas: \`edit_project motion{...}\` em modo \`fullscreen\` (fundo da cena cobre o canvas). Uma cena por bloco do roteiro, 4 a 12 s cada, emendadas sem buraco (start de uma = end da anterior).
7. Música: \`search_music{query, kind:"music"}\` → \`add_music{id, gain:-18, loop:true, fadeOut:1.5}\`. Efeitos: \`search_music{query:"whoosh"|"pop"|"click", kind:"sfx"}\` → \`add_music{id, kind:"sfx", start, gain:-8}\` nos cortes e destaques (no máximo 1 a cada 3 s).
8. Legenda: \`edit_project captions{enabled:true, style:{presetId, position, ...}}\` — ver o formato.
9. \`render_frame{time}\` em 3 a 5 momentos e corrija. Depois \`review_video{format, frames:8}\`: nota de 1 a 10 por item do checklist, corrija tudo abaixo de 8.
10. \`export_video{destination:"videos"}\`. Se responder \`status:"exporting"\`, chame \`job_status\` a cada 30–60 s até o job \`export\` ficar \`completed\` (o \`output\` é o caminho do MP4) e informe o caminho. Render e exportação rodam no computador do usuário: \`render_frame\`/\`review_video\` também podem responder \`status:"rendering"\` — espere e chame de novo, sem editar o projeto no meio. Se usou música CC BY, entregue a linha de crédito que o review mostrou (vai na legenda do post).

**Desenho das cenas (motor HyperFrames)**
- A cena é um fragmento HTML/CSS/SVG + uma lista \`animations\` de tweens GSAP: \`{selector, start, duration, from?, to, ease?}\`. Tempos **locais da cena** (0 = início da cena). Sem script, sem URL, sem CSS animation/transition.
- Canvas de desenho: largura **1920** sempre. Em 9:16 a altura é **3413** (escala para 1080x1920); em 16:9 é 1080. Use \`position:absolute\` e posições em px nesse canvas. Em 9:16 deixe livre a faixa de 2700 a 3150 px (legenda) e não ponha texto importante acima de 300 px nem abaixo de 3200 px (interface do Reels).
- Texto: títulos 140–220 px, texto de apoio 70–100 px em 9:16. Máximo ~6 palavras por card. Contraste forte (ink sobre paper ou paper sobre ink/accent).
- Fontes disponíveis: Barlow (400/700), Montserrat (800), Anton, Oswald, Lora (400, itálico), Caveat. Use \`font-family\` no CSS.
- Logo da marca: \`<img data-asset="logo" style="...">\` (só se \`get_brand\` disser que existe).
- Propriedades animáveis: x, y, xPercent, yPercent, scale, scaleX, scaleY, rotation, skewX, skewY, opacity, autoAlpha, color, backgroundColor, borderColor, borderRadius, width, height, letterSpacing, fontSize, clipPath, filter, transformOrigin, fill, stroke, strokeDasharray, strokeDashoffset. Eases: power1–4 (in/out/inOut), back, sine, expo, linear.
- Entrada E saída: todo elemento que aparece precisa sair (ou a cena termina com ele). Até 800 tweens por cena.
- **Sincronia com a fala:** para destacar a palavra que começa em \`T\` (timeline) numa cena que começa em \`S\`, o tween começa em \`T - S\` (pode antecipar 0,05 s). Cards entram 0,1 s antes da palavra-chave e saem quando a frase seguinte começa.
- Movimento: entradas de 0,25–0,45 s com \`back.out\` ou \`power3.out\`; nada parado mais de 2 s (micro-movimento: scale 1→1.03, y ±8, rotation ±1,5 em \`sine.inOut\`).
`;

const TEACHER_KIT = `
### Kit: professor cartoon (SVG)
\`\`\`html
<svg class="teacher" viewBox="0 0 400 520" style="position:absolute;left:1290px;top:2050px;width:560px;height:728px">
  <g class="t-body">
    <rect x="110" y="300" width="180" height="200" rx="60" fill="INK"/>
    <rect x="160" y="300" width="80" height="70" rx="20" fill="ACCENT"/>
    <g class="t-arm" style="transform-origin:290px 330px"><rect x="280" y="320" width="120" height="34" rx="17" fill="INK"/><circle cx="398" cy="337" r="22" fill="#f2c9a0"/></g>
  </g>
  <g class="t-head" style="transform-origin:200px 290px">
    <circle cx="200" cy="200" r="110" fill="#f2c9a0"/>
    <path d="M95 170 Q200 40 305 170 Q290 100 200 92 Q110 100 95 170Z" fill="INK"/>
    <rect x="128" y="178" width="58" height="40" rx="12" fill="none" stroke="INK" stroke-width="9"/>
    <rect x="214" y="178" width="58" height="40" rx="12" fill="none" stroke="INK" stroke-width="9"/>
    <line x1="186" y1="196" x2="214" y2="196" stroke="INK" stroke-width="8"/>
    <circle class="t-eye" cx="157" cy="198" r="9" fill="INK"/><circle class="t-eye" cx="243" cy="198" r="9" fill="INK"/>
    <path class="t-mouth-closed" d="M165 255 Q200 272 235 255" fill="none" stroke="INK" stroke-width="9" stroke-linecap="round"/>
    <ellipse class="t-mouth-open" cx="200" cy="262" rx="30" ry="20" fill="INK" opacity="0"/>
  </g>
</svg>
\`\`\`
Troque INK/ACCENT pelas cores da marca. **Boca falando:** para cada palavra da narração dentro da cena, dois tweens: \`{selector:".t-mouth-open", start: w.start-S, duration:0.05, to:{opacity:1}}\` e \`{selector:".t-mouth-open", start: w.start-S + clamp(w.end-w.start-0.05, 0.08, 0.22), duration:0.05, to:{opacity:0}}\` (boca fechada fica sempre por baixo). **Não junte palavras**: as vozes entregam palavras coladas umas nas outras e a boca ficaria aberta a frase inteira; o "abre/fecha" por palavra é o que parece fala. **Vida:** cabeça \`rotation\` ±3 a cada ~1,2 s (sine.inOut), braço \`rotation\` -25→0 quando aponta para um card, piscar: \`.t-eye\` scaleY 1→0.1→1 em 0,12 s a cada 3–4 s.
`;

const CARD_KIT = `
### Kit: cards, carimbos e títulos
\`\`\`html
<div class="title" style="position:absolute;left:120px;top:420px;width:1680px;font:800 190px/1.02 Montserrat;color:INK;letter-spacing:-4px">Título curto</div>
<div class="card c1" style="position:absolute;left:140px;top:1000px;width:1640px;padding:70px 80px;border-radius:48px;background:INK;color:PAPER;font:700 96px/1.15 Barlow">Passo 1: ...</div>
<div class="stamp ok" style="position:absolute;left:1500px;top:960px;width:220px;height:220px;border-radius:50%;background:#1faa59;color:#fff;font:800 150px/220px Montserrat;text-align:center;transform:rotate(-12deg)">✓</div>
<div class="stamp no" style="position:absolute;left:1500px;top:960px;width:220px;height:220px;border-radius:50%;background:#e5383b;color:#fff;font:800 150px/220px Montserrat;text-align:center;transform:rotate(-12deg)">✕</div>
<div class="hl" style="position:absolute;left:130px;top:1150px;width:0;height:30px;background:ACCENT;opacity:.85"></div>
\`\`\`
Padrões: card entra \`from:{y:120, opacity:0, scale:.96}\` → \`to:{y:0, opacity:1, scale:1}\` (0,35 s, back.out); carimbo \`from:{scale:2.4, opacity:0, rotation:-30}\` → \`to:{scale:1, opacity:1, rotation:-12}\` (0,22 s, power4.out) + sfx "stamp"/"pop"; sublinhado \`to:{width:900}\` (0,4 s, power2.out) na palavra-chave; número grande conta: troque o texto em cenas curtas ou use 3 divs sobrepostos com opacity.
`;

const STICK_KIT = `
### Kit: boneco de palito (SVG, traço que se desenha)
\`\`\`html
<svg class="hero" viewBox="0 0 300 500" style="position:absolute;left:760px;top:1500px;width:400px;height:667px" fill="none" stroke="INK" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
  <circle class="h-head" cx="150" cy="80" r="55" fill="PAPER"/>
  <g class="h-eyes"><circle cx="130" cy="75" r="6" fill="INK" stroke="none"/><circle cx="170" cy="75" r="6" fill="INK" stroke="none"/></g>
  <path class="h-mouth" d="M130 105 Q150 118 170 105"/>
  <line class="h-spine" x1="150" y1="135" x2="150" y2="310"/>
  <g class="h-armL" style="transform-origin:150px 170px"><line x1="150" y1="170" x2="70" y2="260"/></g>
  <g class="h-armR" style="transform-origin:150px 170px"><line x1="150" y1="170" x2="230" y2="260"/></g>
  <g class="h-legL" style="transform-origin:150px 310px"><line x1="150" y1="310" x2="95" y2="460"/></g>
  <g class="h-legR" style="transform-origin:150px 310px"><line x1="150" y1="310" x2="205" y2="460"/></g>
</svg>
\`\`\`
O mesmo SVG em todas as cenas = o personagem nunca muda. **Desenhar o traço:** \`style="stroke-dasharray:400;stroke-dashoffset:400"\` no elemento e tween \`to:{strokeDashoffset:0}\` (0,5 s). **Andar:** pernas \`rotation\` ±20 alternadas a cada 0,25 s + \`.hero\` x avançando (linear). **Susto:** braços rotation ±120, \`.h-head\` y -20, scale 1.1, efeito "boing". **Pensar:** balão SVG (ellipse + 3 círculos) com o texto dentro, entra com scale 0→1 back.out.
`;

const CURSOR_KIT = `
### Kit: forma que vira interface + cursor
\`\`\`html
<div class="shape" style="position:absolute;left:560px;top:1406px;width:800px;height:600px;border-radius:300px;background:ACCENT;box-shadow:0 40px 120px rgba(0,0,0,.35)"></div>
<div class="ui ui1" style="position:absolute;left:560px;top:1406px;width:800px;height:600px;opacity:0;font:700 72px/1.2 Barlow;color:PAPER;padding:60px"> ... conteúdo do estado 1 ... </div>
<svg class="cursor" viewBox="0 0 40 56" style="position:absolute;left:1500px;top:2400px;width:110px;height:154px"><path d="M2 2 L2 46 L14 35 L22 54 L31 50 L23 32 L38 32 Z" fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round"/></svg>
<div class="click" style="position:absolute;left:1480px;top:2380px;width:80px;height:80px;border-radius:50%;border:8px solid #fff;opacity:0"></div>
\`\`\`
Cada estado: (1) cursor vai até o ponto de clique (\`x/y\`, 0,35 s, power2.inOut); (2) clique: \`.cursor\` scale .85→1 (0,08+0,1 s) e \`.click\` from {scale:.4,opacity:.9} to {scale:1.8,opacity:0} (0,3 s) + sfx "click"; (3) \`.shape\` muda \`width/height/borderRadius/backgroundColor\` para o próximo estado (0,35 s, expo.inOut) e o conteúdo do estado anterior sai (opacity 0, 0,12 s) enquanto o novo entra (opacity/y, 0,2 s, 0,15 s depois). Estados típicos: botão pílula → campo de busca → lista de resultados → card de produto → gráfico subindo → notificação → checkout → "pronto ✓". Mantenha o centro da forma estável para o olho não se perder.
`;

const SPACE_KIT = `
### Kit: explainer estilo "livro ilustrado científico" (sem WebGL)
\`\`\`html
<div class="sky" style="position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,#22305e,#0b1026 70%)"></div>
<svg class="stars" viewBox="0 0 1920 3413" style="position:absolute;inset:0;width:1920px;height:3413px"><g fill="#fff"> <circle cx="120" cy="300" r="4"/> ... 40 a 80 estrelas de 2 a 6 px ... </g></svg>
<svg class="planet" viewBox="0 0 600 600" style="position:absolute;left:660px;top:1100px;width:600px;height:600px">
  <defs><radialGradient id="pg" cx="35%" cy="30%"><stop offset="0" stop-color="#7fd3ff"/><stop offset=".6" stop-color="#2f7bd8"/><stop offset="1" stop-color="#173a7a"/></radialGradient></defs>
  <circle cx="300" cy="300" r="290" fill="url(#pg)"/>
  <path d="M120 220 Q200 160 280 230 T450 260 Q420 330 330 320 T150 330Z" fill="#3fbf6f" opacity=".9"/>
  <circle cx="300" cy="300" r="290" fill="none" stroke="#bfe8ff" stroke-width="14" opacity=".5"/>
</svg>
<svg class="mascot" viewBox="0 0 200 240" style="position:absolute;left:1380px;top:2150px;width:340px;height:408px">
  <ellipse cx="100" cy="150" rx="70" ry="80" fill="#f4f4f8"/><circle cx="100" cy="80" r="62" fill="#f4f4f8"/>
  <rect x="58" y="55" width="84" height="56" rx="26" fill="#1b2a52"/><circle cx="82" cy="80" r="8" fill="#7fd3ff"/><circle cx="118" cy="80" r="8" fill="#7fd3ff"/>
</svg>
\`\`\`
Estilo: formas chapadas com gradiente suave, cores saturadas sobre fundo escuro, linhas grossas arredondadas, muita profundidade por camadas (fundo lento, meio, frente rápida = paralaxe com \`y\` em velocidades diferentes). Câmera: \`scale\`/\`x\`/\`y\` num \`<div class="world">\` que embrulha tudo (zoom lento 1→1.12 ao longo da cena). Rótulos com seta fina e texto curto (Barlow 700, 80 px). Um mascote reage (pula, aponta, se assusta) nas viradas do roteiro. Use números reais e ditos na narração; nunca invente dado.
`;

export const FORMATS: VideoFormat[] = [
  {
    id: "professor",
    name: "Explainer com professor cartoon",
    aspect: "9:16",
    length: "45–60 s",
    goodFor:
      "Explicar como o SaaS resolve um problema em 3 passos, comparar jeito antigo x novo, ensinar um conceito que leva à oferta. Um dos formatos que mais converte.",
    needs: ["voz (ElevenLabs, OpenAI ou local)"],
    guide: `# Explainer com professor cartoon (9:16, 45–60 s)

Uma aula de menos de um minuto: um professor desenhado fala no canto de baixo enquanto títulos, cards e carimbos aparecem **na palavra exata** que está sendo dita.

## Roteiro (120–150 palavras)
1. **Gancho (0–3 s):** uma frase que abre uma lacuna ou contraria o senso comum, ligada à dor do público da marca. Ex.: "Você está perdendo cliente no WhatsApp e nem sabe."
2. **Promessa (3–6 s):** o que a pessoa vai entender. "Em 40 segundos, os 3 níveis de atendimento."
3. **Corpo em 3 blocos** (10–14 s cada): cada bloco = 1 título + 1 card + 1 prova (carimbo ✓/✕, número, mini-diagrama). Nível 1 → 2 → 3, antes → depois, erro → acerto.
4. **Virada (3–5 s):** onde o produto da marca entra, sem exagero.
5. **CTA (3–4 s):** um pedido só (comentar uma palavra, link na bio, seguir). Use o CTA da marca se houver.

## Cenas
- Fundo: \`paper\` liso ou com um quadriculado sutil (linhas 2 px a 6% de opacidade). Professor fixo no canto inferior direito, visível do início ao fim (repita o mesmo SVG em todas as cenas, na mesma posição, para não "pular").
- Topo (300–900 px): título do bloco. Meio (950–2600 px): cards empilhados, um por frase. O professor ocupa ~2050–2780 px à direita; cards à esquerda nessa faixa.
- Uma cena por bloco do roteiro. Na troca de bloco: cards antigos saem para cima (y -80, opacity 0, 0,25 s) e o novo título entra.
- Gestos: braço aponta para o card no instante em que ele entra; cabeça inclina nas perguntas; carimbo com sfx.

${TEACHER_KIT}
${CARD_KIT}

## Áudio
Voz: tom de professor animado, ritmo rápido (OpenAI: instructions "professor empolgado, ritmo rápido, frases curtas"). Música lo-fi ou "upbeat corporate" a -20 dB. Sfx: "pop" em cada card, "stamp" nos carimbos, "whoosh" na troca de bloco.

## Legenda
\`captions{enabled:true, style:{presetId:"keyword-punch" (ou "word-pop"/"highlight-pill"), position:"bottom"}}\`, palavras-chave na cor accent. Se a legenda brigar com os cards, use position "center" só nas cenas sem card no meio — senão mantenha embaixo.
${COMMON}`,
    checklist: [
      "Gancho nos 3 primeiros segundos, ligado à dor do público da marca",
      "Cada card/título entra a no máximo 0,15 s da palavra que ele mostra",
      "A boca do professor abre e fecha com a fala, sem ficar aberta no silêncio",
      "Nenhum texto cortado, sobreposto à legenda ou fora da área segura do Reels",
      "No máximo 6 palavras por card; contraste legível no celular",
      "Cores e fontes da marca; o produto aparece na virada sem promessa exagerada",
      "Música baixa sob a voz; sfx pontuais, não em toda frase",
      "Um único CTA no final",
    ],
  },
  {
    id: "ui-motion",
    name: "UI motion (a forma que vira o seu produto)",
    aspect: "9:16",
    length: "12–20 s",
    goodFor:
      "Mostrar o SaaS em ação de um jeito hipnótico: uma forma se transforma em 8 a 12 telas do produto enquanto um cursor clica, tudo no ritmo de uma música de 120 BPM. Ótimo para anúncio e para o topo do perfil.",
    needs: ["música (search_music)"],
    guide: `# UI motion (9:16, 12–20 s)

Uma forma central se transforma em 8 a 12 "estados" de interface do produto da marca enquanto um cursor clica em cada mudança. Sem narração (ou só um texto final). O corte é na batida da música.

## Antes de desenhar
1. \`get_brand\` e liste com o usuário os 8–12 estados: o fluxo real do produto em telas simples (ex.: botão "Agendar" → calendário → horário escolhido → formulário → confirmação → lembrete no WhatsApp → painel com agenda cheia → "R$ +3.200 este mês"). Use os nomes e números reais que o usuário der.
2. Música: \`search_music{query:"upbeat electronic 120 bpm", kind:"music"}\`. Escolha uma faixa enérgica, \`add_music{id, gain:-6, loop:false, fadeOut:0.6}\` (aqui a música é protagonista: sem voz, sem ducking).
3. Batida: a 120 BPM cada batida dura 0,5 s. Troque de estado a cada 2 batidas (1 s) ou 3 batidas (1,5 s); total = estados × intervalo + 1,5 s de abertura + 2 s de final.

## Cenas
- \`create_blank_canvas{aspect:"9:16", color: paper ou ink da marca}\`. Uma cena \`fullscreen\` por 3–4 estados (até 800 tweens cada), emendadas.
- Forma central sempre no mesmo centro (x≈960, y≈1700 no canvas 1920x3413). Ela muda \`width/height/borderRadius/backgroundColor\` entre estados; o conteúdo de cada estado é um \`<div>\` próprio que entra e sai.
- Cursor branco com contorno, sempre visível, com micro-movimento entre cliques. Cada troca de estado = 1 clique na batida.
- Abertura: a forma nasce de um ponto (scale 0→1, back.out) com o logo (\`<img data-asset="logo">\`) ou o nome da marca. Final: último estado vira o logo + uma frase curta de CTA ("Teste grátis • link na bio" se a marca tiver teste).
- Sombra suave na forma, fundo com um gradiente muito leve. Nada de texto pequeno: cada estado tem no máximo uma linha grande + um elemento de UI.

${CURSOR_KIT}

## Legenda
Desligada (\`captions{enabled:false}\`), o texto está nos estados.
${COMMON}`,
    checklist: [
      "Cada troca de estado cai na batida da música (erro máximo 0,05 s)",
      "8 a 12 estados reais do produto, na ordem do fluxo do usuário",
      "Forma centrada e estável; o olho não se perde entre estados",
      "Cursor sempre visível; cada mudança é causada por um clique",
      "Textos grandes (≥ 80 px) e curtos; nada ilegível no celular",
      "Cores da marca na forma e no final com logo/nome + CTA",
      "Música com licença comercial e volume forte, sem distorcer",
    ],
  },
  {
    id: "e-se",
    name: "Desenho 2D \"E se...?\"",
    aspect: "9:16",
    length: "20–35 s",
    goodFor:
      "Prender atenção com uma pergunta curiosa ligada ao nicho do SaaS (\"E se sua clínica nunca mais faltasse paciente?\"), contada por um boneco de palito que é sempre o mesmo personagem. Topo de funil e seguidores.",
    needs: ["voz (ElevenLabs, OpenAI ou local)"],
    guide: `# Desenho 2D "E se...?" (9:16, 20–35 s)

Uma pergunta "E se...?" respondida em 4 a 6 cenas curtas com um boneco de palito desenhado em código (o mesmo SVG em todas as cenas, então o herói nunca muda), luz de fim de tarde e narração calma.

## Roteiro (60–90 palavras)
1. **Pergunta (0–3 s):** "E se [cenário improvável ligado à dor do público]?"
2. **Consequências em escada (3 a 4 frases):** cada frase piora ou melhora o cenário, com um detalhe concreto e visual.
3. **Virada:** a realidade/solução, onde o produto da marca entra de leve.
4. **Fecho:** frase de efeito curta + CTA simples ("segue para a parte 2").

## Cenas
- Paleta "fim de tarde": céu em degradê (#ffb37a → #ff7a6b → #6b4f9e), sol baixo, chão chapado escuro, silhuetas simples (casa, prédio, mesa, celular) em SVG. O boneco em ink da marca ou quase preto, traço grosso.
- Uma cena por frase. Cada cena: o traço do cenário se desenha (strokeDashoffset) em 0,5 s, o boneco age (anda, aponta, se assusta, comemora) na palavra-chave, um objeto de destaque na cor accent.
- Transição: fade para o céu (opacity) ou o boneco sai andando e entra na cena seguinte pelo lado oposto.
- Texto na tela só para números e palavras-chave (Caveat ou Montserrat, 140 px).

${STICK_KIT}

## Áudio
Voz calma e curiosa (OpenAI: "narrador curioso, calmo, pausas curtas"). Música ambiente suave a -22 dB. Sfx de "pop" quando objetos aparecem e um "whoosh" na virada.

## Legenda
\`captions{enabled:true, style:{presetId:"handwritten" ou "clean-phrase", position:"bottom"}}\`.
${COMMON}`,
    checklist: [
      "A pergunta \"E se...?\" está nos 3 primeiros segundos",
      "O boneco é idêntico em todas as cenas (mesmo SVG, mesmas proporções)",
      "Cada ação do boneco acontece na palavra que a descreve",
      "Cenário legível em silhueta; uma cor de destaque por cena",
      "Nenhum quadro parado por mais de 2 s",
      "Produto da marca aparece de leve na virada, sem virar anúncio",
      "Legenda não cobre o boneco nem o objeto de destaque",
    ],
  },
  {
    id: "ciencia",
    name: "Explainer ilustrado (estilo Kurzgesagt)",
    aspect: "9:16",
    length: "30–45 s",
    goodFor:
      "Explicar um dado, um mecanismo ou um 'e se' grande do mercado do cliente com ilustrações chapadas coloridas, mascote e narração sincronizada. Autoridade e compartilhamento.",
    needs: ["voz (ElevenLabs, OpenAI ou local)"],
    guide: `# Explainer ilustrado estilo Kurzgesagt (9:16, 30–45 s)

Ilustração chapada com gradientes, fundo escuro profundo, um mascote, e a narração explicando um mecanismo passo a passo. Cada frase ganha uma imagem.

## Roteiro (80–120 palavras)
1. **Pergunta grande (0–3 s):** "O que acontece quando [fenômeno do mercado]?"
2. **Contexto (1 frase)** com um número real que o usuário confirmou.
3. **Mecanismo em 3 passos** — causa → efeito → consequência —, cada passo com uma metáfora visual (um funil que vaza, uma engrenagem, um planeta que perde a órbita).
4. **O que fazer:** a resposta prática, onde o produto entra.
5. **Fecho:** frase memorável + CTA.

## Cenas
- \`create_blank_canvas{aspect:"9:16", color:"#0b1026"}\`. Uma cena por passo (5–9 s). Tudo dentro de \`<div class="world">\` para fazer "câmera" (zoom lento e pans).
- 3 camadas de profundidade com velocidades diferentes. Objetos principais grandes (500–900 px), contornos claros, sombras internas com gradiente.
- Mascote (o mesmo em todas as cenas) reage às viradas. Rótulos curtos com seta.
- Transições: zoom para dentro de um objeto que vira a próxima cena (scale 1→6 + opacity) ou corte na batida com whoosh.

${SPACE_KIT}
${CARD_KIT}

## Áudio
Voz de documentário, curiosa e clara. Música "cinematic ambient" ou "documentary" a -20 dB. Sfx suaves (whoosh, shimmer).

## Legenda
\`captions{enabled:true, style:{presetId:"documentary" ou "clean-phrase", position:"bottom", maxWords:5}}\`.
${COMMON}`,
    checklist: [
      "Pergunta grande nos 3 primeiros segundos",
      "Cada frase tem uma imagem que a explica (não só texto)",
      "Números na tela são reais e iguais aos falados",
      "Profundidade: pelo menos 2 camadas se movendo em velocidades diferentes",
      "Mascote idêntico em todas as cenas",
      "Paleta harmônica; destaque na cor da marca",
      "Transições fluidas, sem quadro vazio",
    ],
  },
];

export function formatGuide(id: string) {
  const format = FORMATS.find((f) => f.id === id);
  if (!format)
    throw new Error(`Formato desconhecido. Use um destes: ${FORMATS.map((f) => f.id).join(", ")}.`);
  return { id: format.id, name: format.name, aspect: format.aspect, length: format.length, guide: format.guide, checklist: format.checklist };
}
