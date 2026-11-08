import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolDirectory, "..");
const siteRoot = resolve(projectRoot, "site", "upsell");
const artifactsDirectory = resolve(projectRoot, "artifacts", "upsell");
const viewports = [
  { width: 1440, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);

function chromiumExecutable() {
  const platformPaths =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
          ];
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    ...platformPaths,
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chromium não encontrado. Instale com npx playwright install chromium ou defina CHROMIUM_EXECUTABLE_PATH.",
    );
  }
  return executable;
}

function pathInsideSite(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decodedPath.includes("\0")) return undefined;

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = resolve(siteRoot, `.${requestedPath}`);
  const relativePath = relative(siteRoot, filePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }
  return filePath;
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function createUpsellServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendText(response, 405, "Método não permitido");
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/favicon.ico") {
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const filePath = pathInsideSite(url.pathname);
      if (!filePath) {
        sendText(response, 403, "Caminho fora da página pública");
        return;
      }

      let fileStats;
      try {
        fileStats = await stat(filePath);
      } catch {
        sendText(response, 404, "Arquivo não encontrado");
        return;
      }
      if (!fileStats.isFile()) {
        sendText(response, 404, "Arquivo não encontrado");
        return;
      }

      const contentType =
        mimeTypes.get(extname(filePath).toLowerCase()) ??
        "application/octet-stream";
      const headers = {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
      };
      let start = 0;
      let end = fileStats.size - 1;
      let status = 200;

      if (request.headers.range) {
        const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, { "Content-Range": `bytes */${fileStats.size}` });
          response.end();
          return;
        }

        if (!match[1]) {
          const suffixLength = Number(match[2]);
          start = Math.max(fileStats.size - suffixLength, 0);
        } else {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileStats.size) {
          response.writeHead(416, { "Content-Range": `bytes */${fileStats.size}` });
          response.end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${fileStats.size}`;
      }

      headers["Content-Length"] = end - start + 1;
      response.writeHead(status, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(filePath, { start, end });
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        sendText(response, 500, "Falha interna no servidor de teste");
      } else {
        response.destroy(error);
      }
    }
  });
}

function isExternalThumbnail(url) {
  try {
    return new URL(url).hostname === "pbs.twimg.com";
  } catch {
    return false;
  }
}

function isLocalMedia(url, baseUrl) {
  if (!url.startsWith(baseUrl)) return false;
  return /\.(?:mp4|jpe?g|svg)(?:$|[?#])/i.test(url);
}

function attachDiagnostics(page, baseUrl, label, problems, externalIssues) {
  const localMediaResponses = new WeakMap();
  page.on("pageerror", (error) => {
    problems.push(`${label}: pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    const text = `${message.text()}${location ? ` (${location})` : ""}`;
    if (isExternalThumbnail(location)) {
      externalIssues.add(`${label}: console da thumbnail externa: ${text}`);
    } else {
      problems.push(`${label}: erro de console: ${text}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const previousStatus = localMediaResponses.get(request);
    const failure = request.failure()?.errorText ?? "falha desconhecida";
    const detail = `${url}: ${failure}`;
    if (isExternalThumbnail(url)) {
      externalIssues.add(`${label}: thumbnail externa indisponível: ${detail}`);
    } else if (isLocalMedia(url, baseUrl)) {
      // Chrome aborta streams de mídia ao pausar, buscar outro trecho ou recarregar.
      // Só é cancelamento esperado quando o servidor já entregou uma resposta válida.
      const expectedMediaCancellation =
        failure === "net::ERR_ABORTED" &&
        (previousStatus === 200 || previousStatus === 206);
      if (!expectedMediaCancellation) {
        problems.push(`${label}: falha de mídia local: ${detail}`);
      }
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isLocalMedia(url, baseUrl)) {
      localMediaResponses.set(response.request(), response.status());
    }
    if (response.status() < 400) return;
    const detail = `${url}: HTTP ${response.status()}`;
    if (isExternalThumbnail(url)) {
      externalIssues.add(`${label}: thumbnail externa indisponível: ${detail}`);
    } else if (isLocalMedia(url, baseUrl)) {
      problems.push(`${label}: falha de mídia local: ${detail}`);
    }
  });
}

async function installRejectionCapture(page, label, problems) {
  await page.exposeFunction("__upsellReportUnhandledRejection", (reason) => {
    problems.push(`${label}: unhandled rejection: ${reason}`);
  });
  await page.addInitScript(() => {
    window.addEventListener("unhandledrejection", (event) => {
      void window
        .__upsellReportUnhandledRejection(String(event.reason))
        .catch(() => {});
    });
  });
}

async function settlePage(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll("video[data-autoplay]").length === 7 &&
      document.querySelectorAll("button.sound").length === 7,
  );
  // Rolagens reais em cada referência ativam loading=lazy e os observers.
  for (const original of await page.locator("a.orig").all()) {
    await original.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("a.orig img")).every(
        (image) => image.complete,
      ),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(250);
}

async function checkStructureAndOverflow(page, width) {
  const result = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    htmlWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    originals: document.querySelectorAll(".orig").length,
    ctas: document.querySelectorAll("[data-cakto-upsell]").length,
  }));
  assert.equal(result.viewportWidth, width);
  assert.ok(
    result.htmlWidth <= width && result.bodyWidth <= width,
    `overflow horizontal: viewport=${width}, html=${result.htmlWidth}, body=${result.bodyWidth}`,
  );
  assert.ok(result.originals >= 6, `somente ${result.originals} elementos .orig`);
  assert.ok(result.ctas >= 2, `somente ${result.ctas} CTAs de upsell`);
}

async function checkExternalFallbacks(page, label, externalIssues) {
  const states = await page.locator("a.orig").evaluateAll((links) =>
    links.map((link) => {
      const image = link.querySelector("img");
      const fallback = link.querySelector(".orig-fallback");
      const handle = fallback?.querySelector("strong");
      return {
        source: image?.currentSrc || image?.src || "",
        failed: Boolean(image?.complete && image.naturalWidth === 0),
        fallbackVisible: Boolean(
          fallback && fallback.getBoundingClientRect().height > 0,
        ),
        fallbackText: fallback?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        handle: image?.dataset.handle ?? "",
        handleHeight: handle?.getBoundingClientRect().height ?? 0,
        handleFontSize: handle
          ? Number.parseFloat(getComputedStyle(handle).fontSize)
          : 0,
      };
    }),
  );
  for (const state of states) {
    if (!state.failed) continue;
    assert.ok(
      state.fallbackVisible,
      `thumbnail sem fallback visível: ${state.source}`,
    );
    assert.ok(
      state.fallbackText.includes(state.handle) &&
        state.fallbackText.includes("Abrir referência no X"),
      `fallback incompleto: ${state.source}`,
    );
    assert.ok(
      state.handleHeight <= state.handleFontSize * 1.5,
      `handle quebrado em múltiplas linhas: ${state.handle}`,
    );
    externalIssues.add(`${label}: fallback ativo para ${state.handle}`);
  }
}

async function checkFirstCtaKeyboard(page) {
  await page.evaluate(() => document.activeElement?.blur());
  let focused = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() =>
      document.activeElement?.matches("[data-cakto-upsell]"),
    );
    if (focused) break;
  }
  assert.ok(focused, "Tab não alcançou o primeiro CTA de upsell");
  const state = await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      href: element?.getAttribute("href"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      firstCta: element === document.querySelector("[data-cakto-upsell]"),
    };
  });
  assert.equal(state.href, "#COMPRAR");
  assert.ok(state.firstCta, "o foco não está no primeiro CTA");
  assert.ok(
    state.outlineStyle !== "none" && state.outlineWidth > 0,
    "o CTA não apresenta foco visível",
  );
}

async function checkReducedMotionAndSound(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("button.sound").length === 7);
  await page.evaluate(
    () =>
      new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      ),
  );
  await page.waitForTimeout(350);
  const pausedStates = await page.locator("video[data-autoplay]").evaluateAll((videos) =>
    videos.map((video) => video.paused),
  );
  assert.ok(
    pausedStates.every(Boolean),
    `vídeos ativos com reduced motion: ${JSON.stringify(pausedStates)}`,
  );

  const firstSound = page.locator("button.sound").first();
  await firstSound.scrollIntoViewIfNeeded();
  await firstSound.focus();
  await firstSound.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector("button.sound")?.getAttribute("aria-pressed") ===
      "true",
  );
  const soundStates = await page.locator("video[data-autoplay]").evaluateAll((videos) =>
    videos.map((video) => ({
      muted: video.muted,
      pressed: video.parentElement
        ?.querySelector("button.sound")
        ?.getAttribute("aria-pressed"),
    })),
  );
  assert.equal(soundStates[0].muted, false, "o primeiro vídeo continua mudo");
  assert.equal(soundStates[0].pressed, "true");
  assert.equal(
    soundStates.filter((state) => !state.muted).length,
    1,
    `mais de um vídeo com som: ${JSON.stringify(soundStates)}`,
  );
  for (const state of soundStates.slice(1)) {
    assert.equal(state.muted, true);
    assert.equal(state.pressed, "false");
  }
}

async function checkHttpContract(baseUrl) {
  const indexResponse = await fetch(baseUrl);
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get("content-type") ?? "", /^text\/html/);
  await indexResponse.body?.cancel();

  const mediaResponse = await fetch(`${baseUrl}videos/professor.jpg`);
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get("content-type"), "image/jpeg");
  await mediaResponse.body?.cancel();

  const videoResponse = await fetch(`${baseUrl}videos/professor.mp4`, {
    headers: { Range: "bytes=0-31" },
  });
  assert.equal(videoResponse.status, 206);
  assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
  assert.equal((await videoResponse.arrayBuffer()).byteLength, 32);

  const traversalResponse = await fetch(
    `${baseUrl}%2e%2e%2f%2e%2e%2fpackage.json`,
  );
  assert.ok(
    traversalResponse.status === 403 || traversalResponse.status === 404,
    `traversal não rejeitado: HTTP ${traversalResponse.status}`,
  );
  await traversalResponse.body?.cancel();
}

await mkdir(artifactsDirectory, { recursive: true });
const server = createUpsellServer();
let browser;
const problems = [];
const externalIssues = new Set();
const screenshots = [];

try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  await checkHttpContract(baseUrl);

  browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    headless: true,
    args: ["--no-sandbox"],
  });

  for (const viewport of viewports) {
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({
      viewport,
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      attachDiagnostics(page, baseUrl, label, problems, externalIssues);
      await installRejectionCapture(page, label, problems);
      // Simula indisponibilidade do X para validar o fallback sem depender da rede.
      await page.route("https://pbs.twimg.com/**", (route) =>
        route.abort("failed"),
      );
      await page.goto(baseUrl, { waitUntil: "load" });
      await settlePage(page);
      await checkStructureAndOverflow(page, viewport.width);
      await checkExternalFallbacks(page, label, externalIssues);

      const screenshot = resolve(
        artifactsDirectory,
        `upsell-${viewport.width}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      await checkFirstCtaKeyboard(page);
      await checkReducedMotionAndSound(page);
      console.log(`PASS ${label}: estrutura, teclado, reduced motion e som`);
    } catch (error) {
      problems.push(
        `${label}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server.listening) {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

for (const issue of externalIssues) console.log(`INFO ${issue}`);
for (const screenshot of screenshots) console.log(`SCREENSHOT ${screenshot}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `PASS upsell: ${viewports.length} viewports, sem erros de runtime ou mídia local`,
  );
}
