import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SeriesStore } from "../electron/core/series";
import { buildDialogue, concatArgs, joinTimings } from "../electron/core/dialogue";
import { SAMPLE_SERIES, estimateSeconds, fromEngineText, toEngineText, validateScript } from "../src/shared/story";
import { storyFilmHtml } from "../src/shared/story-html";
import { STORY_SAMPLE } from "../src/components/studio/ReelCreator";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "videosell-series-"));

describe("Histórias (Spec 5)", () => {
  it("converts the structured script to engine text and back without loss", () => {
    const text = toEngineText(SAMPLE_SERIES.script, 1);
    expect(text).toBe(STORY_SAMPLE);
    expect(fromEngineText(text)).toEqual({ number: 1, script: { title: "O primeiro cliente", scenes: SAMPLE_SERIES.script.scenes } });
  });

  it("points out what the engine cannot do, with the fix", () => {
    const script = {
      title: "Teste",
      scenes: [{ place: "praia", time: "dia" as const, lines: [
        { who: "Léo", mood: "feliz", text: "uma duas três quatro cinco seis sete oito nove dez onze doze treze" },
        { who: "Zé", text: "Oi" },
        { who: "Bia", text: "a" }, { who: "Ana", text: "b" }, { who: "Rui", text: "c" },
      ] }],
    };
    const issues = validateScript(script, ["Léo", "Bia", "Ana", "Rui"]).map((i) => i.message);
    expect(issues).toEqual(expect.arrayContaining([
      'Cenário "praia" não existe.', "5 personagens nesta cena.", 'Humor "feliz" não existe.', "Fala com 13 palavras.", '"Zé" não está no elenco.',
    ]));
    expect(validateScript(SAMPLE_SERIES.script, ["Léo", "Bia"])).toEqual([]);
    expect(estimateSeconds(SAMPLE_SERIES.script)).toBeLessThan(45);
  });

  it("stores series per profile, atomically, with frozen cast on episodes", async () => {
    const dir = await tmp();
    const store = new SeriesStore(dir);
    const s = await store.create("perfil-a", { title: "O primeiro cliente", characters: SAMPLE_SERIES.characters, ideas: [{ title: "Ep 1", line: "começo" }] });
    expect(s.characters.map((c) => c.name)).toEqual(["Léo", "Bia", "Narrador"]);
    expect(await store.list("perfil-b")).toEqual([]);
    const ep = await store.createEpisode("perfil-a", s.id, { title: "O primeiro cliente", idea: "começo" });
    const saved = await store.updateEpisode("perfil-a", s.id, ep.number, { script: SAMPLE_SERIES.script, cast: { "Léo": { voiceId: "a" } } });
    expect(saved.state).toBe("script");
    await store.upsertCharacter("perfil-a", s.id, { name: "Léo", role: "x", description: "y", speech: "z", voice: { provider: "local", voiceId: "b" } });
    const again = await store.get("perfil-a", s.id);
    expect(again.series.characters.find((c) => c.name === "Léo")!.voice!.voiceId).toBe("b");
    expect(again.episodes[0].cast!["Léo"].voiceId).toBe("a");
    expect((await fs.readdir(path.join(dir, "profiles", "perfil-a", "series", s.id, "episodes"))).filter((n) => n.includes("partial"))).toEqual([]);
    await expect(store.remove("perfil-a", s.id, false)).rejects.toThrow(/confirm/);
    await store.remove("perfil-a", s.id, true);
    expect(await store.list("perfil-a")).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("dialogue: keeps line order, continuous times with pauses, and waits for a voice still generating", async () => {
    let pending = 1;
    const calls: string[] = [];
    const r = await buildDialogue(
      [{ text: "Oi Bia", voice: "a" }, { text: "Oi Léo", voice: "b" }],
      {
        synthesize: async (line) => {
          calls.push(line.voice!);
          if (line.voice === "b" && pending-- > 0) return null;
          return { file: `${line.voice}.wav`, words: line.text.split(" ").map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.3 })) };
        },
        probe: async () => 1,
        concat: async (files) => void expect(files).toEqual(["a.wav", "b.wav"]),
        wait: async () => undefined,
      },
      "out.wav",
      0.5,
    );
    expect(calls).toEqual(["a", "b", "b"]);
    expect(r.words.map((w) => w.start)).toEqual([0, 0.4, 1.5, 1.9]);
    expect(r.lines).toEqual([{ start: 0, end: 1 }, { start: 1.5, end: 2.5 }]);
    expect(r.duration).toBe(2.5);
    expect(joinTimings([{ words: [], duration: 2 }], 0.3).duration).toBe(2);
    expect(concatArgs(["a.wav", "b.wav"], 0.35, "o.wav").join(" ")).toContain("apad=pad_dur=0.35[a0];[1:a]aresample=48000,aformat=channel_layouts=mono[a1];[a0][a1]concat=n=2");
  });

  it("builds the episode film with the real cast and the end card", () => {
    const html = storyFilmHtml({ script: STORY_SAMPLE, duration: 30, voiceDuration: 27, cast: { "Léo": "film", "Bia": "companion" }, hasFilmAvatar: true, episode: { number: 2, series: "O primeiro cliente", cta: "Segue pra parte 3" } });
    expect(html).toContain('"Léo": window.FILM_AVATAR || S.strategist, "Bia": S.companion');
    expect(html).toContain("Segue pra parte 3");
    expect(html).toContain('<script src="avatar/runtime.js"></script>');
  });
});
