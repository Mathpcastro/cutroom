import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { alignBeats, expandTranscript, scribeTranscriber, spokenTokens, wordCheck, type TimedWord, type Transcriber } from "../electron/core/channel/aligner";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { durationOf, ffmpeg, measureLoudness } from "../electron/core/channel/ffmpeg";
import { DEFAULT_VOICE_SETTINGS, alignNarration, elevenLabsSpeaker, generateNarration, planBlocks, redoBeats, type Speaker, type VoiceSettings } from "../electron/core/channel/narration";
import { editScript, saveScript } from "../electron/core/channel/script-writer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** Transcript where each word takes `step` seconds from `t0`. */
function heard(text: string, t0 = 0, step = 0.3): TimedWord[] {
  return text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, start: t0 + i * step, end: t0 + i * step + step * 0.8 }));
}

describe("aligner", () => {
  it("expands numbers, money and acronyms on both sides", () => {
    expect(spokenTokens("São 15.938 pessoas")).toEqual(["sao", "quinze", "mil", "novecentos", "e", "trinta", "e", "oito", "pessoas"]);
    expect(expandTranscript([{ text: "R$", start: 0, end: 0.2 }, { text: "4,70", start: 0.2, end: 1 }]).map((w) => w.text)).toEqual(["quatro", "reais", "e", "setenta", "centavos"]);
    expect(spokenTokens("o IBGE")).toEqual(spokenTokens("o í bê gê é"));
  });

  it("matches a script said in words against a transcript written in digits", () => {
    const beats = [
      { id: "b_001", text: "São 15.938 pessoas na cidade.", say: "São quinze mil, novecentos e trinta e oito pessoas na cidade." },
      { id: "b_002", text: "O IBGE confirma.", say: "O í bê gê é confirma." },
    ];
    const r = alignBeats(beats, [...heard("São 15.938 pessoas na cidade."), ...heard("O IBGE confirma.", 3)], 5);
    expect(r.ratio).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.timings.b_002.start).toBeCloseTo(3, 3);
    expect(r.timings.b_001.cut).toBeCloseTo(3 - 0.06, 3);
    expect(r.timings.b_002.cut).toBe(5);
  });

  it("cuts at the next beat's start minus 60 ms, never at the last matched word (\"quatro e setenta\")", () => {
    const beats = [
      { id: "b_001", text: "A passagem custa quatro e setenta." },
      { id: "b_002", text: "E sobe todo ano." },
    ];
    // ASR wrote "R$ 4,70" and timed it short; the next beat starts at 2.4 s.
    const t: TimedWord[] = [...heard("A passagem custa"), { text: "R$", start: 0.9, end: 1.0 }, { text: "4,70.", start: 1.0, end: 1.3 }, ...heard("E sobe todo ano.", 2.4)];
    const r = alignBeats(beats, t, 4);
    expect(r.ok).toBe(true);
    expect(r.timings.b_001.cut).toBeCloseTo(2.34, 3);
    expect(r.timings.b_001.cut).toBeGreaterThan(r.timings.b_001.end);
  });

  it("handles an inserted beat missing from the audio (ratio drops) and a deleted one (extra audio)", () => {
    const WORDS = "praia ponte morro centro balsa museu bairro feira porto ilha trilha parque mercado estação avenida igreja forte farol lagoa serra".split(" ");
    const beats = WORDS.map((w, i) => ({ id: `b_${String(i + 1).padStart(3, "0")}`, text: `Agora a ${w} aparece com outra ${w} ao fundo.` }));
    const audio = beats.flatMap((b, i) => heard(b.text, i * 3));
    const inserted = [...beats.slice(0, 10), { id: "b_099", text: "Fala nova que ainda não foi narrada por ninguém aqui." }, ...beats.slice(10)];
    const ins = alignBeats(inserted, audio, 60);
    // Between 95% and 97%: passes with a warning; the worst beat is the new one.
    expect(ins.ratio).toBeLessThan(0.97);
    expect(ins.worst?.beatId).toBe("b_099");
    const many = [...beats.slice(0, 10), ...["b_097", "b_098", "b_099"].map((id) => ({ id, text: "Fala nova que ainda não foi narrada por ninguém aqui." })), ...beats.slice(10)];
    const fail = alignBeats(many, audio, 60);
    expect(fail.ok).toBe(false);
    expect(fail.error).toMatch(/mínimo 95%/);
    const deleted = beats.filter((b) => b.id !== "b_005");
    const del = alignBeats(deleted, audio, 60);
    expect(del.ratio).toBe(1);
    expect(del.timings.b_006.start).toBeCloseTo(15, 3);
  });

  it("checks the final audio for deleted words", () => {
    const beats = [{ id: "b_001", text: "Niterói tem quinze praias e muito sol." }];
    expect(wordCheck(beats, heard("Niterói tem 15 praias e muito sol.")).ratio).toBe(1);
    expect(wordCheck(beats, heard("Niterói tem praias e sol.")).missing).toEqual(["quinze", "muito"]);
  });

  it("Scribe sends the file and keeps only words", async () => {
    let sent: FormData | undefined;
    const t = scribeTranscriber("k", { readFile: async () => new Uint8Array([1]), fetch: async (_u, init) => {
      sent = init?.body as FormData;
      return Response.json({ words: [{ text: "Olá", start: 0, end: 0.4, type: "word" }, { text: " ", start: 0.4, end: 0.5, type: "spacing" }] });
    } });
    expect(await t("a.wav", { language: "pt-BR" })).toEqual([{ text: "Olá", start: 0, end: 0.4 }]);
    expect(sent?.get("language_code")).toBe("por");
    expect(sent?.get("timestamps_granularity")).toBe("word");
  });
});

