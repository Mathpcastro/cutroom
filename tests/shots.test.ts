import { describe, expect, it } from "vitest";
import { cleanShotPlan, sanitizeSvg, shotFilmHtml, shotNarration, shotPlanRules } from "../src/shared/shots";

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
