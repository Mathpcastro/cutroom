import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KOKORO_DEFAULT_VOICE, KOKORO_FILES, KOKORO_PACKAGE, KOKORO_VOICES, kokoroSpokenText } from "../electron/core/kokoro";
import { PackageManager } from "../electron/core/packages";
import { UV_RUNTIMES } from "../electron/core/packages";

describe("kokoro voice", () => {
  it("lists Brazilian voices first with Alex as the default", () => {
    expect(KOKORO_DEFAULT_VOICE).toBe("pm_alex");
    expect(KOKORO_VOICES.slice(0, 3).map((v) => v.id)).toEqual(["pm_alex", "pf_dora", "pm_santa"]);
    expect(KOKORO_VOICES.every((v) => v.provider === "kokoro")).toBe(true);
  });
  it("respells only the audio for words the Portuguese phonemizer misreads", () => {
    expect(kokoroSpokenText("Seu SaaS com IA e API")).toBe("Seu sás com i-á e a-pê-i");
    expect(kokoroSpokenText("Your SaaS", "en-us")).toBe("Your SaaS");
    expect(kokoroSpokenText("saasy")).toBe("saasy");
  });
  it("pins model downloads by size and SHA-256", () => {
    for (const file of KOKORO_FILES) {
      expect(file.url).toMatch(/^https:\/\/github\.com\/thewh1teagle\/kokoro-onnx\/releases\/download\//);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(1_000_000);
    }
  });
  it("has a hash-locked requirements file for every supported platform", async () => {
    for (const runtime of Object.values(UV_RUNTIMES)) {
      const lock = await fs.readFile(path.resolve("resources/workers", runtime.lock.replace("requirements", "requirements.kokoro")), "utf8");
      expect(lock).toMatch(/^kokoro-onnx==0\.6\.1 \\/m);
      expect(lock).toMatch(/--hash=sha256:/);
    }
  });
  it("shows the package as available until it is installed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-kokoro-"));
    try {
      const list = await new PackageManager(root, path.resolve("resources")).list();
      const kokoro = list.find((p) => p.id === KOKORO_PACKAGE)!;
      expect(list[0].id).toBe("faster-whisper-base");
      expect(kokoro).toMatchObject({ name: "Voz Kokoro", installed: false, status: "available" });
      expect(kokoro.size).toMatch(/Transcrição local/);
      await expect(new PackageManager(root, path.resolve("resources")).kokoroSpeak("Oi", undefined, root)).rejects.toThrow(/Instale a Voz Kokoro/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

// Real install + synthesis (downloads ~200 MB). Run with CUTROOM_KOKORO_ROOT=<packages dir that already has Transcrição local>.
describe.runIf(!!process.env.CUTROOM_KOKORO_ROOT)("kokoro package (real)", () => {
  it(
    "installs, verifies and speaks Portuguese",
    async () => {
      const manager = new PackageManager(process.env.CUTROOM_KOKORO_ROOT!, path.resolve("resources"));
      const steps: string[] = [];
      await manager.install(KOKORO_PACKAGE, (_p, label) => steps.push(label));
      expect((await manager.list()).find((p) => p.id === KOKORO_PACKAGE)?.installed).toBe(true);
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-kokoro-say-"));
      const started = Date.now();
      const speech = await manager.kokoroSpeak("Mil curtidas. Zero assinaturas no seu SaaS.", "pm_alex", temp);
      console.log("steps:", [...new Set(steps)].join(" → "), `| fala em ${Date.now() - started} ms`);
      expect(speech.extension).toBe("wav");
      expect(speech.audio.length).toBeGreaterThan(48_000);
      await fs.rm(temp, { recursive: true, force: true });
    },
    20 * 60_000,
  );
});
