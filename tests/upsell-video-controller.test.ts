import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const pageUrl = pathToFileURL(join(projectRoot, "site", "upsell", "index.html")).href;
const localThumbnail = readFileSync(join(projectRoot, "site", "upsell", "videos", "professor.jpg"));

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
        : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    ...platformPaths,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chromium não encontrado. Instale com npx playwright install chromium ou defina CHROMIUM_EXECUTABLE_PATH.",
    );
  }
  return executable;
}

type VideoState = {
  muted: boolean;
  paused: boolean;
  text: string;
  pressed: string | null;
  label: string | null;
};

async function videoState(article: Locator): Promise<VideoState> {
  return article.evaluate((element) => {
    const video = element.querySelector("video")!;
    const button = element.querySelector("button.sound")!;
    return {
      muted: video.muted,
      paused: video.paused,
      text: button.textContent,
      pressed: button.getAttribute("aria-pressed"),
      label: button.getAttribute("aria-label"),
    };
  });
}

async function articleTitle(article: Locator) {
  return article.locator("h3").evaluate((heading) => heading.textContent.replace(/\s+/g, " ").trim());
}

describe("controller acessível dos vídeos de upsell", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let pageErrors: string[];

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: chromiumExecutable(),
      headless: true,
      args: ["--no-sandbox"],
    });
  }, 30_000);

  beforeEach(async () => {
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "no-preference",
    });
    page = await context.newPage();
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const rejections: string[] = [];
      Object.defineProperty(window, "__upsellUnhandledRejections", { value: rejections });
      window.addEventListener("unhandledrejection", (event) => {
        rejections.push(String(event.reason));
      });
    });
    await page.route("https://pbs.twimg.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/jpeg", body: localThumbnail }),
    );
    await page.goto(pageUrl, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("button.sound").length === 7);
  });

  afterEach(async () => {
    const unhandledRejections = await page.evaluate(() => {
      const runtime = window as unknown as { __upsellUnhandledRejections: string[] };
      return runtime.__upsellUnhandledRejections;
    });
    expect(pageErrors, "pageerror").toEqual([]);
    expect(unhandledRejections, "unhandled rejection").toEqual([]);
    await context.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("redefine o som ao sair da viewport e reativa com um Enter ao voltar", async () => {
    const article = page.locator("article.case").first();
    const button = article.locator("button.sound");
    const title = await articleTitle(article);
    await article.scrollIntoViewIfNeeded();
    await expect.poll(() => article.locator("video").evaluate((video) => !(video as HTMLVideoElement).paused && (video as HTMLVideoElement).muted)).toBe(true);

    await button.focus();
    await button.press("Enter");
    await expect.poll(() => videoState(article)).toMatchObject({
      muted: false,
      paused: false,
      text: "Sem som",
      pressed: "true",
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => videoState(article)).toEqual({
      muted: true,
      paused: true,
      text: "Ouvir",
      pressed: "false",
      label: `Ouvir vídeo: ${title}`,
    });

    await article.scrollIntoViewIfNeeded();
    await expect.poll(() => article.locator("video").evaluate((video) => !(video as HTMLVideoElement).paused && (video as HTMLVideoElement).muted)).toBe(true);
    await button.press("Enter");
    await expect.poll(() => videoState(article)).toMatchObject({
      muted: false,
      paused: false,
      text: "Sem som",
      pressed: "true",
      label: `Sem som vídeo: ${title}`,
    });
  }, 30_000);

  it("mantém estado coerente ao alternar reduced motion sem retomar som automaticamente", async () => {
    const article = page.locator("article.case").first();
    const button = article.locator("button.sound");
    const title = await articleTitle(article);
    await article.scrollIntoViewIfNeeded();
    await expect.poll(() => article.locator("video").evaluate((video) => !(video as HTMLVideoElement).paused && (video as HTMLVideoElement).muted)).toBe(true);
    await button.press("Enter");
    await expect.poll(() => article.locator("video").evaluate((video) => !(video as HTMLVideoElement).muted && !(video as HTMLVideoElement).paused)).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => videoState(article)).toEqual({
      muted: true,
      paused: true,
      text: "Ouvir",
      pressed: "false",
      label: `Ouvir vídeo: ${title}`,
    });

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => videoState(article)).toMatchObject({
      muted: true,
      text: "Ouvir",
      pressed: "false",
      label: `Ouvir vídeo: ${title}`,
    });
    await button.press("Enter");
    await expect.poll(() => videoState(article)).toMatchObject({
      muted: false,
      paused: false,
      text: "Sem som",
      pressed: "true",
      label: `Sem som vídeo: ${title}`,
    });
  }, 30_000);

  it("atualiza o nome acessível e mantém somente um vídeo com som", async () => {
    const first = page.locator("article.case").first();
    const second = page.locator("article.case").nth(1);
    await first.scrollIntoViewIfNeeded();
    await expect.poll(() => first.locator("video").evaluate((video) => !(video as HTMLVideoElement).paused)).toBe(true);
    const firstTitle = await articleTitle(first);
    const secondTitle = await articleTitle(second);

    await expect.poll(() => first.locator("button.sound").getAttribute("aria-label")).toBe(
      `Ouvir vídeo: ${firstTitle}`,
    );
    await first.locator("button.sound").press("Enter");
    await expect.poll(() => first.locator("button.sound").getAttribute("aria-label")).toBe(
      `Sem som vídeo: ${firstTitle}`,
    );
    await second.locator("button.sound").click();
    await expect.poll(() => second.locator("video").evaluate((video) => !(video as HTMLVideoElement).muted && !(video as HTMLVideoElement).paused)).toBe(true);

    const states = await page.locator("video[data-autoplay]").evaluateAll((videos) =>
      videos.map((video) => ({
        muted: (video as HTMLVideoElement).muted,
        paused: (video as HTMLVideoElement).paused,
        text: video.parentElement!.querySelector("button.sound")!.textContent,
        pressed: video.parentElement!.querySelector("button.sound")!.getAttribute("aria-pressed"),
      })),
    );
    expect(states.filter((state) => !state.muted)).toHaveLength(1);
    expect(states[2]).toMatchObject({ muted: false, paused: false, text: "Sem som", pressed: "true" });
    for (const [index, state] of states.entries()) {
      if (index === 2) continue;
      expect(state).toMatchObject({ muted: true, paused: true, text: "Ouvir", pressed: "false" });
    }
    await expect.poll(() => second.locator("button.sound").getAttribute("aria-label")).toBe(
      `Sem som vídeo: ${secondTitle}`,
    );
  }, 30_000);

  it("restaura texto, nome acessível e mute quando play falha", async () => {
    const article = page.locator("article.case").nth(2);
    const title = await articleTitle(article);
    await article.scrollIntoViewIfNeeded();
    await article.locator("video").evaluate((video) => {
      (video as HTMLVideoElement).play = () => Promise.reject(new Error("Falha simulada de play"));
    });
    await article.locator("button.sound").click();
    await expect.poll(() => videoState(article)).toEqual({
      muted: true,
      paused: true,
      text: "Ouvir",
      pressed: "false",
      label: `Ouvir vídeo: ${title}`,
    });
  }, 30_000);
});
