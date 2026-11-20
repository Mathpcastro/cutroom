/**
 * Vídeos de vitrine das páginas: 3 canais de formatos diferentes, feitos só pelas ferramentas
 * MCP do Estúdio de Canais, com a voz NARRADOR da Fish Audio, o Whisper local e o HyperFrames.
 *   1. Top Cósmico — exemplo `top10` (ranking com fotos reais da NASA no Commons).
 *   2. E Se Fosse Você — exemplo `e-se` com o avatar do Videosell como personagem fixo.
 *   3. Receita de Vó em 60s — formato escrito do zero, vertical, cartões em código (`custom`).
 *
 *   npx electron-vite build
 *   npx tsx tools/vitrine-formatos.ts <pasta-de-saída> [top,e-se,receita]
 *
 * A chave da Fish vem de FISH_KEY_FILE (padrão ~/.claude/skills/video-use/.env, linha FISH_API_KEY=).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import { durationOf, ffmpeg } from "../electron/core/channel/ffmpeg";
import { JobRunner } from "../electron/core/channel/jobs";
import { motionBrowser, motionPackageInfo } from "../electron/core/motion-package";
import { PackageManager } from "../electron/core/packages";
import { fishSpeech } from "../electron/core/voice";

const out = resolve(process.argv[2] ?? "vitrine-formatos");
const only = new Set((process.argv[3] ?? "top,e-se,receita").split(","));
const packagesRoot = process.env.CUTROOM_PACKAGES ?? join(process.env.APPDATA ?? "", "CutRoom", "packages");
const NARRADOR = "d0a1020822f64d07905bd4f4cb37fba9";
const P = "default";
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function fishKey() {
  const file = process.env.FISH_KEY_FILE ?? join(homedir(), ".claude", "skills", "video-use", ".env");
  const line = (await readFile(file, "utf8")).split(/\r?\n/).find((l) => /^FISH_API_KEY=/i.test(l));
  if (!line) throw new Error("FISH_API_KEY não encontrada.");
  return line.split("=", 2)[1].trim().replace(/^"|"$/g, "");
}

/** Pose of the Videosell example avatar as a crisp PNG (96 px pixel art scaled ×10, transparent). */
async function avatarPng(file: string, pose: string, expression: string) {
  const engine = (await import(pathToFileURL(resolve("resources/avatar-engine/avatar-engine.js")).href)) as { renderAvatarPixels: (a: unknown, s: unknown, v: string) => { width: number; height: number; data: Uint8ClampedArray } };
  const pkg = JSON.parse(await readFile(resolve("resources/avatar-engine/examples/companion.json"), "utf8"));
  const px = engine.renderAvatarPixels(pkg, { pose, expression, mouth: "X", blink: 0, frame: 0 }, "full");
  const raw = `${file}.rgba`;
  await writeFile(raw, Buffer.from(px.data.buffer));
  await ffmpeg(["-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${px.width}x${px.height}`, "-i", raw, "-vf", `scale=${px.width * 10}:${px.height * 10}:flags=neighbor`, "-frames:v", "1", file]);
  return file;
}

async function main() {
  await mkdir(out, { recursive: true });
  const packages = new PackageManager(packagesRoot, resolve("resources"));
  if (!(await motionPackageInfo(packagesRoot)).installed) throw new Error("Pacote Efeitos e animações não instalado.");
  if (!(await packages.list())[0]?.installed) throw new Error("Transcrição local não instalada.");
  const key = await fishKey();
  const cacheDir = join(out, "cache");
  const store = new ChannelStore(out);
  const jobs = new JobRunner(join(out, "jobs"));
  let spentChars = 0;
  const tool = createChannelToolDispatcher({
    store,
    jobs,
    secret: async () => undefined,
    kit: { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") },
    runner: async () => ({ worker: resolve("dist-electron/render-motion.js"), browser: process.env.CHROME_PATH ?? motionBrowser(packagesRoot) }),
    transcriber: async () => async (file, { signal }) => {
      const duration = await durationOf(file);
      const words = await packages.transcribe({ id: `vitrine-${Date.now()}`, name: "n", path: file, duration, width: 1, height: 1, fps: 1, hasAudio: true } as never, cacheDir, () => undefined, signal, true);
      return words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
    },
    // Same call the app makes for a channel whose voice is Fish Audio.
    speaker: async (voice) => async (text, { signal }) => {
      spentChars += text.length;
      return fishSpeech({ apiKey: key, referenceId: voice.voiceId, text, model: "s2-pro", speed: voice.speed, signal });
    },
    waitMs: 30 * 60_000,
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await tool(name, { profileId: P, ...args })) as Record<string, unknown>;
    if (r && r.status === "failed") throw new Error(`${name}: ${r.error}`);
    return r;
  };
  type Issue = { level: string; code: string; beatId?: string; message: string; check?: string };
  const report: Record<string, unknown> = {};
  const voice = { provider: "fish", voiceId: NARRADOR };

  async function produce(key: string, E: { channelId: string; episodeId: string }, beats: unknown[], pkg: Record<string, unknown>, o: { music?: string; shorts?: boolean; imports?: (ids: string[]) => Promise<void> } = {}) {
    const t0 = Date.now();
    const saved = await call("script_save", { ...E, beats, wpm: 175 });
    const review = saved.review as { ok: boolean; issues: Issue[]; stats: unknown };
    log(key, "roteiro", JSON.stringify(review.stats), review.issues.map((i) => `${i.level}:${i.code}${i.check ? `(${i.check})` : ""}`).join(" ") || "sem problemas");
    if (!review.ok) throw new Error(`${key}: revisão com erro: ${review.issues.filter((i) => i.level === "erro").map((i) => `${i.beatId ?? ""} ${i.message}`).join(" | ")}`);
    const script = (await call("script_get", E)) as { beats: { id: string; scene: { query?: string } }[] };
    await o.imports?.(script.beats.map((b) => b.id));
    for (const b of script.beats.filter((x) => x.scene.query)) {
      const found = (await call("media_search", { ...E, beatId: b.id })) as { result?: { candidates: unknown[] } };
      if (found.result?.candidates.length) await call("media_pick", { ...E, beatId: b.id, index: 0 });
      else log(key, "sem foto para", b.id);
    }
    if (o.music) await call("media_music", { ...E, query: o.music, pick: [0] }).catch((e) => log(key, "música:", (e as Error).message));
    await call("episode_approve", { ...E, gate: "script" });
    const narration = await call("narration_generate", { ...E, confirmCost: true });
    log(key, "narração", JSON.stringify(narration.result ?? narration).slice(0, 200));
    const pipe = await call("pipeline_run", { ...E, from: "align", to: "qa", direct: true });
    const qa = (await call("qa_report", E)) as { issues: Issue[]; sheets: string[] };
    log(key, "qa", qa.issues.map((i) => `${i.level}:${i.code}:${i.beatId ?? ""}`).join(" ") || "sem problemas");
    await call("episode_approve", { ...E, gate: "frames" }).catch((e) => log(key, "aprovação dos quadros:", (e as Error).message));
    const render = await call("episode_render", E);
    const pack = await call("package_generate", { ...E, ...pkg });
    const shorts = o.shorts ? await call("shorts_cut", { ...E, count: 1 }).catch((e) => ({ error: (e as Error).message })) : undefined;
    const status = await call("episode_status", E);
    report[key] = { seconds: (Date.now() - t0) / 1000, review: review.stats, warnings: review.issues, pipeline: pipe.result, qa: qa.issues, sheets: qa.sheets, render: render.result, package: pack.result, shorts, status, folder: (status as { folder: string }).folder };
    log(key, "pronto em", Math.round((Date.now() - t0) / 1000), "s", JSON.stringify((status as { outputs?: unknown }).outputs));
  }

  // ---------- 1. Top Cósmico ----------
  if (only.has("top")) {
    const ch = await call("channel_create", { name: "Top Cósmico", handle: "topcosmico", niche: "curiosidades do espaço", format: { extends: "top10", id: "top-espaco", name: "Top do espaço", durationSec: { min: 50, max: 180 } }, voice, voiceSpeed: 0.95 });
    const channelId = ch.id as string;
    await call("channel_update", { channelId, patch: { defaults: { voiceSpeed: 0.95 }, identity: { palette: ["#0B0D17", "#F2F4FF", "#FFC93C", "#FF5A5F", "#4DD8A6"] } } });
    const ep = await call("channel_episode_create", { channelId, title: "3 planetas que parecem mentira" });
    const E = { channelId, episodeId: ep.id as string };
    const nasa = (slug: string, title: string) => ({ url: `https://science.nasa.gov/${slug}/`, publisher: "NASA", title });
    const f = (await call("research_add_facts", { ...E, facts: [
      { claim: "Luas confirmadas de Saturno", value: 274, unit: "luas", dataDate: "2025", source: nasa("saturn/moons", "Saturn Moons") },
      { claim: "Saturno é menos denso que a água", value: "0,69", unit: "g/cm³", dataDate: "2024", source: nasa("saturn/facts", "Saturn Facts") },
      { claim: "Temperatura da superfície de Vênus", value: 464, unit: "graus Celsius", dataDate: "2024", source: nasa("venus/facts", "Venus Facts") },
      { claim: "Um dia em Vênus dura mais que o ano venusiano (243 contra 225 dias terrestres)", value: 243, unit: "dias", dataDate: "2024", source: nasa("venus/facts", "Venus Facts") },
      { claim: "Altura do Monte Olimpo, em Marte", value: 22, unit: "quilômetros", dataDate: "2024", source: nasa("mars/facts", "Mars Facts") },
      { claim: "Largura da base do Monte Olimpo", value: 600, unit: "quilômetros", dataDate: "2024", source: nasa("mars/facts", "Mars Facts") },
    ] })).added as string[];
    const rank = (n: number, title: string, subtitle: string, q: string) => ({ type: "rank", data: { n, title, subtitle }, media: [], query: q });
    const photo = (caption: string, q: string) => ({ type: "photo", data: { caption, move: "in" }, media: [], query: q });
    const title = (lines: string[]) => ({ type: "title", data: { lines: lines.map((text, i) => ({ text, color: i === lines.length - 1 ? "accent" : "ink" })) }, media: [] });
    await produce("top", E, [
      { section: "gancho", text: "Existem planetas aqui do lado que parecem ter saído de um filme de ficção.", scene: title(["Planetas que", "parecem mentira"]) },
      { section: "gancho", text: "E o número um é tão absurdo que vai mudar o jeito que você olha pro céu. Fica até o final.", scene: title(["O número um", "fica para o fim"]) },
      { section: "contagem", text: "Número três: Saturno, o senhor dos anéis.", scene: rank(3, "Saturno", "o senhor dos anéis", "Saturn Cassini") },
      { section: "contagem", text: "Ele tem 274 luas confirmadas, mais do que qualquer outro planeta.", facts: [f[0]], scene: photo("274 luas", "Saturn rings Cassini") },
      { section: "contagem", text: "E é tão leve que, numa banheira gigante, ele boiaria na água.", facts: [f[1]], scene: { type: "title", data: { lines: [{ text: "Ele boiaria" }, { text: "na água", color: "accent" }] }, media: [] } },
      { section: "contagem", text: "Número dois: Vênus, o vizinho que parece um forno.", scene: rank(2, "Vênus", "o forno do Sistema Solar", "Venus planet Magellan") },
      { section: "contagem", text: "A superfície passa de 464 graus, quente o bastante para derreter chumbo.", facts: [f[2]], scene: { type: "stat", data: { value: 464, suffix: " °C", label: "na superfície de Vênus" }, media: [] } },
      { section: "contagem", text: "E um dia por lá dura mais do que o ano inteiro, de tão devagar que ele gira.", facts: [f[3]], scene: photo("1 dia mais longo que 1 ano", "Venus surface Magellan radar") },
      { section: "numero-1", text: "E o número um: Marte, com uma montanha que não caberia na Terra.", scene: rank(1, "Marte", "a montanha que não cabe na Terra", "Olympus Mons Mars") },
      { section: "numero-1", text: "O Monte Olimpo tem 22 quilômetros de altura, quase três vezes o Everest.", facts: [f[4]], scene: photo("22 km de altura", "Olympus Mons Viking orbiter") },
      { section: "numero-1", text: "E a base tem 600 quilômetros de largura. Lá de cima, você nem perceberia que está numa montanha.", facts: [f[5]], scene: { type: "stat", data: { value: 600, suffix: " km", label: "de largura na base" }, media: [] } },
      { section: "pergunta", text: "Qual planeta você colocaria nessa lista? Tem outra lista aqui do lado.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } },
    ], { titles: ["3 planetas que parecem mentira", "O nº 1 tem uma montanha de 22 km", "Planetas que você não sabia que existiam"], thumbs: [{ lines: ["PARECE", "MENTIRA"] }, { lines: ["22 KM", "DE ALTURA"] }, { lines: ["O Nº 1", "É MARTE"] }], intro: "Três planetas do Sistema Solar com números que parecem inventados, do 3º ao 1º.", hashtags: ["espaco", "astronomia", "curiosidades"], tags: ["espaço", "planetas", "saturno", "vênus", "marte", "monte olimpo", "curiosidades", "astronomia", "nasa", "top 3"] }, { music: "space ambient", shorts: true });
  }

  // ---------- 2. E Se Fosse Você (Videosell avatar as the fixed character) ----------
  if (only.has("e-se")) {
    const ch = await call("channel_create", {
      name: "E Se Fosse Você", handle: "esefossevoce", niche: "hipóteses do dia a dia",
      format: { extends: "e-se", id: "e-se-cotidiano", name: "E se… no cotidiano", durationSec: { min: 50, max: 180 }, character: { name: "Zé", description: "brasileiro comum, avatar do Videosell", counters: [{ id: "dia", label: "DIA" }], inventory: true } },
      voice,
    });
    const channelId = ch.id as string;
    await call("channel_update", { channelId, patch: { defaults: { voiceSpeed: 0.95 }, identity: { palette: ["#14213D", "#FFF8EC", "#FFB703", "#EF476F", "#06D6A0"] } } });
    const dir = join(out, "ze");
    await mkdir(dir, { recursive: true });
    const poses = {
      base: await avatarPng(join(dir, "ze-base.png"), "neutral", "neutral"),
      think: await avatarPng(join(dir, "ze-think.png"), "neutral", "thinking"),
      shock: await avatarPng(join(dir, "ze-shock.png"), "surprised", "surprised"),
      happy: await avatarPng(join(dir, "ze-happy.png"), "celebrating", "happy"),
      talk: await avatarPng(join(dir, "ze-talk.png"), "explaining", "confident"),
    };
    await call("channel_character_set", { channelId, path: poses.base, name: "Zé" });
    const ep = await call("channel_episode_create", { channelId, title: "E se você ficasse 30 dias sem internet?" });
    const E = { channelId, episodeId: ep.id as string };
    const f = (await call("research_add_facts", { ...E, facts: [
      { claim: "Domicílios brasileiros com acesso à internet", value: 92.5, unit: "%", dataDate: "2023", source: { url: "https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/41024-internet-chega-a-92-5-dos-domicilios-do-pais", publisher: "IBGE", title: "PNAD Contínua TIC 2023" } },
    ] })).added as string[];
    const zed = (pose: string, data: Record<string, unknown>) => ({ type: "character", data: { pose, ...data }, media: [] });
    const look: Record<string, keyof typeof poses> = {};
    const beats = [
      { section: "premissa", text: "E se você ficasse trinta dias sem internet? Sem celular, sem série, sem nada.", scene: zed("think", { backdrop: "quarto", line: "Trinta dias offline?" }), _pose: "think" },
      { section: "premissa", text: "Dia um. O Zé desligou o roteador e guardou o celular numa gaveta.", scene: { type: "counter", data: { backdrop: "sala", counter: "dia", value: 1, note: "roteador desligado", items: [{ text: "celular", delta: "-" }, { text: "livro", delta: "+" }] }, media: [] } },
      { section: "dias", text: "No terceiro dia, ele já tinha procurado o celular no bolso umas vinte vezes.", scene: zed("shock", { backdrop: "rua", counter: { value: 3 } }), _pose: "shock" },
      { section: "dias", text: "Na primeira semana, ele redescobriu o rádio, o jornal de papel e a vizinha do lado.", scene: { type: "counter", data: { backdrop: "cozinha", counter: "dia", from: 3, value: 7, items: [{ text: "rádio", delta: "+" }, { text: "jornal", delta: "+" }, { text: "vizinha", delta: "+" }] }, media: [] } },
      { section: "dias", text: "Comenta aí: você aguentaria quantos dias?", cta: "comment", scene: { type: "cta", data: { kind: "comment", examples: ["dois dias", "uma semana", "nem uma hora"] }, media: [] } },
      { section: "dias", text: "No dia quinze, ele dormia mais cedo, acordava sem alarme e já tinha lido dois livros.", scene: zed("happy", { backdrop: "parque", line: "Dois livros!", counter: { value: 15 } }), _pose: "happy" },
      { section: "dias", text: "No dia vinte, ele aprendeu a fazer pão vendo a vizinha, sem tutorial nenhum.", scene: { type: "counter", data: { backdrop: "cozinha", counter: "dia", from: 15, value: 20, note: "pão caseiro, sem tutorial", items: [{ text: "pão", delta: "+" }, { text: "tutorial", delta: "-" }] }, media: [] } },
      { section: "fato-real", text: "E olha que o Zé é exceção: 92,5% das casas brasileiras têm internet.", facts: [f[0]], scene: { type: "stat", data: { value: 92.5, decimals: 1, suffix: "%", label: "das casas têm internet (IBGE)" }, media: [] } },
      { section: "fato-real", text: "Ou seja, ficar offline hoje é quase como mudar de país sem sair de casa.", scene: zed("talk", { backdrop: "campo", line: "Mudei de país?" }), _pose: "talk" },
      { section: "reviravolta", text: "No dia trinta, ele ligou o celular esperando cem mensagens. E descobriu que ninguém tinha percebido que ele sumiu.", scene: zed("shock", { backdrop: "noite", line: "Ninguém notou?", counter: { value: 30 }, twist: true }), _pose: "shock" },
      { section: "pergunta", text: "E você, teria coragem? Tem outro e se aqui do lado.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } },
    ];
    beats.forEach((b, i) => {
      if ((b as { _pose?: string })._pose) look[String(i)] = (b as { _pose: keyof typeof poses })._pose;
      delete (b as { _pose?: string })._pose;
    });
    await produce("e-se", E, beats, { titles: ["E se você ficasse 30 dias sem internet?", "30 dias offline: o que acontece", "Ninguém percebeu que eu sumi"], thumbs: [{ lines: ["30 DIAS", "SEM INTERNET"] }, { lines: ["NINGUÉM", "PERCEBEU"] }, { lines: ["E SE", "FOSSE VOCÊ?"] }], intro: "O Zé desligou a internet por 30 dias. O final ninguém esperava.", hashtags: ["ese", "desafio", "internet"], tags: ["e se", "sem internet", "desafio", "30 dias", "curiosidades", "hipótese", "cotidiano", "detox digital", "internet no brasil", "ibge"] }, {
      music: "playful ukulele",
      shorts: true,
      // Each character beat gets the avatar pose that matches it (media_import, license "user").
      imports: async (ids) => {
        for (const [i, pose] of Object.entries(look)) await call("media_import", { ...E, file: poses[pose], kind: "photo", beatId: ids[Number(i)], author: "Avatar do Videosell" });
      },
    });
  }

  // ---------- 3. Receita de Vó em 60s (format written from scratch, vertical) ----------
  if (only.has("receita")) {
    // Steaming mug drawn in SVG for the hook card (the agent draws what the niche needs).
    const MUG = `<svg class="mug" viewBox="0 0 300 300"><path class="st" d="M110 70 q-18 -24 0 -48" /><path class="st" d="M150 70 q-18 -24 0 -48" /><path class="st" d="M190 70 q-18 -24 0 -48" /><rect x="60" y="90" width="170" height="170" rx="26" fill="#E2552B"/><rect x="60" y="90" width="170" height="36" rx="18" fill="#7A3B1E"/><path d="M230 130 h26 a34 34 0 0 1 0 68 h-26" fill="none" stroke="#E2552B" stroke-width="22"/><rect x="92" y="160" width="106" height="18" rx="9" fill="#FFF4E2" opacity=".85"/></svg>`;
    const card = (num: string, title: string, sub: string, art = "") => ({
      type: "custom",
      source: "custom",
      media: [],
      data: {
        html: `<div class="bg"></div>${art ? "" : `<div class="big">${num}</div>`}${art}<div class="card"><div class="ic">${num}</div><h1 id="t">${title}</h1><p id="s">${sub}</p></div>`,
        css: `.bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,#6B4430 0%,#2A1A10 72%);}.bg::after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,244,226,.07) 4px,transparent 4px);background-size:64px 64px}.big{position:absolute;left:0;right:0;top:250px;text-align:center;font:520px/1 "D";color:rgba(255,244,226,.06)}.mug{position:absolute;left:50%;top:330px;width:380px;height:380px;transform:translateX(-50%)}.mug .st{fill:none;stroke:#FFF4E2;stroke-width:10;stroke-linecap:round;opacity:.7}.card{position:absolute;left:80px;right:80px;top:${art ? 760 : 700}px;padding:70px 60px 80px;border-radius:52px;background:#FFF4E2;color:#3B2416;box-shadow:0 30px 90px rgba(0,0,0,.45);text-align:center}.card .ic{display:inline-block;min-width:150px;padding:10px 34px;border-radius:999px;background:#E2552B;color:#FFF4E2;font:110px/1.05 "D"}.card h1{font:118px/1 "D";margin:36px 0 24px;text-transform:uppercase}.card p{font:600 54px/1.2 "B";opacity:.85}`,
        js: `if (document.querySelector(".big")) tl.from(".big", {autoAlpha:0, scale:1.3, duration:0.6, ease:"power2.out"}, 0); tl.from(".card", {autoAlpha:0, y:160, rotation:-5, duration:0.55, ease:"back.out(1.6)"}, 0.03); tl.from(".ic", {scale:0, duration:0.35, ease:"back.out(2.4)"}, 0.3); tl.from("#t", {autoAlpha:0, y:40, duration:0.4, ease:"power3.out"}, 0.42); tl.from("#s", {autoAlpha:0, y:30, duration:0.35}, 0.62); tl.to(".card", {y:-14, duration:1.6, ease:"sine.inOut", yoyo:true, repeat:3}, 0.9); if (document.querySelector(".mug")) { tl.from(".mug", {autoAlpha:0, y:-80, duration:0.5, ease:"back.out(1.8)"}, 0.1); tl.to(".mug .st", {y:-16, opacity:0.2, duration:1.2, stagger:0.25, repeat:3, yoyo:true, ease:"sine.inOut"}, 0.6); }`,
        texts: [num],
      },
    });
    const ch = await call("channel_create", {
      name: "Receita de Vó em 60s", handle: "receitadevo60s", niche: "receitas caseiras rápidas", voice,
      format: {
        id: "receita-60s", name: "Receita de vó em 60 s", description: "Receita caseira em menos de um minuto, vertical, com cartões animados em código.",
        aspect: "9:16", durationSec: { min: 35, max: 90 },
        scenes: ["custom", "title", "photo", "cta"],
        imagery: { sources: ["custom", "foto-real"], notes: "cartões feitos em código; foto real do prato no fim" },
        research: "livre",
        structure: [
          { id: "gancho", title: "Gancho", targetSec: 6, mustHave: "o prato e por que é de vó" },
          { id: "ingredientes", title: "Ingredientes", targetSec: 15, mustHave: "3 a 5 ingredientes" },
          { id: "passo", title: "Passo a passo", targetSec: 22, mustHave: "3 passos curtos" },
          { id: "final", title: "Final", targetSec: 8, mustHave: "o prato pronto e a chamada para salvar" },
        ],
        hookRules: ["1ª frase com até 12 palavras"],
        ctaPlan: [{ kind: "like", at: "end", line: "Salva para fazer no fim de semana." }],
        thumbStyle: { layout: "foto+frase", maxWords: 4, palette: [] },
        checklist: [
          { id: "primeira-frase", kind: "first-sentence-words", params: { max: 12 } },
          { id: "cartoes", kind: "image-share", params: { sources: ["custom", "foto-real"], min: 0.6 } },
          { id: "passos", kind: "section-required", params: { section: "passo" } },
          { id: "uma-chamada", kind: "max-ctas", params: { max: 1 } },
        ],
        rubric: ["O cartão lê em 1 segundo?", "O prato pronto aparece no final?"],
        writingRules: ["Tom de vó carinhosa, frases curtas.", "Cada fala é um cartão: número, título e uma linha."],
      },
    });
    const channelId = ch.id as string;
    await call("channel_update", { channelId, patch: { defaults: { voiceSpeed: 0.95 }, identity: { palette: ["#2A1A10", "#FFF4E2", "#E2552B", "#FF4D4D", "#36D399"] } } });
    const ep = await call("channel_episode_create", { channelId, title: "Bolo de caneca da vó" });
    const E = { channelId, episodeId: ep.id as string };
    await produce("receita", E, [
      { section: "gancho", text: "O bolo de caneca que a vó fazia em dois minutos. Fofinho, quentinho e com cheiro de domingo.", scene: card("VÓ", "Bolo de caneca", "receita da vó em 2 minutos", MUG) },
      { section: "ingredientes", text: "Você vai precisar de um ovo, quatro colheres de leite e quatro de açúcar.", scene: card("1", "Ovo, leite e açúcar", "4 colheres de cada") },
      { section: "ingredientes", text: "Mais três colheres de farinha, duas de chocolate em pó e uma pitada de fermento.", scene: card("2", "Farinha e chocolate", "e uma pitada de fermento") },
      { section: "passo", text: "Misture tudo na própria caneca com um garfo, até a massa ficar lisinha.", scene: card("3", "Misture na caneca", "com um garfo, até ficar liso") },
      { section: "passo", text: "Leve ao micro-ondas por dois minutos, sem deixar passar do ponto.", scene: card("4", "Micro-ondas", "2 minutos, potência alta") },
      { section: "passo", text: "Espere esfriar um pouquinho antes de comer, que a caneca esquenta.", scene: card("5", "Espere esfriar", "a caneca fica quente") },
      { section: "passo", text: "Segredo da vó: antes de ir ao micro-ondas, afunde uma colher de doce de leite no meio da massa.", scene: card("6", "Segredo da vó", "doce de leite no meio") },
      { section: "final", text: "Pronto, o bolo da vó. Salva esse vídeo para fazer no fim de semana.", cta: "like", scene: { type: "cta", data: { kind: "like" }, media: [] } },
    ], { titles: ["Bolo de caneca da vó em 2 minutos", "O bolo de micro-ondas mais fácil", "Receita de vó: bolo de caneca"], thumbs: [{ lines: ["BOLO EM", "2 MINUTOS"] }, { lines: ["RECEITA", "DA VÓ"] }, { lines: ["SÓ UMA", "CANECA"] }], intro: "Bolo de caneca de chocolate em dois minutos, do jeito que a vó fazia.", hashtags: ["receita", "bolodecaneca", "receitadevo"], tags: ["bolo de caneca", "receita de vó", "micro-ondas", "bolo rápido", "chocolate", "receita fácil", "doce", "receitas", "cozinha", "lanche"] }, { music: "warm acoustic guitar" });
  }

  report.fishCharacters = spentChars;
  await writeFile(join(out, `vitrine-${[...only].join("-")}.json`), JSON.stringify(report, null, 2));
  log("pronto; caracteres na Fish:", spentChars);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
