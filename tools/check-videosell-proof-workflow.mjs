
import assert from "node:assert/strict";
import { _electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const sandbox = await mkdtemp(join(tmpdir(), "videosell-workflow-"));
const fixture = join(sandbox, "fixture.png");
const recording = join(sandbox, "fixture.mp4");
execFileSync("ffmpeg", ["-v","error","-f","lavfi","-i","color=c=0xe000a0:s=480x300","-frames:v","1",fixture]);
execFileSync("ffmpeg", ["-v","error","-f","lavfi","-i","testsrc2=s=480x300:r=24","-t","1","-pix_fmt","yuv420p",recording]);
const env = { ...process.env, CUTROOM_USER_DATA: sandbox, CHROME_PATH: "C:/Program Files/Google/Chrome/Application/chrome.exe" };
delete env.ELECTRON_RUN_AS_NODE;
const pack = join(sandbox, "packages", "hyperframes-155.0.8059.79");
await mkdir(join(pack, "chrome-headless-shell-win64"), { recursive: true });
await writeFile(join(pack, "chrome-headless-shell-win64", "chrome-headless-shell.exe"), "Test fixture using installed Chrome");
await writeFile(join(pack, "ready.json"), JSON.stringify({ sha256: "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c" }));

const app = await _electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const evidence = resolve("artifacts/videosell-workbench");
  await mkdir(evidence, { recursive: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ ipcMain, dialog }, assets) => {
    const channel = "editor:request";
    const original = ipcMain._invokeHandlers.get(channel);
    let chosen = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [assets[chosen++]] });
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, method, params) => {
      if (method === "getPublishSettings")
        return { accounts: [{ id: "fixture", username: "loja" }], history: globalThis.testPublications ?? [], scheduled: [] };
      if (method === "getInstagramAnalytics") return {
        accountId: "fixture", username: "loja", updatedAt: new Date().toISOString(), partial: false, limited: false,
        reels: [{ id: "variation", caption: "Variação", likes: 29 }, { id: "original", caption: "Original", likes: 12 }].map((reel) => ({
          ...reel, comments: 1, shares: 1, saves: 1, reach: 100, permalink: "", publishedAt: new Date().toISOString(),
        })),
      };
      if (method === "sendChat") {
        let result;
        const scene = { narration: "Confira a fila de pedidos.", headline: "Fila de pedidos", visual: "steps", elements: ["Novo", "Pronto"] };
        if (params.displayText === "Sugerir pautas para vender o SaaS") {
          if (!params.text.includes("Print da fila")) throw new Error("Radar did not receive the proof");
          result = { ideas: ["Dor", "Objeção", "Prova", "Oferta"].map((angle) => ({ title: "Venda com prova", hook: "Cadê o pedido?", angle, proof: "Print da fila", brief: "Mostre como organizar pedidos." })) };
        } else if (params.displayText === "Ajustar uma cena") {
          result = { ...scene, headline: "Demonstração revisada", avatarSize: "small" };
        } else {
          const proofs = await original(event, "listBrandProofs", { profileId: "loja" });
          result = { title: "Reel com prova", caption: "Veja a demonstração.", scenes: [
            { ...scene, narration: "Perdeu um pedido?", proofId: proofs.find((proof) => proof.kind === "screenshot").id },
            { ...scene, proofId: null },
            { ...scene, narration: "Conheça o teste do aplicativo.", headline: "Teste o app" },
          ] };
        }
        return { messages: [{ role: "assistant", text: JSON.stringify(result) }] };
      }
      return original(event, method, params);
    });
  }, [fixture, recording]);

  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Criar perfil" });
  await form.getByLabel("Nome do perfil").fill("Loja");
  await form.getByLabel("Handle do perfil").fill("loja");
  await form.getByRole("button", { name: "Salvar perfil" }).click();
  await page.getByRole("button", { name: "Preencher depois" }).click();
  await page.evaluate(() => window.cutroom.studioProfiles.update("loja", {
    brand: { website: "https://example.com/produto" },
  }));
  await expect(page.getByRole("button", { name: "Criar meu primeiro Reel" })).toBeVisible();
  await page.screenshot({ path: join(evidence, "proximo-passo.png") });

  await page.getByRole("button", { name: "Provas da marca", exact: true }).click();
  for (const [kind, title] of [["screenshot", "Print da fila"], ["recording", "Gravação da fila"]]) {
    await page.getByLabel("Tipo").selectOption(kind);
    await page.getByLabel("Título").fill(title);
    await page.getByLabel("O que esta prova demonstra?").fill("Material de teste para demonstrar os estados de uma fila.");
    await page.getByRole("checkbox", { name: /Confirmo/ }).check();
    await page.getByRole("button", { name: "Guardar prova" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "Radar de pautas", exact: true }).click();
  await page.getByRole("button", { name: "Gerar sugestões" }).click();
  await page.getByRole("button", { name: "Usar esta pauta" }).first().click();
  await page.getByRole("button", { name: "Gerar vídeo", exact: true }).click();
  const review = page.locator(".reel-review");
  await expect(review).toBeVisible({ timeout: 120000 });
  const originalId = await review.getAttribute("data-film-id");
  const originalHtml = await page.evaluate((id) => window.cutroom.request("read_film_file", { film: id, path: "index.html" }), originalId);
  assert.match(originalHtml.content, /proof-[a-z0-9-]+\.png/);
  const brand = await page.evaluate((id) => window.cutroom.request("read_film_file", { film: id, path: "brand.js" }), originalId);
  assert.doesNotMatch(brand.content, /https?:/);
  const still = await page.locator(".reel-review-still").first().getAttribute("src");
  const pixels = execFileSync("ffmpeg", ["-v","error","-i","pipe:0","-vf","scale=54:96","-f","rawvideo","-pix_fmt","rgb24","pipe:1"], {
    input: Buffer.from(still.split(",")[1], "base64"),
  });
  let magenta = 0;
  for (let i=0; i<pixels.length; i+=3) if (pixels[i] > 150 && pixels[i+1] < 40 && pixels[i+2] > 110) magenta++;
  assert.ok(magenta > 60, "The imported proof must appear in an actual rendered frame");
  await page.getByText("Roteiro e cenas da última versão", { exact: true }).click();
  const scene = page.locator("fieldset").filter({ has: page.getByText("Cena 1 · Fila de pedidos", { exact: true }) });
  await scene.getByLabel("Prova visual da biblioteca").selectOption({ label: "Gravação da fila" });
  await scene.getByLabel("Pedido de ajuste").fill("Mude só o título desta cena.");
  await scene.getByRole("button", { name: "Ajustar esta cena" }).click();
  await expect(page.getByText("Cena 1 · Demonstração revisada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Gerar com roteiro ajustado" }).click();
  await expect(review).toBeVisible({ timeout: 120000 });
  const variationId = await review.getAttribute("data-film-id");
  assert.notEqual(variationId, originalId);
  const variantHtml = await page.evaluate((id) => window.cutroom.request("read_film_file", { film: id, path: "index.html" }), variationId);
  assert.match(variantHtml.content, /Demonstração revisada/);
  assert.match(variantHtml.content, /frame-001\.jpg/);
  assert.match(variantHtml.content, /Teste o app/);
  await page.getByRole("button", { name: "Exportar MP4", exact: true }).click();
  const exportOutput = page.getByTestId("reel-export-output");
  await expect(exportOutput).toBeVisible({ timeout: 360000 });
  const realExport = (await exportOutput.textContent()).trim();
  assert.ok((await stat(realExport)).size > 0);
  const media = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_streams","-of","json",realExport], { encoding:"utf8" }));
  assert.ok(media.streams.some((stream) => stream.codec_type === "video" && stream.width === 1080 && stream.height === 1920));
  assert.ok(media.streams.some((stream) => stream.codec_type === "audio"));
  console.log("Actual MP4 with proof recording:", realExport);
  await page.getByRole("button", { name: "Voltar à versão anterior" }).click();
  await expect(review).toHaveAttribute("data-film-id", originalId, { timeout: 120000 });
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("videosell.reviews.loja")));
  assert.equal(records.find((item) => item.filmId === variationId).draft.origin.parentFilmId, originalId);
  assert.equal(records.find((item) => item.filmId === originalId).draft.origin.ideaTitle, "Venda com prova");

  // Fixture publication responses verify the account/media join and comparison without posting.
  await page.evaluate(({ originalId }) => {
    const key = "videosell.reviews.loja";
    const records = JSON.parse(localStorage.getItem(key));
    for (const record of records) {
      if (record.filmId === originalId) record.output = "original.mp4";
    }
    localStorage.setItem(key, JSON.stringify(records));
  }, { originalId });
  await app.evaluate((_electron, variationPath) => {
    globalThis.testPublications = [
      { accountId: "fixture", mediaId: "original", username: "loja", video: "original.mp4" },
      { accountId: "fixture", mediaId: "variation", username: "loja", video: variationPath },
    ];
  }, realExport);
  await page.getByRole("button", { name: "Instagram Analytics", exact: true }).click();
  await page.getByLabel("Conta para este perfil").selectOption("fixture");
  await page.getByRole("button", { name: "Atualizar Insights" }).click();
  await expect(page.getByText("Original × variação", { exact: true })).toBeVisible();
  await expect(page.getByText("Interações disponíveis: 15 × 32")).toBeVisible();
  const variation = page.locator("article").filter({ has: page.getByRole("heading", { name: "Variação" }) });
  await variation.getByText("Conversões medidas fora do Instagram").click();
  await variation.getByLabel("Pedidos de demo").fill("2");
  await variation.getByRole("button", { name: "Salvar conversões" }).click();
  await expect(page.getByText("Pedidos de demo: — × 2")).toBeVisible();
  await page.screenshot({ path: join(evidence, "original-e-variacao-teste.png") });
  const originalCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Original", exact: true }) });
  await originalCard.getByRole("button", { name: "Testar outro gancho" }).click();
  await page.getByRole("button", { name: "Gerar vídeo", exact: true }).click();
  await expect(review).toBeVisible({ timeout: 120000 });
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem("videosell.reviews.loja"))[0]);
  assert.equal(latest.draft.origin.instagramMediaId, "original");
  assert.equal(latest.plan.scenes[0].headline, "Demonstração revisada");
  assert.deepEqual(latest.plan.scenes.slice(1), records.find((item) => item.filmId === originalId).plan.scenes.slice(1));
  assert.deepEqual(errors, []);
  console.log("Verified: guided home, proof library + Radar, actual film with screenshot and clip frames, targeted scene revision + restore, Analytics comparison and conversion registration.");
} finally { await app.close(); }

