/**
 * E2E real dos formatos do Estúdio de Canais, só pelas ferramentas MCP (como o Claude Code faria):
 * cria 3 canais com formatos diferentes e faz um episódio curto de cada um, até o pacote.
 *   1. Top 3 do espaço — a partir do exemplo `top10` (cenas rank + fotos reais do Commons).
 *   2. "E se…" — a partir do exemplo `e-se` (personagem fixo, contador de dias, inventário, reviravolta).
 *   3. Receitas de vó em 60 s — formato escrito do zero, vertical, com cenas `custom` (HTML/GSAP).
 *
 *   npx electron-vite build
 *   npx tsx tools/e2e-formatos.ts <pasta-de-saída>
 *
 * Usa a voz do Windows, o Whisper local e o HyperFrames do app (CUTROOM_PACKAGES).
 * Grava <saída>/e2e-formatos.json com o resultado de cada canal.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import { durationOf } from "../electron/core/channel/ffmpeg";
import { JobRunner } from "../electron/core/channel/jobs";
import { localSpeech } from "../electron/core/local-voice";
import { motionBrowser, motionPackageInfo } from "../electron/core/motion-package";
import { PackageManager } from "../electron/core/packages";

const out = resolve(process.argv[2] ?? "e2e-formatos");
const packagesRoot = process.env.CUTROOM_PACKAGES ?? join(process.env.APPDATA ?? "", "CutRoom", "packages");
const P = "default";
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** A simple cartoon character drawn in SVG, saved as a transparent PNG (stands in for an avatar render). */
async function drawCharacter(file: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 640" width="400" height="640">
  <ellipse cx="200" cy="625" rx="120" ry="12" fill="rgba(0,0,0,.25)"/>
  <rect x="140" y="420" width="44" height="190" rx="20" fill="#2B3A67"/><rect x="216" y="420" width="44" height="190" rx="20" fill="#2B3A67"/>
  <rect x="110" y="250" width="180" height="200" rx="60" fill="#FF7A3D"/>
  <rect x="70" y="270" width="44" height="150" rx="22" fill="#FF7A3D" transform="rotate(12 92 270)"/><rect x="286" y="270" width="44" height="150" rx="22" fill="#FF7A3D" transform="rotate(-12 308 270)"/>
  <circle cx="200" cy="160" r="105" fill="#F2C29B"/>
  <path d="M95 150 Q100 50 200 48 Q300 50 305 150 Q280 95 200 92 Q120 95 95 150Z" fill="#3B2416"/>
  <circle cx="160" cy="165" r="15" fill="#fff"/><circle cx="240" cy="165" r="15" fill="#fff"/>
  <circle cx="163" cy="168" r="8" fill="#111"/><circle cx="243" cy="168" r="8" fill="#111"/>
  <path d="M160 215 Q200 245 240 215" stroke="#7A2E1E" stroke-width="9" fill="none" stroke-linecap="round"/>
</svg>`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? motionBrowser(packagesRoot), headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 640 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: file as `${string}.png`, omitBackground: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(out, { recursive: true });
  const packages = new PackageManager(packagesRoot, resolve("resources"));
  if (!(await motionPackageInfo(packagesRoot)).installed) throw new Error("Pacote Efeitos e animações não instalado.");
  if (!(await packages.list())[0]?.installed) throw new Error("Transcrição local não instalada.");
  const cacheDir = join(out, "cache");
  const store = new ChannelStore(out);
  const jobs = new JobRunner(join(out, "jobs"));
  const tool = createChannelToolDispatcher({
    store,
    jobs,
    secret: async () => undefined,
    kit: { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") },
    runner: async () => ({ worker: resolve("dist-electron/render-motion.js"), browser: process.env.CHROME_PATH ?? motionBrowser(packagesRoot) }),
    transcriber: async () => async (file, { signal }) => {
      const duration = await durationOf(file);
      const words = await packages.transcribe({ id: `e2e-${Date.now()}`, name: "n", path: file, duration, width: 1, height: 1, fps: 1, hasAudio: true } as never, cacheDir, () => undefined, signal, true);
      return words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
    },
    speaker: async () => async (text, { signal }) => {
      const dir = join(out, "voice");
      await mkdir(dir, { recursive: true });
      return localSpeech(text, undefined, signal ?? new AbortController().signal, dir, (p) => durationOf(p));
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

  /** Runs one episode from the saved script to the package; picks Commons photos for beats with a query. */
  async function produce(key: string, E: { channelId: string; episodeId: string }, beats: unknown[], pkg: Record<string, unknown>, music?: string) {
    const t0 = Date.now();
    const saved = await call("script_save", { ...E, beats });
    const review = saved.review as { ok: boolean; issues: Issue[]; stats: unknown };
    log(key, "roteiro", JSON.stringify(review.stats), review.issues.map((i) => `${i.level}:${i.code}${i.check ? `(${i.check})` : ""}`).join(" ") || "sem problemas");
    if (!review.ok) throw new Error(`${key}: revisão com erro: ${review.issues.filter((i) => i.level === "erro").map((i) => i.message).join(" | ")}`);
    const script = (await call("script_get", E)) as { beats: { id: string; scene: { query?: string } }[] };
    for (const b of script.beats.filter((x) => x.scene.query)) {
      const found = (await call("media_search", { ...E, beatId: b.id })) as { result?: { candidates: unknown[] } };
      if (found.result?.candidates.length) await call("media_pick", { ...E, beatId: b.id, index: 0 });
      else log(key, "sem foto para", b.id);
    }
    if (music) await call("media_music", { ...E, query: music, pick: [0] }).catch((e) => log(key, "música:", (e as Error).message));
    await call("episode_approve", { ...E, gate: "script" });
    const pipe = await call("pipeline_run", { ...E, from: "narration", to: "qa", direct: true });
    const qa = (await call("qa_report", E)) as { issues: Issue[]; sheets: string[] };
    log(key, "qa", qa.issues.map((i) => `${i.level}:${i.code}:${i.beatId ?? ""}`).join(" ") || "sem problemas");
    await call("episode_approve", { ...E, gate: "frames" }).catch((e) => log(key, "aprovação dos quadros:", (e as Error).message));
    const render = await call("episode_render", E);
    const pack = await call("package_generate", { ...E, ...pkg });
    const status = await call("episode_status", E);
    report[key] = { seconds: (Date.now() - t0) / 1000, review: review.stats, warnings: review.issues, pipeline: pipe.result, qa: qa.issues, sheets: qa.sheets, render: render.result, package: pack.result, status };
    log(key, "pronto em", Math.round((Date.now() - t0) / 1000), "s", JSON.stringify((status as { outputs?: unknown }).outputs));
  }

  const formats = (await call("format_templates")) as unknown as { id: string }[];
  log("exemplos de formato:", formats.map((f) => f.id).join(", "));

  // ---------- 1. Top 3 do espaço (extends top10) ----------
  {
    const ch = await call("channel_create", {
      name: "Top Cósmico", handle: "topcosmico", niche: "curiosidades do espaço",
      format: { extends: "top10", id: "top-espaco", name: "Top do espaço", durationSec: { min: 30, max: 180 } },
      voice: { provider: "local", voiceId: "" },
    });
    const channelId = ch.id as string;
    const ep = await call("channel_episode_create", { channelId, title: "3 planetas que parecem mentira" });
    const E = { channelId, episodeId: ep.id as string };
    const f = (await call("research_add_facts", { ...E, facts: [
      { claim: "Número de luas confirmadas de Saturno", value: 274, unit: "luas", dataDate: "2025", source: { url: "https://science.nasa.gov/saturn/moons/", publisher: "NASA", title: "Saturn Moons" } },
      { claim: "Temperatura média da superfície de Vênus", value: 464, unit: "graus Celsius", dataDate: "2024", source: { url: "https://science.nasa.gov/venus/facts/", publisher: "NASA", title: "Venus Facts" } },
      { claim: "Altura do Monte Olimpo, em Marte", value: 22, unit: "quilômetros", dataDate: "2024", source: { url: "https://science.nasa.gov/mars/facts/", publisher: "NASA", title: "Mars Facts" } },
    ] })).added as string[];
    const rank = (n: number, title: string, q: string) => ({ type: "rank", data: { n, title }, media: [], query: q });
    const title = (lines: string[]) => ({ type: "title", data: { lines: lines.map((text, i) => ({ text, color: i === lines.length - 1 ? "accent" : "ink" })) }, media: [] });
    await produce("top", E, [
      { section: "gancho", text: "Existem planetas no nosso Sistema Solar que parecem inventados por um roteirista de ficção.", scene: title(["Planetas que", "parecem mentira"]) },
      { section: "gancho", text: "O número um vai mudar o jeito que você olha o céu. Fica até o final.", scene: title(["O número um", "fica para o fim"]) },
      { section: "contagem", text: "Número três: Saturno, o planeta dos anéis.", scene: rank(3, "Saturno", "Saturn Cassini") },
      { section: "contagem", text: "Ele tem 274 luas confirmadas, mais do que qualquer outro planeta.", facts: [f[0]], scene: { type: "photo", data: { caption: "274 luas" }, media: [], query: "Saturn rings Cassini" } },
      { section: "contagem", text: "Número dois: Vênus, o vizinho que parece um forno.", scene: rank(2, "Vênus", "Venus planet Magellan") },
      { section: "contagem", text: "A superfície passa de 464 graus, quente o bastante para derreter chumbo.", facts: [f[1]], scene: { type: "stat", data: { value: 464, suffix: " °C", label: "na superfície de Vênus" }, media: [] } },
      { section: "numero-1", text: "E o número um: Marte, o planeta vermelho.", scene: rank(1, "Marte", "Olympus Mons Mars") },
      { section: "numero-1", text: "O Monte Olimpo tem 22 quilômetros de altura, quase três vezes o Everest.", facts: [f[2]], scene: { type: "photo", data: { caption: "22 km de altura" }, media: [], query: "Olympus Mons Viking" } },
      { section: "pergunta", text: "Qual planeta faltou na lista? Tem outra lista aqui do lado.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } },
    ], { titles: ["3 planetas que parecem mentira", "O nº 1 tem um monte de 22 km", "Planetas que você não conhecia"], thumbs: [{ lines: ["PARECE", "MENTIRA"] }, { lines: ["22 KM", "DE ALTURA"] }, { lines: ["O Nº 1", "É MARTE"] }], intro: "Três planetas do Sistema Solar com números que parecem inventados.", hashtags: ["espaco", "astronomia", "curiosidades"], tags: ["espaço", "planetas", "saturno", "vênus", "marte", "monte olimpo", "curiosidades", "astronomia", "nasa", "top 3"] }, "space ambient");
  }

  // ---------- 2. "E se…" (extends e-se, fixed character) ----------
  {
    const ch = await call("channel_create", {
      name: "E Se Fosse Você", handle: "esefossevoce", niche: "hipóteses do dia a dia",
      format: { extends: "e-se", id: "e-se-cotidiano", name: "E se… no cotidiano", durationSec: { min: 30, max: 180 }, character: { name: "Zé", description: "brasileiro comum", counters: [{ id: "dia", label: "DIA" }], inventory: true } },
      voice: { provider: "local", voiceId: "" },
    });
    const channelId = ch.id as string;
    const png = join(out, "ze.png");
    await drawCharacter(png);
    await call("channel_character_set", { channelId, path: png, name: "Zé" });
    const ep = await call("channel_episode_create", { channelId, title: "E se você ficasse 30 dias sem internet?" });
    const E = { channelId, episodeId: ep.id as string };
    const f = (await call("research_add_facts", { ...E, facts: [
      { claim: "Domicílios brasileiros com acesso à internet", value: 92.5, unit: "%", dataDate: "2023", source: { url: "https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/41024-internet-chega-a-92-5-dos-domicilios-do-pais", publisher: "IBGE", title: "PNAD Contínua TIC 2023" } },
    ] })).added as string[];
    const zed = (data: Record<string, unknown>) => ({ type: "character", data, media: [] });
    await produce("e-se", E, [
      { section: "premissa", text: "E se você ficasse trinta dias sem internet?", scene: zed({ pose: "think", line: "Trinta dias offline?" }) },
      { section: "premissa", text: "No primeiro dia, ele desligou tudo e guardou o celular na gaveta.", scene: { type: "counter", data: { counter: "dia", value: 1, note: "Wi-Fi desligado", items: [{ text: "celular", delta: "-" }, { text: "livro", delta: "+" }] }, media: [] } },
      { section: "dias", text: "No terceiro dia, ele já tinha checado o bolso vinte vezes procurando o celular.", scene: zed({ pose: "shock", counter: { value: 3 } }) },
      { section: "dias", text: "Na primeira semana, o Zé redescobriu o rádio e o jornal de papel.", scene: { type: "counter", data: { counter: "dia", from: 3, value: 7, items: [{ text: "rádio", delta: "+" }, { text: "jornal", delta: "+" }] }, media: [] } },
      { section: "dias", text: "Comenta aí: você aguentaria quantos dias?", cta: "comment", scene: { type: "cta", data: { kind: "comment", examples: ["2 dias", "1 semana", "nem 1 hora"] }, media: [] } },
      { section: "dias", text: "No dia quinze, ele dormia mais cedo e terminou dois livros.", scene: zed({ pose: "happy", line: "Dois livros!", counter: { value: 15 } }) },
      { section: "fato-real", text: "E olha que o Zé é exceção: 92,5% das casas brasileiras têm internet.", facts: [f[0]], scene: { type: "stat", data: { value: 92.5, decimals: 1, suffix: "%", label: "das casas têm internet" }, media: [] } },
      { section: "reviravolta", text: "No dia trinta, o Zé ligou o celular e descobriu que ninguém tinha percebido.", scene: zed({ pose: "shock", line: "Ninguém notou?", counter: { value: 30 }, twist: true }) },
      { section: "pergunta", text: "E você, faria isso? Tem outro e se aqui do lado.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } },
    ], { titles: ["E se você ficasse 30 dias sem internet?", "30 dias offline: o que acontece", "Ninguém percebeu que eu sumi"], thumbs: [{ lines: ["30 DIAS", "SEM INTERNET"] }, { lines: ["NINGUÉM", "PERCEBEU"] }, { lines: ["E SE", "FOSSE VOCÊ?"] }], intro: "O Zé desligou a internet por 30 dias. O final ninguém esperava.", hashtags: ["ese", "desafio", "internet"], tags: ["e se", "sem internet", "desafio", "30 dias", "curiosidades", "hipótese", "cotidiano", "detox digital", "internet no brasil", "ibge"] }, "playful ukulele");
  }

  // ---------- 3. Receitas de vó em 60 s (format written from scratch, vertical, custom scenes) ----------
  {
    const card = (emoji: string, title: string, sub: string) => ({
      type: "custom",
      source: "custom",
      media: [],
      data: {
        html: `<div class="card"><div class="ic">${emoji}</div><h1 id="t">${title}</h1><p id="s">${sub}</p></div>`,
        css: `.card{position:absolute;left:80px;right:80px;top:560px;padding:70px 60px;border-radius:48px;background:#FFF4E2;color:#3B2416;box-shadow:0 30px 80px rgba(0,0,0,.35);text-align:center}.card .ic{font:150px/1 "D";color:#E2552B}.card h1{font:110px/1.02 "D";margin:30px 0 20px}.card p{font:600 52px/1.2 "B"}`,
        js: `tl.from(".card", {autoAlpha:0, y:120, rotation:-4, duration:0.5, ease:"back.out(1.6)"}, 0.05); tl.from("#t", {autoAlpha:0, scale:0.6, duration:0.4, ease:"back.out(2)"}, 0.35); tl.from("#s", {autoAlpha:0, y:30, duration:0.35}, 0.6);`,
      },
    });
    const ch = await call("channel_create", {
      name: "Receita de Vó em 60s", handle: "receitadevo60s", niche: "receitas caseiras rápidas",
      voice: { provider: "local", voiceId: "" },
      format: {
        id: "receita-60s", name: "Receita de vó em 60 s", description: "Receita caseira em menos de um minuto, vertical, com cartões animados.",
        aspect: "9:16", durationSec: { min: 30, max: 90 },
        scenes: ["custom", "title", "photo", "cta"],
        imagery: { sources: ["custom", "foto-real"], notes: "cartões ilustrados feitos em código; foto real do prato no final" },
        research: "livre",
        structure: [
          { id: "gancho", title: "Gancho", targetSec: 5, mustHave: "o prato e por que é de vó" },
          { id: "ingredientes", title: "Ingredientes", targetSec: 15, mustHave: "3 a 5 ingredientes" },
          { id: "passo", title: "Passo a passo", targetSec: 25, mustHave: "3 passos curtos" },
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
        writingRules: ["Tom de vó carinhosa, frases curtas.", "Cada fala é um cartão: ícone, título e uma linha."],
      },
    });
    const channelId = ch.id as string;
    await call("channel_update", { channelId, patch: { identity: { palette: ["#3B2416", "#FFF4E2", "#E2552B", "#FF4D4D", "#36D399"] } } });
    const ep = await call("channel_episode_create", { channelId, title: "Bolo de caneca da vó" });
    const E = { channelId, episodeId: ep.id as string };
    await produce("receita", E, [
      { section: "gancho", text: "O bolo de caneca que a vó fazia em dois minutos. Fofinho, quentinho e com cheiro de domingo.", scene: card("VÓ", "Bolo de caneca", "receita da vó") },
      { section: "ingredientes", text: "Você precisa de um ovo, quatro colheres de leite e quatro de açúcar.", scene: card("1", "Ovo, leite, açúcar", "4 colheres de cada") },
      { section: "ingredientes", text: "Mais três colheres de farinha, duas de chocolate e uma pitada de fermento.", scene: card("2", "Farinha e chocolate", "e uma pitada de fermento") },
      { section: "passo", text: "Misture tudo na própria caneca com um garfo, até ficar liso.", scene: card("3", "Misture na caneca", "até ficar liso") },
      { section: "passo", text: "Leve ao micro-ondas por dois minutos, sem deixar passar do ponto.", scene: card("4", "Micro-ondas", "2 minutos") },
      { section: "passo", text: "Espere esfriar um pouquinho antes de comer, que a caneca esquenta.", scene: card("5", "Espere esfriar", "a caneca esquenta") },
      { section: "final", text: "Pronto, o bolo da vó. Salva para fazer no fim de semana.", cta: "like", scene: { type: "cta", data: { kind: "like" }, media: [] } },
    ], { titles: ["Bolo de caneca da vó em 2 minutos", "O bolo de micro-ondas mais fácil", "Receita de vó: bolo de caneca"], thumbs: [{ lines: ["BOLO EM", "2 MINUTOS"] }, { lines: ["RECEITA", "DA VÓ"] }, { lines: ["SÓ UMA", "CANECA"] }], intro: "Bolo de caneca de chocolate em dois minutos, do jeito que a vó fazia.", hashtags: ["receita", "bolodecaneca", "receitadevo"], tags: ["bolo de caneca", "receita de vó", "micro-ondas", "bolo rápido", "chocolate", "receita fácil", "doce", "receitas", "cozinha", "lanche"] }, "warm acoustic");
  }

  await writeFile(join(out, "e2e-formatos.json"), JSON.stringify(report, null, 2));
  log("pronto", join(out, "e2e-formatos.json"));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
