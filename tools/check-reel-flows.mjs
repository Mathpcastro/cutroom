import { _electron as electron, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const evidenceDir = resolve(".kimi-temp/reel-flows");
await mkdir(evidenceDir, { recursive: true });
const red = process.argv.includes("--red");
const label = red ? "red" : "green";
const userData = resolve(`.kimi-temp/reel-flows/user-data-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const evidence = { label, userData, checks: [], flows: [], pageErrors: [], consoleErrors: [] };
let app;
let page;

function localChrome() {
  const candidates = process.platform === "win32"
    ? [
        join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        join(process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local", "Google\\Chrome\\Application\\chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error(`Nenhum Chromium local encontrado: ${candidates.join(", ")}`);
  return executable;
}

async function seedLocalMotionPackage() {
  const chrome = localChrome();
  const packageDir = join(userData, "packages", "hyperframes-155.0.8059.79");
  const targetDir = join(packageDir, "chrome-headless-shell-win64");
  await mkdir(targetDir, { recursive: true });
  env.CHROME_PATH = chrome;
  await writeFile(join(targetDir, "chrome-headless-shell.exe"), "Fixture marker; CHROME_PATH selects the installed browser.");
  await writeFile(join(packageDir, "ready.json"), JSON.stringify({
    sha256: "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c",
    fixture: "local-existing-chromium-no-download",
  }));
  evidence.localBrowser = chrome;
}

async function createProfileAndAvatar() {
  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Criar perfil", exact: true });
  await dialog.getByLabel("Nome do perfil", { exact: true }).fill("Reels Reais");
  await dialog.getByLabel("Handle do perfil", { exact: true }).fill("reels-reais");
  await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
  await page.getByRole("button", { name: "Preencher depois", exact: true }).click();
  await expect(page.getByLabel("Perfil ativo", { exact: true })).toHaveValue("reels-reais");

  await page.getByRole("button", { name: "Criar meu avatar", exact: true }).click();
  await page.getByLabel("Descrição do avatar", { exact: true })
    .fill("Engenheiro cordial que apresenta produtos com clareza e confiança.");
  await page.getByRole("button", { name: "Criar três pontos de partida", exact: true }).click();
  await expect(page.locator(".avatar-candidate")).toHaveCount(3, { timeout: 60_000 });
  await page.getByRole("button", { name: "Selecionar Estrategista", exact: true }).click();
  await expect(page.getByAltText("Avatar renderizado pelo AvatarEngine")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: "Expressões e poses", exact: true }).click();
  for (const sheet of ["neutral", "silhouette", "grayscale", "backgrounds", "expressions", "mouths", "motion"]) {
    await page.getByRole("button", { name: sheet, exact: true }).click();
    const image = page.getByAltText(`Folha ${sheet} do AvatarEngine`);
    await expect(image).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await page.getByRole("button", { name: "Confirmar aprovação manual", exact: true }).click();
  await page.getByRole("button", { name: "Finalizar e salvar no perfil", exact: true }).click();
  await expect(page.getByText(/Avatar salvo no perfil/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Voltar ao início", exact: true }).click();
  evidence.checks.push("approved avatar fixture created by the real AvatarService and saved to the profile");
}

async function createReel({ withAvatar }) {
  const suffix = withAvatar ? "com-avatar" : "sem-avatar";
  await page.getByRole("navigation", { name: "Navegação do estúdio" }).getByRole("button", { name: "Criar Reel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Criar Reel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: withAvatar ? "Com avatar" : "Sem avatar", exact: true }).click();
  await page.getByRole("button", { name: withAvatar ? "História" : "Vídeo direto", exact: true }).click();
  await page.getByRole("textbox", { name: "O que você quer criar?", exact: true }).fill("Crie um Reel sobre perder pedidos na planilha e mostre como organizar o atendimento.");
  await expect(page.getByLabel("Prévia do estilo selecionado")).toBeVisible();
  await page.getByRole("button", { name: /^(Gerar vídeo|Gerar nova versão)$/ }).click();
  await expect(page.getByRole("heading", { name: "Revisar Reel", exact: true })).toBeVisible({ timeout: 180_000 });
  const stills = page.locator(".reel-review-still");
  await expect(stills.first()).toBeVisible({ timeout: 180_000 });
  if (await stills.count() < 3) throw new Error("A revisão não recebeu stills reais suficientes.");
  for (const image of await stills.all()) {
    const src = await image.getAttribute("src");
    if (!src?.startsWith("data:image/jpeg;base64,")) throw new Error("Still não veio do FilmStudio.");
  }
  const filmId = await page.locator(".reel-review").getAttribute("data-film-id");
  const film = await page.evaluate(async (id) => window.cutroom.request("read_film_file", { film: id, path: "film.json" }).catch(async () => {
    const listed = await window.cutroom.request("list_films");
    return listed.films.find((item) => item.id === id);
  }), filmId);
  const filmDir = (await page.evaluate(async (id) => window.cutroom.request("read_film_file", { film: id }), filmId)).path;
  const meta = JSON.parse(await readFile(join(filmDir, "film.json"), "utf8"));
  const html = await readFile(join(filmDir, "index.html"), "utf8");
  if (meta.width !== 1080 || meta.height !== 1920) throw new Error(`Dimensões incorretas: ${meta.width}x${meta.height}`);
  if (!html.includes('src="kit/gsap.min.js"') || !html.includes('src="timing.js"') || !html.includes("sales-plan")) {
    throw new Error("HTML local não contém GSAP, timing e legendas reais.");
  }
  if (withAvatar) {
    if (!meta.avatar || !html.includes('src="avatar/runtime.js"') || !html.includes('src="avatar/voice.js"') || !html.includes("CRM.autoReel")) {
      throw new Error("Snapshot/engine/voz do avatar não foram ligados ao HTML.");
    }
    await stat(join(filmDir, "avatar", "runtime.js"));
    await stat(join(filmDir, "avatar", "voice.js"));
  } else if (meta.avatar || html.includes("avatar/runtime.js")) {
    throw new Error("O fluxo sem avatar exigiu ou anexou um avatar.");
  }
  const linked = await page.evaluate(() => window.cutroom.studioProfiles.listProjects("reels-reais"));
  if (!linked.includes(filmId)) throw new Error(`Filme ${filmId} não foi vinculado ao perfil.`);
  evidence.flows.push({ mode: suffix, filmId, filmDir, format: meta.format, avatar: meta.avatar, stills: await stills.count(), film });

  await page.getByRole("button", { name: "Abrir no editor avançado", exact: true }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Estúdio de vídeos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar estúdio", exact: true }).click();
  await page.getByRole("button", { name: "Voltar ao estúdio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revisar Reel", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Exportar MP4", exact: true }).click();
  await expect(page.getByTestId("reel-export-status")).toContainText(/renderizando|concluída/i, { timeout: 60_000 });
  await expect(page.getByTestId("reel-export-output")).toBeVisible({ timeout: 600_000 });
  await expect(page.getByTestId("reel-export-output")).toHaveText(/\.mp4$/i);
  const output = (await page.getByTestId("reel-export-output").textContent()).trim();
  if (!(await stat(output)).size) throw new Error(`MP4 vazio: ${output}`);
  evidence.flows.at(-1).output = output;
  evidence.checks.push(`${suffix}: real create_film, profile voice, HTML/timing/captions, stills, advanced editor, profile link and RenderService MP4`);
  await page.getByRole("button", { name: "Voltar ao início", exact: true }).click();
}

try {
  await seedLocalMotionPackage();
  app = await electron.launch({ args: ["."], env, timeout: 60_000 });
  page = await app.firstWindow();
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await page.waitForFunction(() => !!window.cutroom);
  // Stub only the external AI response. Electron, profiles, speech, rendering and disk stay real.
  await app.evaluate(({ ipcMain }) => {
    const channel = "editor:request";
    const original = ipcMain._invokeHandlers.get(channel);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, method, params) => {
      if (method !== "sendChat") return original(event, method, params);
      const answer = params.displayText.includes("pautas") ? {
        ideas: ["Dor", "Objeção", "Prova", "Oferta"].map((angle) => ({
          title: "Pedidos fora do controle", hook: "Onde foi parar aquele pedido?",
          angle, proof: "Demonstre uma fila de pedidos em teste.",
          brief: "Mostre uma loja organizando a fila de pedidos.",
        })),
      } : {
        title: "Pedidos fora do controle", caption: "Veja o fluxo no link do perfil.",
        scenes: [
          { narration: "O pedido sumiu na planilha.", headline: "Cadê o pedido?", visual: "contrast", elements: ["Mensagens", "Planilha"] },
          { narration: "Coloque tudo em uma fila.", headline: "Fila única", visual: "interface", elements: ["Recebido", "Em preparo"] },
          { narration: "Veja o fluxo no link do perfil.", headline: "Confira a demonstração", visual: "result", elements: ["Fila organizada", "Ver demonstração"] },
        ],
      };
      return { messages: [{ role: "assistant", text: JSON.stringify(answer) }] };
    });
  });
  await createProfileAndAvatar();
  await page.getByRole("button", { name: "Radar de pautas", exact: true }).click();
  await page.getByRole("button", { name: "Gerar sugestões", exact: true }).click();
  await expect(page.getByRole("button", { name: "Usar esta pauta", exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "Usar esta pauta", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "O que você quer criar?", exact: true })).toHaveValue("Mostre uma loja organizando a fila de pedidos.");
  await page.getByRole("button", { name: "Rotina", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Piloto automático", exact: true })).toBeVisible();
  evidence.checks.push("Radar com resposta de IA de teste, pauta abre no editor e Rotina acessível");

  await createReel({ withAvatar: true });
  await createReel({ withAvatar: false });
  await page.getByRole("navigation", { name: "Navegação do estúdio" }).getByRole("button", { name: "Criar Reel", exact: true }).click();
  for (const [width, height] of [[1440, 1000], [1050, 700]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    const layout = await page.locator(".studio-main").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    if (layout.scroll > layout.client + 1) throw new Error("Overflow horizontal em " + width);
    await page.screenshot({ path: join(evidenceDir, "criacao-" + width + ".png") });
  }
  if (evidence.pageErrors.length || evidence.consoleErrors.length) {
    throw new Error(JSON.stringify({ pageErrors: evidence.pageErrors, consoleErrors: evidence.consoleErrors }));
  }
  evidence.checks.push("zero renderer page errors and console errors");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(`.kimi-temp/reel-flows/${label}-failure.png`), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(`.kimi-temp/reel-flows/${label}-verification.json`), JSON.stringify(evidence, null, 2));
  if (app) await app.close().catch(() => {});
}
