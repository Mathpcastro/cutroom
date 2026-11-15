import { describe, expect, it } from "vitest";
import { MUSIC_TEMPO } from "../electron/core/compose-music";
import { MUSIC_BPM, cleanShotPlan, cueTime, sanitizeSvg, shotFilmHtml, shotNarration, shotPlanRules } from "../src/shared/shots";

const set = (inner: string, box = "0 0 1080 1920") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${inner}</svg>`;

describe("sanitizeSvg", () => {
  it("keeps drawing elements, depth layers and gradients", () => {
    const out = sanitizeSvg(set('<defs><linearGradient id="c"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g data-depth="0"><rect x="0" y="0" width="1080" height="900" fill="url(#c)"/></g><g data-depth="1"><path d="M0 1500 L1080 1500 L1080 1920Z" fill="#334455"/></g>'))!;
    expect(out).toContain('<linearGradient id="c">');
    expect(out).toContain('<g data-depth="0">');
    expect(out).toContain('fill="url(#c)"');
    expect(out).toContain('<path d="M0 1500 L1080 1500 L1080 1920Z" fill="#334455"/>');
  });

  it("removes scripts, event handlers, text, images and external references", () => {
    const out = sanitizeSvg(set('<script>alert(1)</script><rect width="10" height="10" onclick="x()" fill="red"/><text x="1">oi</text><image href="http://evil/x.png"/><use href="http://evil/#a"/><rect width="5" height="5" fill="url(http://evil)"/><foreignObject><div>x</div></foreignObject><circle r="4" style="fill:red;background:url(x)"/>'))!;
    expect(out).not.toMatch(/script|onclick|<text|<image|evil|foreignObject|<div|background/);
    expect(out).toContain('<rect width="10" height="10" fill="red"/>');
    expect(out).toContain('<circle r="4"/>');
  });

  it("allows kit symbols with colour variables only", () => {
    const out = sanitizeSvg(set('<use href="#kit-tree" x="10" y="20" width="200" height="260" style="--a:#123456;--b:#abc;color:red;--z:#fff"/><use xlink:href="#kit-sun" width="9" height="9"/>'))!;
    expect(out).toContain('<use href="#kit-tree" x="10" y="20" width="200" height="260" style="--a:#123456;--b:#abc"/>');
    expect(out).toContain('<use href="#kit-sun"');
  });

  it("keeps element names for cues and the camera", () => {
    const out = sanitizeSvg(set('<g data-depth="1"><g data-el="cartao" data-motion="pop"><rect width="9" height="9"/></g><g data-el="1bad"><circle r="3"/></g></g>'))!;
    expect(out).toContain('data-el="cartao"');
    expect(out).not.toContain("1bad");
  });

  it("keeps living-element marks and drops unknown motions", () => {
    const out = sanitizeSvg(set('<g data-depth="1"><g data-motion="float" data-delay="0.4"><rect width="9" height="9"/></g><g data-motion="explode" data-delay="99"><circle r="3"/></g></g>'))!;
    expect(out).toContain('<g data-motion="float" data-delay="0.4">');
    expect(out).not.toMatch(/explode|data-delay="99"/);
  });

  it("does not let a drawing redefine engine ids", () => {
    const out = sanitizeSvg(set('<g id="kit-tree"><rect width="9" height="9" id="crsBoil"/></g>'))!;
    expect(out).not.toMatch(/id="(?:kit-|crs)/);
  });

  it("drops nested svg tags but keeps the layer structure", () => {
    const out = sanitizeSvg(set('<g data-depth="0"><svg><rect width="1" height="1"/></svg><circle r="3"/></g>'))!;
    expect(out).toContain('<g data-depth="0"><rect width="1" height="1"/><circle r="3"/></g>');
  });

  it("rejects empty or oversized drawings", () => {
    expect(sanitizeSvg(set("<g></g>"))).toBeUndefined();
    expect(sanitizeSvg("<div>nada</div>")).toBeUndefined();
    expect(sanitizeSvg(set('<rect width="1" height="1"/>'.repeat(4000)), 2000)).toBeUndefined();
  });
});

const plan = {
  title: "Teste",
  look: { preset: "pixel", palette: ["#112233", "#445566", "#778899"] },
  sets: [{ id: "rua", svg: set('<rect width="1080" height="1920" fill="#123"/>') }, { id: "ruim", svg: "<div/>" }],
  props: [{ id: "barco", svg: set('<path d="M0 0 L10 10Z" fill="#fff"/>', "0 0 100 100") }],
  shots: [
    { say: "Primeira frase", set: "rua", camera: { move: "zoom-maluco" }, props: [{ id: "barco", x: 1, y: 2 }, { id: "sumiu", x: 1, y: 1 }] },
    { say: "Segunda frase!", set: "ruim", fx: ["chuva"], transition: "explosao", cast: [{ who: "Bia", x: 500, y: 1700, pose: "dançando" }] },
  ],
};

describe("cleanShotPlan", () => {
  it("sanitises drawings, remaps shots to valid sets and drops unknown props", () => {
    const { plan: p, dropped } = cleanShotPlan(plan);
    expect(dropped).toEqual(["cenário ruim"]);
    expect(p.sets.map((s) => s.id)).toEqual(["rua"]);
    expect(p.shots[1].set).toBe("rua");
    expect(p.shots[0].props.map((x) => x.id)).toEqual(["barco"]);
    expect(p.shots[0].camera.move).toBe("wide");
    expect(p.shots[1].transition).toBe("cut");
    expect(p.shots[1].fx).toEqual([]);
    expect(p.shots[1].cast[0].pose).toBeUndefined();
  });

  it("fails when no set survives", () => {
    expect(() => cleanShotPlan({ ...plan, sets: [{ id: "ruim", svg: "<div>xx</div>xxxxxxxxxxxxxxxxxxx" }] })).toThrow(/cenário/);
  });

  it("joins the narration in order with sentence endings", () => {
    expect(shotNarration(cleanShotPlan(plan).plan)).toBe("Primeira frase. Segunda frase!");
  });
});

describe("shotFilmHtml", () => {
  it("embeds the plan safely and loads the shot engine", () => {
    const { plan: p } = cleanShotPlan({ ...plan, title: "</template><script>x</script>" });
    const html = shotFilmHtml({ plan: p, duration: 12, voiceDuration: 10, cast: { Bia: "companion", Eu: "film" }, hasFilmAvatar: true, music: { file: "assets/musica.wav" } });
    expect(html).not.toContain("</template><script>x");
    expect(html).toContain('src="kit/cutroom-shots.js"');
    expect(html).toContain('"Bia": S.companion');
    expect(html).toContain('"Eu": window.FILM_AVATAR || S.strategist');
    expect(html).toContain('src="assets/musica.wav"');
    expect(html).toContain('data-duration="12"');
  });

  it("describes the looks, the kit and the cast in the rules", () => {
    const rules = shotPlanRules({ width: 1080, height: 1920, story: true, cast: ["Léo", "Bia"], look: "aquarela sonhadora" });
    expect(rules).toContain("aquarela sonhadora");
    expect(rules).toContain("kit-NOME");
    expect(rules).toContain("Léo, Bia");
    expect(rules).toContain('data-depth="0"');
  });
});

describe("lenient AI plans", () => {
  it("trims crowds, extra props and long texts instead of failing", () => {
    const crowd = Array.from({ length: 9 }, (_, i) => ({ who: `Cliente ${i}`, x: 100 * i, y: 1700 }));
    const { plan: p } = cleanShotPlan({
      ...plan,
      title: "x".repeat(300),
      look: { preset: "aquarela", palette: ["#112233", "azul", "#445566", "#778899"], description: "d".repeat(500) },
      shots: [{ say: "Fila de clientes", set: "rua", cast: [...crowd, null], fx: ["rain", "nope", "snow", "dust", "stars"] }],
    });
    expect(p.title).toHaveLength(100);
    expect(p.look.palette).toEqual(["#112233", "#445566", "#778899"]);
    expect(p.shots[0].cast).toHaveLength(5);
    expect(p.shots[0].fx).toEqual(["rain", "snow"]);
  });
});

import { readFileSync } from "node:fs";
import { graphicTimes, soundCues, timeShots } from "../src/shared/shots";

describe("graphics, characters and sound cues", () => {
  const base = { title: "x", look: { preset: "rabisco", palette: ["#112233", "#445566"] }, sets: [{ id: "loja", ambience: "cafe", svg: set('<rect width="9" height="9"/>') }, { id: "rua", ambience: "barulho", svg: set('<rect width="9" height="9"/>') }] };

  it("keeps graphics, ambience and the character style; trims bad values instead of failing", () => {
    const { plan: p } = cleanShotPlan({
      ...base, characters: "palito",
      shots: [
        { say: "Um dois três", set: "loja", graphic: { kind: "checklist", title: "Passos", items: [{ label: "A" }, { label: "B" }, null, { label: "C" }, { label: "D" }, { label: "E" }, { label: "F" }] } },
        { say: "Quatro cinco", set: "rua", graphic: { kind: "grafico-maluco" } },
        { say: "Seis", set: "loja", graphic: { kind: "stat", value: 97, prefix: "R$ ", label: "por mês" } },
      ],
    });
    expect(p.characters).toBe("palito");
    expect(p.sets.map((x) => (x as { ambience?: string }).ambience)).toEqual(["cafe", undefined]);
    expect(p.shots[0].graphic?.items.map((i) => i.label)).toEqual(["A", "B", "C", "D"]);
    expect(p.shots[1].graphic).toBeUndefined();
    expect(p.shots[2].graphic).toMatchObject({ kind: "stat", value: 97, prefix: "R$ " });
  });

  it("times shots exactly like the engine (CRS.timeShots)", () => {
    const w = globalThis as unknown as { window?: Record<string, unknown>; document?: unknown };
    w.window = {}; w.document = {};
    // eslint-disable-next-line no-new-func
    new Function(readFileSync("resources/film-kit/cutroom-shots.js", "utf8"))();
    const engine = (w.window as { CRS: { timeShots: typeof timeShots } }).CRS;
    const shots = [{ say: "Olá, tudo bem?" }, { say: "" }, { say: "Hoje vamos falar de vendas." }, { say: "Fim." }];
    const words = ["Olá,", "tudo", "bem?", "Hoje", "vamos", "falar", "de", "vendas.", "Fim."].map((text, i) => ({ text, start: 0.3 + i * 0.4, end: 0.6 + i * 0.4 }));
    for (const ws of [words, words.slice(0, 7), []]) expect(timeShots(shots, ws, 5)).toEqual(engine.timeShots(shots, ws, 5));
    expect(graphicTimes(3, 1, 4)).toEqual([1.25, 2.05, 2.8499999999999996]);
  });

  it("spots sound only where something happens, and lays the place's ambience under it", () => {
    const { plan: p } = cleanShotPlan({
      ...base,
      shots: [
        { say: "Um dois", set: "loja", text: { kind: "title", content: "Oi" } },
        { say: "três quatro", set: "loja", transition: "whip", graphic: { kind: "notifications", items: [{ label: "Pedido" }, { label: "Pedido" }] } },
        { say: "cinco seis", set: "rua", cast: [{ who: "Ana", x: 500, y: 1600, enter: "drop" }], fx: ["rain"] },
        { say: "sete", set: "rua" },
      ],
    });
    const words = "Um dois três quatro cinco seis sete".split(" ").map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const { cues, ambience } = soundCues(p, words, 5);
    const kinds = cues.map((c) => c.kind);
    expect(kinds).toContain("impact");
    expect(kinds).toContain("whoosh");
    expect(kinds.filter((k) => k === "ding")).toHaveLength(2);
    expect(kinds).toContain("thud");
    expect(cues.every((c, i) => i === 0 || c.t >= cues[i - 1].t)).toBe(true);
    expect(ambience.map((a) => a.kind)).toEqual(["cafe", "chuva"]);
    expect(ambience[0]).toMatchObject({ from: 0 });
  });

  it("builds landscape films and the sound track tag", () => {
    const { plan: p } = cleanShotPlan({ ...base, shots: [{ say: "Oi", set: "loja" }] });
    const html = shotFilmHtml({ plan: p, duration: 4, voiceDuration: 3, width: 1920, height: 1080, sfx: { file: "assets/sfx.wav" } });
    expect(html).toContain('data-width="1920" data-height="1080"');
    expect(html).toContain('src="assets/sfx.wav"');
    expect(shotPlanRules({ width: 1920, height: 1080, story: false, cast: [] })).toContain("paisagem 16:9");
  });
});

describe("Motion UI components", () => {
  const base = { title: "x", look: { preset: "interface", palette: ["#7C5CFF", "#22D3EE"] }, sets: [{ id: "fundo", svg: set('<rect width="9" height="9"/>') }] };
  it("keeps valid components and drops unknown ones without failing the plan", () => {
    const { plan: p } = cleanShotPlan({ ...base, shots: [
      { say: "Um", set: "fundo", ui: { kind: "chat", text: "Loja", items: [{ label: "Oi" }, { label: "Olá" }] } },
      { say: "Dois", set: "fundo", ui: { kind: "hologram" } },
      { say: "Três", set: "fundo", ui: { kind: "click", button: "Gerar Reels", items: [{ label: "Pronto!" }] } },
    ] });
    expect(p.look.preset).toBe("interface");
    expect(p.shots[0].ui?.items.map((i) => i.label)).toEqual(["Oi", "Olá"]);
    expect(p.shots[1].ui).toBeUndefined();
    expect(p.shots[2].ui).toMatchObject({ kind: "click", button: "Gerar Reels" });
  });
  it("spots the UI sounds: the click, the chat pops, the island dings", () => {
    const { plan: p } = cleanShotPlan({ ...base, shots: [
      { say: "um dois", set: "fundo", ui: { kind: "click", button: "Ir" } },
      { say: "três quatro", set: "fundo", ui: { kind: "island", items: [{ label: "Pedido" }] } },
    ] });
    const words = "um dois três quatro".split(" ").map((text, i) => ({ text, start: i * 0.8, end: i * 0.8 + 0.5 }));
    const kinds = soundCues(p, words, 4).cues.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["click", "chime", "ding"]));
  });
  it("loads the Fluid core before the engine", () => {
    const { plan: p } = cleanShotPlan({ ...base, shots: [{ say: "Oi", set: "fundo" }] });
    const html = shotFilmHtml({ plan: p, duration: 3, voiceDuration: 2 });
    expect(html.indexOf("kit/fluid-motion.js")).toBeGreaterThan(-1);
    expect(html.indexOf("kit/fluid-motion.js")).toBeLessThan(html.indexOf("kit/cutroom-shots.js"));
  });
});

describe("product-only sales films", () => {
  const base = { title: "x", look: { preset: "interface", palette: ["#7C5CFF", "#22D3EE"] }, sets: [{ id: "fundo", svg: set('<rect width="9" height="9"/>') }] };
  it("keeps 'nenhum' as the character style and the device chosen for a proof", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { plan: p } = cleanShotPlan({ ...base, characters: "nenhum", shots: [{ say: "Oi", set: "fundo", proof: id, proofStyle: "phone" }, { say: "Tchau", set: "fundo", proof: id, proofStyle: "tablet" }] });
    expect(p.characters).toBe("nenhum");
    expect(p.shots[0]).toMatchObject({ proof: id, proofStyle: "phone" });
    expect(p.shots[1].proofStyle).toBeUndefined();
  });
  it("tells the AI to make the product the protagonist when there are no characters", () => {
    const rules = shotPlanRules({ width: 1080, height: 1920, story: false, cast: [], characters: "nenhum" });
    expect(rules).toContain("O produto é o protagonista");
    expect(rules).toContain('"phone"');
  });
});

describe("word choreography", () => {
  const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g><g data-depth="1"><g data-el="cartao" data-motion="pop"><rect x="100" y="100" width="200" height="120"/></g></g></svg>';
  it("finds the moment a cue word is spoken, ignoring accents and case", () => {
    const words = [{ text: "Você", start: 1, end: 1.2 }, { text: "paga", start: 1.3, end: 1.5 }, { text: "por", start: 1.6, end: 1.7 }, { text: "Pix.", start: 1.8, end: 2 }];
    expect(cueTime("pix", words, 1)).toBe(1.8);
    expect(cueTime("VOCE agora", words, 1)).toBe(1);
    expect(cueTime("cartão", words, 1)).toBe(1.25);
  });
  it("plans cues, camera targets, follow and glide, and sounds a pop on each cue", () => {
    const { plan } = cleanShotPlan({
      title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }],
      shots: [{ say: "Você paga por Pix", set: "a", camera: { move: "follow", target: "cartao" }, transition: "glide", cues: [{ el: "cartao", at: "Pix" }, null, { el: "9x", at: "a" }] }],
    });
    const shot = plan.shots[0];
    expect(shot.camera).toMatchObject({ move: "follow", target: "cartao" });
    expect(shot.transition).toBe("glide");
    expect(shot.cues).toEqual([{ el: "cartao", at: "Pix" }]);
    const words = [{ text: "Você", start: 0.2, end: 0.4 }, { text: "paga", start: 0.5, end: 0.7 }, { text: "por", start: 0.8, end: 0.9 }, { text: "Pix", start: 1, end: 1.3 }];
    expect(soundCues(plan, words, 3).cues).toContainEqual({ t: 1, kind: "pop", gain: 0.5 });
  });
});

describe("music, hierarchy and interface inside elements", () => {
  const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g><g data-depth="1"><g data-el="celular" data-motion="float"><rect x="300" y="400" width="480" height="960"/></g></g></svg>';
  it("knows the tempo the composer uses for each mood", () => {
    expect(MUSIC_BPM).toEqual(MUSIC_TEMPO);
  });
  it("passes the beat to the engine when the film has music, and keeps ui.on", () => {
    const { plan } = cleanShotPlan({ title: "t", music: { mood: "alegre" }, look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }], shots: [{ say: "oi", set: "a", ui: { kind: "chat", on: "celular", items: [{ label: "Oi" }] } }] });
    expect(plan.shots[0].ui?.on).toBe("celular");
    expect(shotFilmHtml({ plan, duration: 4, voiceDuration: 3 })).toContain("beat: { bpm: 112 }");
    const { plan: quiet } = cleanShotPlan({ title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }], shots: [{ say: "oi", set: "a" }] });
    expect(shotFilmHtml({ plan: quiet, duration: 4, voiceDuration: 3 })).not.toContain("beat:");
  });
});

describe("effects recreated from the reference libraries", () => {
  it("accepts the split-flap board, the network graph, tilt, liquid, aurora and ripples", () => {
    const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g><g data-depth="1"><g data-el="cartao" data-motion="tilt"><rect width="9" height="9"/></g></g></svg>';
    const { plan } = cleanShotPlan({
      title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }],
      shots: [
        { say: "a", set: "a", fx: ["aurora", "ripple"], ui: { kind: "flap", text: "Hoje por", items: [{ label: "R$ 97" }] } },
        { say: "b", set: "a", transition: "liquid", ui: { kind: "network", text: "Videosell", items: [{ label: "Voz" }, { label: "Roteiro" }] } },
      ],
    });
    expect(plan.shots[0].fx).toEqual(["aurora", "ripple"]);
    expect(plan.shots[0].ui?.kind).toBe("flap");
    expect(plan.shots[1].transition).toBe("liquid");
    expect(plan.shots[1].ui?.kind).toBe("network");
    expect(plan.sets[0].svg).toContain('data-motion="tilt"');
  });
});
