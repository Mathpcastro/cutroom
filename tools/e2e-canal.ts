/**
 * E2E real do Estúdio de Canais, dirigido só pelas ferramentas MCP (como o Claude Code faria),
 * com os pacotes locais do app: voz do Windows, Whisper local e HyperFrames. Fotos reais do
 * Wikimedia Commons e trilha do incompetech pela busca do próprio app.
 *
 *   npx electron-vite build
 *   npx tsx tools/e2e-canal.ts <pasta-de-saída>
 *
 * Variáveis: CUTROOM_PACKAGES (padrão %APPDATA%/CutRoom/packages), CHROME_PATH (opcional).
 * Grava <saída>/e2e-report.json com os tempos de cada etapa.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import { durationOf } from "../electron/core/channel/ffmpeg";
import { JobRunner } from "../electron/core/channel/jobs";
import { localSpeech } from "../electron/core/local-voice";
import { motionBrowser, motionPackageInfo } from "../electron/core/motion-package";
import { PackageManager } from "../electron/core/packages";

const out = resolve(process.argv[2] ?? "e2e-canal");
const packagesRoot = process.env.CUTROOM_PACKAGES ?? join(process.env.APPDATA ?? "", "CutRoom", "packages");
const P = "default";
const times: Record<string, number> = {};
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
    const t0 = Date.now();
    const r = (await tool(name, { profileId: P, ...args })) as Record<string, unknown>;
    times[name] = (times[name] ?? 0) + (Date.now() - t0) / 1000;
    if (r && r.status === "failed") throw new Error(`${name}: ${r.error}`);
    return r;
  };

  const ch = await call("channel_create", { name: "Vale a Pena Morar?", handle: "valeapenamorarem", niche: "cidades do Brasil", longMinMinutes: 1.5 });
  const channelId = ch.id as string;
  await call("channel_update", { channelId, patch: { defaults: { voiceId: "local:" }, identity: { palette: ["#0F1115", "#F4F1EA", "#FFC93C", "#FF4D4D", "#36D399"] } } });
  const ep = await call("channel_episode_create", { channelId, title: "Niterói vale a pena?" });
  const E = { channelId, episodeId: ep.id as string };
  const facts = await call("research_add_facts", { ...E, facts: [
    { claim: "População de Niterói no Censo", value: "481.749", unit: "habitantes", dataDate: "2022", source: { url: "https://www.ibge.gov.br/cidades-e-estados/rj/niteroi.html", publisher: "IBGE", title: "Cidades e Estados" } },
    { claim: "Extensão da Ponte Rio-Niterói", value: 13.29, unit: "quilômetros", dataDate: "2024", source: { url: "https://www.gov.br/antt/pt-br", publisher: "ANTT", title: "Concessões rodoviárias" } },
  ] });
  const [fPop, fPonte] = facts.added as string[];
  const photo = (q: string) => ({ type: "photo", data: { move: "in" }, media: [], query: q, place: "Niterói" });
  const title = (lines: string[]) => ({ type: "title", data: { lines: lines.map((text, i) => ({ text, color: i === lines.length - 1 ? "accent" : "ink" })) }, media: [] });
  const beats = [
    { section: "gancho", text: "A cidade mais cara do Rio pode não ser a capital.", scene: photo("Niterói Icaraí praia") },
    { section: "gancho", text: "Niterói tem 481.749 moradores e uma ponte de 13 quilômetros. Vale a pena? Fica até o final.", facts: [fPop, fPonte], scene: { type: "stat", data: { value: 481749, label: "moradores no Censo de 2022" }, media: [] } },
    { section: "contexto", text: "Niterói fica do outro lado da Baía de Guanabara, de frente para o Rio.", scene: photo("Niterói Baía de Guanabara") },
    { section: "contexto", text: "Ela é conhecida pela qualidade de vida e pelo museu de arte contemporânea.", scene: photo("Museu de Arte Contemporânea Niterói") },
    { section: "contexto", text: "Mas morar lá tem um preço que pouca gente conta.", scene: title(["Mas tem", "um preço"]) },
    { section: "tese", text: "Na minha visão, o problema não é o aluguel, é o caminho até o trabalho.", scene: title(["Não é o aluguel", "é o caminho"]) },
    { section: "tese", text: "Quem trabalha no Rio depende da ponte todos os dias, na ida e na volta.", scene: photo("Ponte Rio-Niterói") },
    { section: "lado-bom", text: "Imagina que você mora em Icaraí e caminha na praia antes do café.", scene: photo("Praia de Icaraí Niterói") },
    { section: "lado-bom", text: "A cidade tem bairros arborizados, orla e um centro que dá para fazer a pé.", scene: { type: "list", data: { title: "O lado bom", items: [{ text: "orla e praias", mark: "ok" }, { text: "bairros arborizados", mark: "ok" }, { text: "centro a pé", mark: "ok" }] }, media: [] } },
    { section: "virada", text: "Agora o lado que não sai no folder: o trânsito da ponte no horário de pico.", scene: photo("Ponte Rio-Niterói trânsito") },
    { section: "virada", text: "Comenta aí de qual cidade você está assistindo este vídeo agora.", cta: "comment", scene: { type: "cta", data: { kind: "comment", examples: ["Recife", "Curitiba", "Niterói"] }, media: [] } },
    { section: "virada", text: "E quando chove forte, alguns bairros sofrem com alagamentos.", scene: title(["Chuva forte", "alagamento"]) },
    { section: "comparacao", text: "Comparada com a Zona Sul do Rio, Niterói ainda parece mais tranquila.", scene: photo("Niterói vista do Parque da Cidade") },
    { section: "veredito", text: "Vale para quem trabalha na própria cidade. Não vale para quem cruza a ponte todo dia.", scene: { type: "list", data: { title: "Vale a pena?", items: [{ text: "trabalha em Niterói", mark: "ok" }, { text: "cruza a ponte todo dia", mark: "no" }] }, media: [] } },
    { section: "assinatura", text: "E você, moraria em Niterói? Tem outro vídeo aqui do lado para você.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } },
  ];
  const saved = await call("script_save", { ...E, beats });
  log("roteiro", JSON.stringify((saved.review as { stats: unknown }).stats), (saved.review as { issues: { level: string; code: string }[] }).issues.map((i) => `${i.level}:${i.code}`).join(" "));

  // Real photos from Commons for every photo beat.
  const script = (await call("script_get", E)) as { beats: { id: string; scene: { type: string } }[] };
  for (const b of script.beats.filter((x) => x.scene.type === "photo")) {
    const found = (await call("media_search", { ...E, beatId: b.id })) as { result?: { candidates: unknown[] } };
    const n = found.result?.candidates.length ?? 0;
    if (!n) {
      log("sem candidata para", b.id);
      continue;
    }
    await call("media_pick", { ...E, beatId: b.id, index: 0, place: "Niterói" });
  }
  await call("media_music", { ...E, query: "calm piano", pick: [0] });

  await call("episode_approve", { ...E, gate: "script" }).catch((e) => log("aprovação do roteiro:", (e as Error).message));
  const pipe = await call("pipeline_run", { ...E, from: "narration", to: "qa", direct: true });
  log("pipeline", JSON.stringify(pipe.result).slice(0, 600));
  const qa = (await call("qa_report", E)) as { issues: { level: string; code: string; beatId?: string; message: string }[]; sheets: string[]; elapsedSec: number };
  log("qa", qa.elapsedSec, "s", qa.issues.map((i) => `${i.level}:${i.code}:${i.beatId ?? ""}`).join(" "));
  await call("episode_approve", { ...E, gate: "frames" }).catch((e) => log("aprovação dos quadros:", (e as Error).message));
  const render = await call("episode_render", E);
  log("render", JSON.stringify(render.result).slice(0, 400));
  const pkg = await call("package_generate", { ...E, titles: ["Niterói é mais cara que o Rio?", "A cidade do outro lado da ponte", "Vale a pena morar em Niterói?"], thumbs: [{ lines: ["MAIS CARA", "QUE O RIO?"] }, { lines: ["O PREÇO", "DA PONTE"] }, { lines: ["VALE", "A PENA?"] }], intro: "Niterói tem fama de qualidade de vida. Mas tem um preço que pouca gente conta.", hashtags: ["niteroi", "rio", "cidades"], tags: ["niterói", "morar em niterói", "custo de vida", "icaraí", "rio de janeiro", "cidades do brasil", "vale a pena morar", "ponte rio niterói", "mudança", "brasil"] });
  log("pacote", JSON.stringify(pkg.result).slice(0, 400));
  const shorts = await call("shorts_cut", { ...E, count: 1 }).catch((e) => ({ error: (e as Error).message }));
  log("shorts", JSON.stringify(shorts).slice(0, 300));

  // Change one beat and re-render: the 3-minute target.
  const t0 = Date.now();
  await call("script_edit_beats", { ...E, edits: [{ op: "update", id: "b_012", patch: { text: "E nos dias de chuva forte, alguns bairros ainda alagam." } }] });
  await call("narration_redo_beats", E);
  await call("scenes_compile", E);
  await call("qa_run", { ...E, beatIds: ["b_012"] });
  const again = await call("episode_render", E);
  const reRender = (Date.now() - t0) / 1000;
  log("re-render", reRender, "s", JSON.stringify((again.result as { scenes: unknown }).scenes));
  const status = await call("episode_status", E);
  const report = { times, reRenderSec: reRender, status, qaSheets: qa.sheets, render: render.result, rerender: again.result };
  await writeFile(join(out, "e2e-report.json"), JSON.stringify(report, null, 2));
  log("pronto", join(out, "e2e-report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
