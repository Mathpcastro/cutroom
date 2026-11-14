import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECTS, effectBox, effectMounts, effectsPrompt, shotEffectSchema } from "../src/shared/effects";
import { adaptEffects, cleanShotPlan, shotFilmHtml, shotPlanRules } from "../src/shared/shots";

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
    expect(rules).toContain("marker-highlight");
    expect(rules).toContain("ui \"reveal\" em no máximo 3 tomadas");
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

  it("falls back to the engine when a line is too long or a number has decimals", () => {
    const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g></svg>';
    const { plan } = cleanShotPlan({
      title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }],
      shots: [
        { say: "a", set: "a", effect: { name: "per-word-rise", vars: { text: "Chega de procurar e não achar" } } },
        { say: "b", set: "a", effect: { name: "per-word-rise", vars: { text: "Sem gravar" } } },
        { say: "c", set: "a", effect: { name: "count-up", vars: { start: 0, end: 4.9 } } },
        { say: "d", set: "a", effect: { name: "count-up", vars: { start: 0, end: 1200, suffix: "+" } } },
        { say: "e", set: "a", effect: { name: "count-up", vars: { start: 0, end: 1200, prefix: "Mais de ", suffix: " pedidos" } } },
      ],
    });
    expect(plan.shots[0].effect).toBeUndefined();
    expect(plan.shots[0].ui).toMatchObject({ kind: "reveal", text: "Chega de procurar e não achar" });
    expect(plan.shots[1].effect?.name).toBe("per-word-rise");
    const { plan: cta } = cleanShotPlan({ title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }], shots: [{ say: "a", set: "a", effect: { name: "cta-close", vars: { action_line: "Compre hoje com frete grátis", button_label: "Pedir" } } }, { say: "b", set: "a", effect: { name: "cta-close", vars: { action_line: "Compre hoje", button_label: "Pedir" } } }] });
    expect(cta.shots[0].ui).toMatchObject({ kind: "reveal", text: "Compre hoje com frete grátis" });
    expect(cta.shots[1].effect?.name).toBe("cta-close");
    expect(plan.shots[2].graphic).toMatchObject({ kind: "stat", value: 4.9 });
    expect(plan.shots[3].effect?.name).toBe("count-up");
    expect(plan.shots[4].graphic).toMatchObject({ kind: "stat", value: 1200, prefix: "Mais de ", suffix: " pedidos" });
  });

  it("a landscape-only effect becomes kinetic text in a vertical film", () => {
    const svg = '<svg viewBox="0 0 1080 1920"><g data-depth="0"><rect width="1080" height="1920" fill="#123"/></g></svg>';
    const { plan } = cleanShotPlan({ title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }], shots: [{ say: "a", set: "a", effect: { name: "pull-back-reveal", vars: { detail_text: "4,9", headline: "Bonita ou barata?" } } }] });
    expect(adaptEffects(plan, 1920, 1080).shots[0].effect?.name).toBe("pull-back-reveal");
    const tall = adaptEffects(plan, 1080, 1920).shots[0];
    expect(tall.effect).toBeUndefined();
    expect(tall.ui).toMatchObject({ kind: "reveal", text: "Bonita ou barata?" });
    // Retired effects become kinetic text in any format.
    const { plan: old } = cleanShotPlan({ title: "t", look: { preset: "interface", palette: ["#007AFF", "#34C759"] }, sets: [{ id: "a", svg }], shots: [{ say: "a", set: "a", effect: { name: "headline-slam", vars: { text: "E lá se foram horas" } } }] });
    expect(adaptEffects(old, 1920, 1080).shots[0].ui).toMatchObject({ kind: "reveal", text: "E lá se foram horas" });
    expect(shotPlanRules({ width: 1920, height: 1080, story: false, cast: [] })).not.toContain("headline-slam");
  });

  it("mounts each effect for its shot, with cues spread across it", () => {
    const shots = [
      {},
      { effect: shotEffectSchema.parse({ name: "constellation-hub", vars: { hub_label: "Videosell", nodes: "Roteiro, Voz, Animação" } }) },
      { effect: shotEffectSchema.parse({ name: "chat-thread", vars: { contact: "Ana", messages: "recv:oi|sent:olá" } }) },
    ];
    const timed = [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 8.5 }];
    const html = effectMounts(shots, timed, { width: 1920, height: 1080, panel: "rgba(14,15,26,0.9)" });
    // Landscape-only effects stay out of vertical films.
    expect(effectMounts(shots, timed, { width: 1080, height: 1920, panel: "#000" })).not.toContain("constellation-hub");
    expect(html).toContain('data-composition-src="compositions/components/constellation-hub.html"');
    expect(html).toContain('data-start="2.00" data-duration="3.00"');
    const vars = JSON.parse(/data-variable-values='([^']*)'/.exec(html)![1]);
    expect(vars.cues.split(",")).toHaveLength(3);
    expect(html).toContain(`height:${effectBox("full", 1920, 1080).height}px`);
    expect(html).toContain("border-radius:0px");
    // A full-screen scene stays full screen even when the plan asked for a strip.
    const forced = effectMounts([{ effect: shotEffectSchema.parse({ name: "notes-typing", vars: { title: "Oi" }, area: "top" }) }], [{ start: 0, end: 3 }], { width: 1080, height: 1920, panel: "#fff" });
    expect(forced).toContain(`height:${effectBox("full", 1080, 1920).height}px`);
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
