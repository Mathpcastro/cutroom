import type { Project } from "./types";

export interface ChatCommandOptions {
  start?: number;
  end?: number;
  text?: string;
  subtitle?: string;
  items?: string[];
  amount?: number;
}
export interface ChatCommandContext {
  time?: number;
  selectedId?: string;
}
export interface ChatCommandDefinition {
  id: string;
  label: string;
  description: string;
  category: string;
  kind: "edit" | "motion" | "system" | "ai";
  needsTranscript?: boolean;
  range?: boolean;
  text?: boolean;
  items?: boolean;
  maxText?: number;
  amount?: {
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
  };
  defaultText?: string;
  defaultSubtitle?: string;
  defaultItems?: string[];
  example: string;
}
const edit = (
  id: string,
  label: string,
  description: string,
  extra: Partial<ChatCommandDefinition> = {},
): ChatCommandDefinition => ({
  id,
  label,
  description,
  category: "Limpeza",
  kind: "edit",
  example: `/${id}`,
  ...extra,
});
const motion = (
  id: string,
  label: string,
  description: string,
  defaultText: string,
  extra: Partial<ChatCommandDefinition> = {},
): ChatCommandDefinition => ({
  id,
  label,
  description,
  defaultText,
  category: "Animações",
  kind: "motion",
  range: true,
  text: true,
  example: `/${id} ${defaultText}`,
  ...extra,
});
export const CHAT_COMMANDS: readonly ChatCommandDefinition[] = [
  edit(
    "edicao-limpa",
    "Edição limpa",
    "Remove pausas e muletas, alterna zooms discretos e normaliza a voz no projeto inteiro.",
    { needsTranscript: true },
  ),
  edit(
    "remover-pausas",
    "Remover pausas",
    "Detecta silêncios reais e corta as pausas, preservando pequenas margens nas falas.",
  ),
  edit(
    "remover-muletas",
    "Remover muletas",
    "Usa a transcrição para cortar né, ah e hesitações reconhecidas. Preserva palavras ambíguas.",
    { needsTranscript: true },
  ),
  edit(
    "transcrever",
    "Transcrever",
    "Gera palavras e tempos no seu PC. Não ativa legendas nem envia o áudio para uma API.",
    { kind: "system", needsTranscript: true },
  ),
  edit(
    "normalizar",
    "Normalizar voz",
    "Equilibra o volume na exportação em −14 LUFS, com medição em duas passagens.",
  ),
  edit(
    "silenciar",
    "Silenciar trecho",
    "Desliga o áudio apenas no intervalo escolhido; o restante do vídeo continua com som.",
    { range: true },
  ),
  edit(
    "soco-pb",
    "Soco P&B",
    "Aplica um zoom de impacto, preto e branco com contraste e até três palavras grandes em sequência.",
    {
      category: "Imagem",
      range: true,
      text: true,
      defaultText: "PARE AGORA OLHE",
      example: "/soco-pb PARE AGORA --inicio 2 --fim 4",
    },
  ),
  edit(
    "modo-cinema",
    "Modo cinema",
    "Coloca barras de cinema, reduz a saturação e exibe uma frase com entrada suave. Mantém sua voz.",
    {
      category: "Imagem",
      range: true,
      text: true,
      defaultText: "Uma ideia muda tudo",
      example: "/modo-cinema Uma ideia muda tudo --inicio 2 --fim 6",
    },
  ),
  motion(
    "cortina-cor",
    "Cortina de cor",
    "Uma linha com brilho atravessa a tela e revela a versão com cor viva sobre o trecho em P&B.",
    "",
    {
      category: "Imagem",
      text: false,
      example: "/cortina-cor --inicio 2 --fim 5",
    },
  ),
  edit(
    "zoom",
    "Zoom pontual",
    "Aproxima o enquadramento somente no intervalo indicado, sem alterar o restante do vídeo.",
    {
      category: "Imagem",
      range: true,
      amount: { label: "Ampliação", min: 1, max: 4, step: 0.05, default: 1.25 },
      example: "/zoom 1.4 --inicio 2 --fim 5",
    },
  ),
  edit(
    "pb",
    "Preto e branco",
    "Remove as cores e aumenta levemente o contraste no trecho escolhido.",
    { category: "Imagem", range: true },
  ),
  edit(
    "cor-viva",
    "Cor viva",
    "Aumenta a saturação e o contraste do trecho sem mudar o áudio.",
    { category: "Imagem", range: true },
  ),
  edit(
    "espelhar",
    "Espelhar imagem",
    "Inverte a imagem horizontalmente no intervalo escolhido.",
    { category: "Imagem", range: true },
  ),
  edit(
    "desfocar",
    "Desfocar trecho",
    "Desfoca o quadro inteiro no intervalo. Útil como fundo para texto; não faz rastreamento de rostos.",
    { category: "Imagem", range: true },
  ),
  edit(
    "vinheta",
    "Vinheta",
    "Escurece suavemente as bordas do quadro para destacar o centro.",
    { category: "Imagem", range: true },
  ),
  motion(
    "titulo",
    "Título animado",
    "Exibe um título com entrada, saída e cor de destaque do projeto.",
    "Sua ideia em movimento",
  ),
  motion(
    "identificacao",
    "Identificação",
    "Mostra um nome e complemento no canto inferior do vídeo.",
    "Seu nome",
    { defaultSubtitle: "Seu trabalho ou assunto" },
  ),
  motion(
    "destaque",
    "Destaque",
    "Destaca uma frase curta sobre a gravação, com alto contraste.",
    "O ponto principal",
  ),
  motion(
    "prompt-digitando",
    "Prompt digitando",
    "Mostra uma conversa que digita seu pedido, um cursor piscando e a confirmação PRONTO. Até 140 caracteres.",
    "Edite meu vídeo",
    {
      maxText: 140,
      example: "/prompt-digitando Crie uma legenda com destaque",
    },
  ),
  motion(
    "lista-check",
    "Lista com checks",
    "Apresenta até seis itens em um cartão e marca cada etapa com um check animado.",
    "Passo a passo",
    {
      items: true,
      defaultItems: ["Planejar", "Gravar", "Publicar"],
      example: "/lista-check Planejar | Gravar | Publicar",
    },
  ),
  motion(
    "etapas",
    "Etapas em tela cheia",
    "Apresenta etapas numeradas em tela cheia enquanto sua voz continua.",
    "Como funciona",
    {
      items: true,
      defaultItems: ["Primeiro passo", "Segundo passo", "Terceiro passo"],
    },
  ),
  motion(
    "diagrama",
    "Diagrama",
    "Conecta até seis conceitos em uma explicação visual em tela cheia.",
    "Da ideia ao resultado",
    { items: true, defaultItems: ["Ideia", "Processo", "Resultado"] },
  ),
  motion(
    "numero",
    "Número em foco",
    "Mostra um número ou dado em tamanho grande com contexto, mantendo a voz.",
    "3 etapas",
    { defaultSubtitle: "Um processo simples" },
  ),
  motion(
    "citacao",
    "Citação",
    "Exibe uma frase em um cartão editorial com aspas e entrada suave.",
    "Uma ideia que merece ficar",
  ),
  motion(
    "cta",
    "Chamada para ação",
    "Adiciona uma chamada curta e um botão visual animado. O botão faz parte do vídeo.",
    "Continue aprendendo",
    { defaultSubtitle: "Inscreva-se no canal" },
  ),
  motion(
    "barra-progresso",
    "Barra de progresso",
    "Desenha uma barra discreta que avança do início ao fim do intervalo.",
    "",
    { text: false, example: "/barra-progresso --inicio 0 --fim 10" },
  ),
  motion(
    "contador",
    "Contagem regressiva",
    "Conta 3, 2, 1 em tela cheia, com transições curtas, sem alterar sua voz.",
    "",
    { text: false, example: "/contador --inicio 0 --fim 3" },
  ),
  edit(
    "timelapse",
    "Time-lapse",
    "Acelera o intervalo para 4× por padrão e silencia esse trecho.",
    {
      category: "Ritmo",
      range: true,
      amount: { label: "Velocidade", min: 2, max: 16, step: 0.5, default: 4 },
      example: "/timelapse 4 --inicio 2 --fim 6",
    },
  ),
  edit(
    "camera-lenta",
    "Câmera lenta",
    "Reduz a velocidade do intervalo para 0,5× por padrão e mantém o áudio ajustado.",
    {
      category: "Ritmo",
      range: true,
      amount: {
        label: "Velocidade",
        min: 0.1,
        max: 0.95,
        step: 0.05,
        default: 0.5,
      },
      example: "/camera-lenta 0.5 --inicio 2 --fim 4",
    },
  ),
  edit(
    "legendar",
    "Legendas limpas",
    "Ativa legendas em frases curtas com o estilo Frase limpa. Transcreve antes se necessário.",
    { category: "Legendas", needsTranscript: true },
  ),
  edit(
    "legenda-karaoke",
    "Legendas karaokê",
    "Ativa legendas que destacam a palavra acompanhando a fala.",
    { category: "Legendas", needsTranscript: true },
  ),
  edit(
    "legenda-palavra",
    "Uma palavra por vez",
    "Ativa o estilo que exibe uma palavra de cada vez no ritmo da fala.",
    { category: "Legendas", needsTranscript: true },
  ),
  edit(
    "sem-legendas",
    "Desativar legendas",
    "Oculta as legendas sem apagar a transcrição nem seus ajustes.",
    { category: "Legendas" },
  ),
  edit(
    "dividir",
    "Dividir no cursor",
    "Divide o clipe na posição atual do cursor, preservando imagem e áudio.",
    { category: "Projeto", kind: "system", example: "/dividir 2.5" },
  ),
  edit(
    "desfazer",
    "Desfazer",
    "Desfaz a última alteração, incluindo todos os ajustes de um comando composto.",
    { category: "Projeto", kind: "system" },
  ),
  edit("refazer", "Refazer", "Recupera a última alteração desfeita.", {
    category: "Projeto",
    kind: "system",
  }),
  edit(
    "exportar",
    "Exportar vídeo",
    "Abre a escolha do arquivo e renderiza o projeto no seu PC, com legendas e efeitos.",
    { category: "Projeto", kind: "system" },
  ),
  motion(
    "animar",
    "Criar com IA",
    "Envia um pedido de animação original ao Codex. Requer conexão e usa os limites da sua conta.",
    "Explique as três etapas do vídeo com uma animação",
    {
      category: "IA",
      kind: "ai",
      example: "/animar Mostre um diagrama quando eu explicar o processo",
    },
  ),
];
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const aliases: Record<string, string> = {
  cinema: "modo-cinema",
  checklist: "lista-check",
  "lista-que-marca": "lista-check",
  transcricao: "transcrever",
  legendas: "legendar",
  "soco-p&b": "soco-pb",
  edicao: "edicao-limpa",
  prompt: "prompt-digitando",
};
export function findChatCommand(id: string) {
  const key = normalize(id.replace(/^\//, ""));
  return CHAT_COMMANDS.find((c) => c.id === (aliases[key] ?? key));
}
export function filterChatCommands(query: string) {
  const key = normalize(query.replace(/^\//, "").trim()),
    tokens = key.split(/\s+/).filter(Boolean),
    alias = aliases[key];
  const rank = (c: ChatCommandDefinition) =>
    c.id === key || c.id === alias
      ? 0
      : c.id.startsWith(key)
        ? 1
        : normalize(c.label).startsWith(key)
          ? 2
          : normalize(`${c.id} ${c.label}`).includes(key)
            ? 3
            : 4;
  return CHAT_COMMANDS.filter(
    (c) =>
      c.id === alias ||
      tokens.every((t) =>
        normalize(`${c.id} ${c.label} ${c.description} ${c.category}`).includes(
          t,
        ),
      ),
  ).sort((a, b) => rank(a) - rank(b));
}
export function commandDefaults(
  command: ChatCommandDefinition,
  project: Project,
  context: ChatCommandContext = {},
): ChatCommandOptions {
  const total = project.clips.reduce(
    (s, c) => s + (c.end - c.start) / c.speed,
    0,
  );
  let offset = 0,
    selected: { start: number; end: number } | undefined,
    current: { start: number; end: number } | undefined;
  const time = Math.max(0, Math.min(total, context.time ?? 0));
  for (const c of project.clips) {
    const end = offset + (c.end - c.start) / c.speed;
    if (c.id === context.selectedId) selected = { start: offset, end };
    if (time >= offset && time < end) current = { start: offset, end };
    offset = end;
  }
  const selectedMotion = project.motions?.find(
    (s) => s.id === context.selectedId,
  );
  const range =
    selected ??
    (selectedMotion
      ? { start: selectedMotion.start, end: selectedMotion.end }
      : undefined) ??
    (["timelapse", "camera-lenta", "silenciar"].includes(command.id)
      ? current
      : undefined);
  const start = range?.start ?? Math.min(time, Math.max(0, total - 0.1)),
    end = range?.end ?? Math.min(total, start + 4);
  return {
    ...(command.range ? { start, end } : {}),
    ...(command.id === "dividir" ? { start: time } : {}),
    ...(command.text
      ? {
          text: command.defaultText ?? "",
          subtitle: command.defaultSubtitle ?? "",
        }
      : {}),
    ...(command.items ? { items: [...(command.defaultItems ?? [])] } : {}),
    ...(command.amount ? { amount: command.amount.default } : {}),
  };
}
export interface ParsedSlashCommand {
  id: string;
  options: ChatCommandOptions;
}
export function parseSlashCommand(value: string): ParsedSlashCommand | null {
  const input = value.trim();
  if (!input.startsWith("/")) return null;
  const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) throw new Error("Escolha um comando na lista após /.");
  const command = findChatCommand(match[1]);
  if (!command)
    throw new Error(
      `Comando /${match[1]} não encontrado. Use + para ver a lista.`,
    );
  const rest = match[2] ?? "",
    tokens: string[] = [];
  let token = "",
    quote = "",
    started = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && rest[i + 1] === quote) token += rest[++i];
      else token += c;
      started = true;
    } else if ((c === '"' || c === "'") && (!started || token.endsWith("="))) {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += c;
      started = true;
    }
  }
  if (quote) throw new Error("Feche as aspas do comando.");
  if (started) tokens.push(token);
  const options: ChatCommandOptions = {},
    body: string[] = [];
  const seen = new Set<string>();
  const names: Record<string, keyof ChatCommandOptions> = {
    inicio: "start",
    de: "start",
    fim: "end",
    ate: "end",
    valor: "amount",
    texto: "text",
    subtitulo: "subtitle",
    itens: "items",
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("--")) {
      body.push(t);
      continue;
    }
    const [flag, ...eq] = t.slice(2).split("=");
    const key = names[normalize(flag)];
    if (!key) throw new Error(`Opção --${flag} desconhecida.`);
    if (seen.has(key)) throw new Error(`Opção --${flag} repetida.`);
    seen.add(key);
    const v = eq.length ? eq.join("=") : tokens[++i];
    if (v === undefined || v.startsWith("--"))
      throw new Error(`Informe o valor de --${flag}.`);
    if (["start", "end", "amount"].includes(key)) {
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n)) throw new Error(`Valor de --${flag} inválido.`);
      (options as Record<string, unknown>)[key] = n;
    } else if (key === "items")
      options.items = v
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
    else (options as Record<string, unknown>)[key] = v;
  }
  const tail = body.join(" ").trim();
  if (tail) {
    if (command.items) {
      if (options.items) throw new Error("Informe a lista apenas uma vez.");
      options.items = tail
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (command.text) {
      if (options.text) throw new Error("Informe o texto apenas uma vez.");
      options.text = tail;
    } else if (command.amount || command.id === "dividir") {
      const n = Number(tail.replace(",", "."));
      if (!Number.isFinite(n))
        throw new Error("Informe um número válido após o comando.");
      const key = command.amount ? "amount" : "start";
      if (options[key] !== undefined)
        throw new Error("Informe o valor apenas uma vez.");
      options[key] = n;
    } else throw new Error("Este comando não aceita texto adicional.");
  }
  if (
    (options.start !== undefined || options.end !== undefined) &&
    !command.range &&
    command.id !== "dividir"
  )
    throw new Error(
      "Este comando é aplicado ao projeto inteiro e não aceita intervalo.",
    );
  if (options.amount !== undefined && !command.amount)
    throw new Error("Este comando não aceita --valor.");
  if (
    (options.text !== undefined || options.subtitle !== undefined) &&
    !command.text
  )
    throw new Error("Este comando não aceita texto.");
  if (options.items !== undefined && !command.items)
    throw new Error("Este comando não aceita lista.");
  return { id: command.id, options };
}

