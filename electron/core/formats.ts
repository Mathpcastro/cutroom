/** Visual directions for new films. The user brief supplies the content. */
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

const STYLE_BRIEF = "O pedido define assunto, objetivo, roteiro, cenas, duração, idioma, personagens e desfecho. Use o preset para orientar arte e movimento. Respeite as escolhas de narração, áudio e avatar. A proporção do formato é um padrão e pode ser alterada pelo pedido.";

export const FORMATS: VideoFormat[] = [
  {
    id: "desenhado",
    name: "Desenhado pela IA (motor de tomadas)",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Qualquer tema em um visual descrito em palavras: pixel art, aquarela, óleo, giz de cera, HQ, guache, filme retrô, vetor ou neon.",
    needs: ["o pedido do usuário"],
    guide: `# Desenhado pela IA (motor de tomadas)

Use \`kit/cutroom-shots.js\` (carregue depois de gsap, timing.js, cutroom-kit.js, cutroom-motion.js e kit/avatar/engine.js):
\`CRS.film({ tl, film: "#film", duration: D, engine: window.AvatarEngine, plan, cast: { "Nome": window.FILM_AVATAR }, captions: true })\`.
- **plan.look:** {"preset": pixel|aquarela|oleo|giz|hq|guache|retro|vetor|neon, "palette": ["#hex"...], "paper", "ink", "accent"}. O motor aplica textura, tremido de animação à mão (12 fps) e acabamento.
- **plan.sets:** [{"id","svg"}]: cenários em SVG com viewBox "0 0 L 1920" (L de 1080 a 2160), camadas <g data-depth="0|0.4|1|1.4"> para paralaxe, sem texto nem imagens. Kit recolorível: <use href="#kit-tree|pine|bush|cloud|sun|moon|mountain|hills|building|house|lamp|desk|laptop|phone|cup|plant|window|door|sofa|wave|rock|bird|star|shelf" style="--a:#hex;--b:#hex;--c:#hex;--d:#hex"/>.
- **plan.props:** [{"id","svg"}] objetos animáveis (base no fundo do viewBox).
- **plan.shots:** [{"say","who","set","camera":{"move": wide|medium|close|push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|dutch|shake|orbit,"focus":[x,y]},"cast":[{"who","x","y","size":"s|m|l|xl","pose","expression","facing","enter"}],"props":[{"id","x","y","scale","motion"}],"fx":["rain"...],"text":{"kind":"title|sign","content"},"transition": cut|fade|wipe|iris|whip|flash|dissolve}]. Cada \`say\` é o trecho falado da tomada; o motor casa as tomadas com as palavras de \`timing.js\`.
Troque de plano a cada frase (8 a 24 tomadas). Confira com \`film_stills\` antes do render.`,
    checklist: ["Cenários desenhados com silhuetas claras e profundidade", "Uma tomada por frase, com planos variados", "Personagens, balões e legendas legíveis"],
  },
  {
    id: "professor",
    name: "Aula com apresentador em pixel art",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Estética de aula ilustrada em pixel art.",
    needs: ["o pedido do usuário"],
    guide: `# Aula com apresentador em pixel art

Use silhuetas legíveis em pixel art e ilustrações que acompanhem o assunto. Se houver apresentador, use gestos e expressões para apontar detalhes e acompanhar a fala.`,
    checklist: ["Pixel art consistente e gestos legíveis quando houver personagem"],
  },
  {
    id: "ui-motion",
    name: "UI motion: o produto funcionando",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Motion gráfico com linguagem de interface.",
    needs: ["o pedido do usuário"],
    guide: `# UI motion: o produto funcionando

Use composição de interface, foco de câmera e transições entre estados. Anime cursores, cards, seleções e destaques conforme a ação. Quando o pedido mostrar um produto real, use as telas fornecidas para representá-lo.`,
    checklist: ["O movimento de interface torna a ação legível"],
  },
  {
    id: "landing-flyover",
    name: "Voo 3D pela landing page",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Câmera com profundidade sobre uma página ou composição em camadas.",
    needs: ["o pedido do usuário"],
    guide: `# Voo 3D pela landing page

Use perspectiva, inclinação e movimentos suaves de câmera para guiar o olhar entre os detalhes da composição. Quando houver uma página real no pedido, use a captura correspondente como superfície.`,
    checklist: ["A perspectiva mantém os detalhes importantes legíveis"],
  },
  {
    id: "historia",
    name: "Historinha em episódios",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Visual de quadrinho animado.",
    needs: ["o pedido do usuário"],
    guide: `# Historinha em episódios

Use enquadramentos expressivos, painéis e transições entre planos. Balões, personagens recorrentes e continuidade visual são recursos disponíveis conforme o pedido.`,
    checklist: ["Composição e continuidade visual acompanham o pedido"],
  },
  {
    id: "avatar",
    name: "Avatar apresentador",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Direção de cena para vídeos com apresentador.",
    needs: ["o pedido do usuário"],
    guide: `# Avatar apresentador

Quando o usuário escolher avatar, use enquadramento, poses e expressões para dar ênfase. Se houver narração, sincronize a boca e os gestos com a voz. Reserve espaço para o assunto da cena e para o texto solicitado.`,
    checklist: ["Enquadramento e gestos deixam o assunto visível"],
  },
  {
    id: "pixel",
    name: "Jogo em pixel art",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Estética de jogo em pixel art.",
    needs: ["o pedido do usuário"],
    guide: `# Jogo em pixel art

Use pixels nítidos, camadas de cenário e animação em poses discretas. HUD, medidores e partículas podem mostrar estados quando forem relevantes para o pedido.`,
    checklist: ["Escala e acabamento dos elementos em pixel art são consistentes"],
  },
  {
    id: "e-se",
    name: "E se… (cenário 2D)",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Ilustração 2D com profundidade e transformações.",
    needs: ["o pedido do usuário"],
    guide: `# E se… (cenário 2D)

Use formas chapadas, camadas em paralaxe e transformações claras de estado. Contadores, linhas e diagramas são recursos para mostrar mudanças quando o pedido precisar deles.`,
    checklist: ["Transformações e camadas ajudam a entender a ação"],
  },
  {
    id: "kurzgesagt",
    name: "Motion UI explicativo",
    aspect: "9:16",
    length: "Definida no pedido",
    goodFor: "Dar acabamento de animação vetorial a qualquer tema, de uma explicação a uma história curta.",
    needs: ["o pedido do usuário"],
    guide: `# Motion UI explicativo

- **Arte:** formas vetoriais, volumes por gradiente suave e paleta saturada com contraste. Use Fredoka em títulos curtos quando combinar com o pedido. Desenhe os objetos e cenários que melhor mostram a ideia da cena.
- **Profundidade:** distribua os elementos entre fundo, assunto e primeiro plano. Use paralaxe para revelar escala, aproximar um detalhe ou guiar o olhar. Acelere e desacelere a câmera com suavidade e interpole o zoom em escala logarítmica.
- **Movimento:** dê ação visual aos beats importantes. Escolha transformação, aproximação, corte, partículas ou contador de acordo com o que precisa aparecer. Use mola amortecida para impactos e entradas curtas, com parcimônia.
- **Sincronia:** quando houver narração, alinhe ações com as palavras reais em \`timing.js\` usando \`CR.at\`. Sem narração, use os tempos do próprio roteiro. Mantenha o desenho determinístico na timeline pausada do filme.
- **Acabamento:** texto curto e legível, entradas por recorte quando úteis, vinheta e grão discretos quando combinarem com a cena. Confira os beats com \`film_stills\` antes do render.`,
    checklist: [
      "Assunto, sequência de cenas e desfecho seguem o pedido",
      "Ilustração consistente, com profundidade e foco claros",
      "Movimentos e transformações ajudam a entender a ação",
      "Beats sincronizados com a narração ou o tempo da cena",
      "Texto legível e composição segura na proporção solicitada",
    ],
  },
];

export function formatGuide(id: string) {
  const format = FORMATS.find((f) => f.id === id);
  if (!format)
    throw new Error(`Formato desconhecido. Use um destes: ${FORMATS.map((f) => f.id).join(", ")}.`);
  return { id: format.id, name: format.name, aspect: format.aspect, length: format.length, guide: `${format.guide}\n\n${STYLE_BRIEF}`, checklist: format.checklist };
}
