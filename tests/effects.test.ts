import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECTS, effectBox, effectMounts, effectsPrompt, shotEffectSchema } from "../src/shared/effects";
import { cleanShotPlan, shotFilmHtml, shotPlanRules } from "../src/shared/shots";

const REG = join(__dirname, "..", "resources", "film-kit", "hf-registry", "components");
const declared = (name: string) => {
  const html = readFileSync(join(REG, name, `${name}.html`), "utf8");
  const m = /data-composition-variables='([\s\S]*?)'/.exec(html);
  return new Set((m ? (JSON.parse(m[1]) as { id: string }[]) : []).map((v) => v.id));
};

describe("effect catalogue", () => {
  it("lists only registry components and the variables they declare", () => {
    for (const [name, def] of Object.entries(EFFECTS)) {
      const vars = declared(name);
      for (const id of Object.keys(def.vars)) expect(vars.has(id), `${name}.${id}`).toBe(true);
      if (def.cues) expect(vars.has(def.cues), `${name}.${def.cues}`).toBe(true);
      if (def.list) expect(def.vars[def.list], `${name} list`).toBeTruthy();
    }
    expect(Object.keys(EFFECTS).length).toBeGreaterThanOrEqual(30);
  });

  it("goes into the shot rules", () => {
    const rules = shotPlanRules({ width: 1080, height: 1920, story: false, cast: [] });
    expect(rules).toContain("headline-slam");
    expect(rules).toContain(effectsPrompt().split("\n")[1].trim());
  });
});

describe("shot effects", () => {
  it("keeps only the variables an effect declares, as single-line text", () => {
    const fx = shotEffectSchema.parse({ name: "count-up", vars: { end: 312, suffix: "  vendas\n", evil: "<script>", start: 0 }, area: "top", accent: "blue" });
    expect(fx).toEqual({ name: "count-up", vars: { end: 312, suffix: "vendas", start: 0 }, area: "top", accent: "blue" });
    expect(() => shotEffectSchema.parse({ name: "não-existe" })).toThrow();
  });

  it("an effect in the middle clears the engine overlays of that shot", () => {
    const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g></svg>';
    const { plan } = cleanShotPlan({
      title: "t", look: { preset: "interface", palette: ["#7C5CFF", "#22D3EE"] }, sets: [{ id: "a", svg }],
      shots: [
        { say: "um dois três", set: "a", effect: { name: "headline-slam", vars: { text: "Pare de gravar" } }, ui: { kind: "reveal", text: "x" }, graphic: { kind: "stat", value: 3 } },
        { say: "quatro cinco", set: "a", effect: { name: "inexistente" }, ui: { kind: "reveal", text: "y" } },
        { say: "seis sete", set: "a", effect: { name: "trust-strip", vars: { marks: "A, B, C" } }, ui: { kind: "reveal", text: "z" } },
      ],
    });
    expect(plan.shots[0].effect?.name).toBe("headline-slam");
    expect(plan.shots[0].ui).toBeUndefined();
    expect(plan.shots[0].graphic).toBeUndefined();
    expect(plan.shots[1].effect).toBeUndefined();
    expect(plan.shots[1].ui?.kind).toBe("reveal");
    expect(plan.shots[2].ui?.kind).toBe("reveal");
  });

  it("mounts each effect for its shot, with cues spread across it", () => {
    const shots = [
      {},
      { effect: shotEffectSchema.parse({ name: "grid-card-assemble", vars: { items: "Roteiro, Voz, Animação" } }) },
      { effect: shotEffectSchema.parse({ name: "chat-thread", vars: { contact: "Ana", messages: "recv:oi|sent:olá" } }) },
    ];
    const timed = [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 8.5 }];
    const html = effectMounts(shots, timed, { width: 1920, height: 1080, panel: "rgba(14,15,26,0.9)" });
    // Landscape-only effects stay out of vertical films.
    expect(effectMounts(shots, timed, { width: 1080, height: 1920, panel: "#000" })).not.toContain("grid-card-assemble");
    expect(html).toContain('data-composition-src="compositions/components/grid-card-assemble.html"');
    expect(html).toContain('data-start="2.00" data-duration="3.00"');
    const vars = JSON.parse(/data-variable-values='([^']*)'/.exec(html)![1]);
    expect(vars.cues.split(",")).toHaveLength(3);
    expect(html).toContain(`height:${effectBox("full", 1920, 1080).height}px`);
    expect(html).toContain("border-radius:0px");
    expect(html).not.toMatch(/<script/);
  });

  it("the film carries the look tokens and the mounts", () => {
    const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g></svg>';
    const { plan } = cleanShotPlan({ title: "t", look: { preset: "rabisco", palette: ["#222222", "#E4572E"], paper: "#FAF7F0", accent: "#E4572E" }, sets: [{ id: "a", svg }], shots: [{ say: "oi", set: "a" }] });
    const html = shotFilmHtml({ plan, duration: 4, voiceDuration: 3, effects: '<div id="fx-1-confetti" class="clip"></div>' });
    expect(html).toContain("--brand: #E4572E");
    expect(html).toContain("--font-display: 'Caveat', cursive");
    expect(html).toContain("--fg: #");
    expect(html).toContain('<div id="fx-1-confetti" class="clip"></div>');
  });
});