const voice: VoiceSettings = { provider: "elevenlabs", voiceId: "v", ...DEFAULT_VOICE_SETTINGS };

describe("narration blocks", () => {
  it("groups beats of a section up to 1,700 characters and never splits a beat", () => {
    const long = "palavra ".repeat(100).trim();
    const beats = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b_00${i + 1}`, section: "gancho", text: long })),
      { id: "b_006", section: "contexto", text: "Curta." },
    ];
    const blocks = planBlocks(beats, voice);
    expect(blocks.map((b) => b.beatIds)).toEqual([["b_001", "b_002"], ["b_003", "b_004"], ["b_005"], ["b_006"]]);
    expect(blocks.every((b) => b.chars <= 1700)).toBe(true);
    expect(planBlocks(beats, { ...voice, speed: 1.1 })[0].id).not.toBe(blocks[0].id);
  });

  it("ElevenLabs speaker sends the channel's voice settings", async () => {
    let body: Record<string, unknown> = {};
    const speak = elevenLabsSpeaker("k", voice, { fetch: async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([1, 2]));
    } });
    await speak("Olá", {});
    expect(body.voice_settings).toMatchObject({ speed: 1.05, stability: 0.5, similarity_boost: 0.8, style: 0.25 });
  });
});

describe("narration end to end (fake voice, real FFmpeg)", () => {
  /** Speaker: a 220 Hz tone, 0.3 s per word, as WAV. */
  const speaker = (calls: string[]): Speaker => async (text) => {
    calls.push(text);
    const dir = await mkdtemp(join(tmpdir(), "tts-"));
    roots.push(dir);
    const f = join(dir, "a.mp3");
    const words = text.split(/\s+/).length;
    await ffmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=22050:duration=${(words * 0.3).toFixed(2)}`, "-c:a", "libmp3lame", f]);
    return { audio: new Uint8Array(await readFile(f)), extension: "mp3" };
  };
  /** Transcriber that "hears" the current script spread over the audio. */
  const transcriber = (store: ChannelStore, ids: { profileId: string; channelId: string; episodeId: string }): Transcriber => async (file) => {
    const s = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
    const words = s!.beats.flatMap((b) => b.text.split(/\s+/));
    const d = await durationOf(file);
    const step = d / words.length;
    return words.map((w, i) => ({ text: w, start: i * step, end: (i + 0.8) * step }));
  };

  it("narrates in blocks, normalizes to −16 LUFS, aligns, and re-records only the new beat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-narration-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const c = await store.createChannel("default", { name: "Canal" });
    const ep = await store.createEpisode("default", c.id, { title: "x" });
    const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
    await saveScript(store, ids, { beats: [
      { section: "gancho", text: "Primeira fala do gancho com seis palavras." },
      { section: "gancho", text: "Segunda fala do gancho aqui." },
      { section: "contexto", text: "Terceira fala já no contexto do vídeo." },
    ] });
    const calls: string[] = [];
    const out = await generateNarration(store, ids, speaker(calls), voice);
    expect(calls).toHaveLength(2);
    expect(out.spentChars).toBeGreaterThan(50);
    expect(out.durationSec).toBeGreaterThan(5);
    const loud = await measureLoudness(out.file);
    expect(Math.abs(loud.lufs + 16)).toBeLessThan(1);
    // Cached blocks: running again narrates nothing.
    await generateNarration(store, ids, speaker(calls), voice);
    expect(calls).toHaveLength(2);

    const aligned = await alignNarration(store, ids, transcriber(store, ids));
    expect(aligned.ratio).toBe(1);
    const s1 = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
    expect(s1!.beats.every((b) => b.timing && b.timing.cut > b.timing.start)).toBe(true);
    expect(s1!.beats[0].timing!.cut).toBeCloseTo(s1!.beats[1].timing!.start - 0.06, 2);

    await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "narration", { status: "ok" });
    await editScript(store, ids, [{ op: "insert", after: "b_001", beat: { section: "gancho", text: "Fala nova curta." } }]);
    const s2 = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
    expect(s2!.beats.find((b) => b.id === "b_004")?.isNew).toBe(true);
    const before = s2!.beats.find((b) => b.id === "b_001")!.timing!;
    const redo = await redoBeats(store, ids, speaker(calls), voice, transcriber(store, ids));
    expect(redo.redone).toEqual(["b_004"]);
    expect(calls.at(-1)).toBe("Fala nova curta.");
    expect(redo.changedBeats).toContain("b_004");
    const s3 = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
    expect(s3!.beats.map((b) => b.id)).toEqual(["b_001", "b_004", "b_002", "b_003"]);
    expect(s3!.beats.every((b) => !b.isNew)).toBe(true);
    expect(s3!.beats[0].timing!.start).toBeCloseTo(before.start, 1);
    // Old beats keep their exact length and move by whole frames: their scenes stay cached.
    for (const id of ["b_001", "b_002", "b_003"]) {
      const a = s2!.beats.find((b) => b.id === id)!.timing!;
      const b = s3!.beats.find((x) => x.id === id)!.timing!;
      if (id !== "b_001") expect(b.cut - b.start).toBeCloseTo(a.cut - a.start, 2);
      const shiftFrames = (b.start - a.start) * 30;
      expect(Math.abs(shiftFrames - Math.round(shiftFrames))).toBeLessThan(0.05);
    }
    expect(redo.changedBeats).toEqual(["b_001", "b_004"]);
    const total = await durationOf(join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "audio", "narracao.wav"));
    expect(total).toBeGreaterThan(out.durationSec);
  }, 120_000);
});