export function prepareChatCommand(
  id: string,
  project: Project,
  options: ChatCommandOptions = {},
  context: ChatCommandContext = {},
) {
  const definition = findChatCommand(id);
  if (!definition)
    throw new Error(
      `Comando /${id} não encontrado. Abra + para ver os comandos.`,
    );
  if (definition.range && !project.clips.length)
    throw new Error(
      "Importe um vídeo para a timeline antes de aplicar este comando.",
    );
  const o = { ...commandDefaults(definition, project, context), ...options };
  if (definition.range) {
    if (
      o.start === undefined ||
      o.end === undefined ||
      !Number.isFinite(o.start) ||
      !Number.isFinite(o.end) ||
      o.start < 0 ||
      o.end >
        project.clips.reduce((sum, c) => sum + (c.end - c.start) / c.speed, 0) +
          0.00001 ||
      o.end - o.start < 0.1 - 0.000001
    )
      throw new Error(
        "Escolha um intervalo de pelo menos 0,1 s dentro da timeline.",
      );
    if (
      (definition.kind === "motion" ||
        ["soco-pb", "modo-cinema", "animar"].includes(definition.id)) &&
      o.end - o.start > 120
    )
      throw new Error("Use até 120 segundos por efeito animado.");
  }
  if (
    definition.amount &&
    (o.amount === undefined ||
      !Number.isFinite(o.amount) ||
      o.amount < definition.amount.min ||
      o.amount > definition.amount.max)
  )
    throw new Error(
      `Use ${definition.amount.label.toLowerCase()} entre ${definition.amount.min} e ${definition.amount.max}.`,
    );
  if (definition.text && !o.text?.trim())
    throw new Error("Escreva o texto para este comando.");
  if (o.text && o.text.length > (definition.maxText ?? 500))
    throw new Error(
      `Use até ${definition.maxText ?? 500} caracteres neste comando.`,
    );
  if (definition.id === "soco-pb" && o.text!.trim().split(/\s+/).length > 3)
    throw new Error("Use até três palavras no Soco P&B.");
  if (
    definition.items &&
    (!o.items?.length ||
      o.items.length > 6 ||
      o.items.some((s) => !s.trim() || s.length > 300))
  )
    throw new Error("Informe de um a seis itens para a lista.");
  if (o.subtitle && o.subtitle.length > 500)
    throw new Error("Use até 500 caracteres no complemento.");
  for (const key of Object.keys(options)) {
    if (
      ["start", "end"].includes(key) &&
      !definition.range &&
      definition.id !== "dividir"
    )
      throw new Error("Este comando não aceita intervalo.");
    if (["text", "subtitle"].includes(key) && !definition.text)
      throw new Error("Este comando não aceita texto.");
    if (key === "items" && !definition.items)
      throw new Error("Este comando não aceita lista.");
    if (key === "amount" && !definition.amount)
      throw new Error("Este comando não aceita um valor numérico.");
  }
  return { definition, options: o };
}
