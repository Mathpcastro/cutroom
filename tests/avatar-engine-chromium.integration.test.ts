import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import {
  avatarPixelHash,
  type AvatarRenderState,
} from "../resources/avatar-engine/avatar-engine.js";
import { parseAvatar } from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

const state: AvatarRenderState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "A",
  blink: 0,
  frame: 0,
};

function chromiumCandidates(): string[] {
  const platformPaths =
    process.platform === "win32"
      ? [
          join(
            process.env.PROGRAMFILES ?? "C:\\Program Files",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
          join(
            process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
            "/usr/bin/microsoft-edge",
          ];
  return [
    ...new Set(
      [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        ...platformPaths,
        chromium.executablePath(),
      ].filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

function requireChromium(): string {
  const candidates = chromiumCandidates();
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      `BLOCKED: no existing Chromium executable found. Checked: ${candidates.join(", ")}`,
    );
  }
  return executable;
}

describe("avatar engine Chromium integration", () => {
  it("matches Node RGBA bytes and SHA-256 in full and portrait without network", async () => {
    const executablePath = requireChromium();
    const avatar = parseAvatar(avatarFixture());
    const node = {
      full: await avatarPixelHash(avatar, state, "full"),
      portrait: await avatarPixelHash(avatar, state, "portrait"),
    };
    const engineSource = readFileSync(
      new URL("../resources/avatar-engine/avatar-engine.js", import.meta.url),
      "utf8",
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(engineSource).toString("base64")}`;
    const directory = await mkdtemp(join(tmpdir(), "avatar-engine-chromium-"));
    const htmlPath = join(directory, "index.html");
    await writeFile(htmlPath, '<!doctype html><meta charset="utf-8">');
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      const externalRequests: string[] = [];
      page.on("pageerror", (error) =>
        pageErrors.push(error instanceof Error ? error.message : String(error)),
      );
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        if (
          url.startsWith("file:") ||
          url.startsWith("data:") ||
          url.startsWith("blob:") ||
          url.startsWith("about:")
        ) {
          void request.continue();
        } else {
          externalRequests.push(url);
          void request.abort();
        }
      });
      await page.goto(pathToFileURL(htmlPath).href);

      await page.addScriptTag({
        type: "module",
        content: `import * as engine from ${JSON.stringify(moduleUrl)}; globalThis.avatarEngine = engine;`,
      });
      const chromiumResult = await page.evaluate(
        async ({ avatar, state }) => {
          const engine = (
            globalThis as unknown as {
              avatarEngine: typeof import("../resources/avatar-engine/avatar-engine.js");
            }
          ).avatarEngine;
          const render = async (viewport: "full" | "portrait") => {
            const pixels = engine.renderAvatarPixels(avatar, state, viewport);
            const hashed = await engine.avatarPixelHash(
              avatar,
              state,
              viewport,
            );
            return {
              width: pixels.width,
              height: pixels.height,
              data: Array.from(pixels.data),
              hash: hashed.hash,
            };
          };
          return {
            full: await render("full"),
            portrait: await render("portrait"),
          };
        },
        { avatar, state },
      );

      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
      for (const viewport of ["full", "portrait"] as const) {
        const actual = chromiumResult[viewport];
        const expected = node[viewport];
        expect(actual.width).toBe(expected.width);
        expect(actual.height).toBe(expected.height);
        expect(
          Buffer.from(actual.data).equals(Buffer.from(expected.data)),
          `${viewport} RGBA bytes`,
        ).toBe(true);
        expect(actual.hash, `${viewport} SHA-256`).toBe(expected.hash);
      }
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
