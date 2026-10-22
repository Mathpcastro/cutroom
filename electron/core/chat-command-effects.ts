import type { EditCommand, MotionTween, Project } from "../../src/shared/types";
import {
  findChatCommand,
  type ChatCommandOptions,
} from "../../src/shared/chat-commands";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function commandMotion(
  id: string,
  p: Project,
  options: Required<Pick<ChatCommandOptions, "start" | "end">> &
    ChatCommandOptions,
): EditCommand {
  const { start, end } = options,
    d = end - start,
    fade = Math.min(0.35, d * 0.18),
    text = escape(options.text ?? ""),
    sub = escape(options.subtitle ?? ""),
    accent = p.settings.accent;
  const presets: Record<string, string> = {
    titulo: "title",
    identificacao: "lower-third",
    destaque: "highlight",
    etapas: "steps",
    diagrama: "explainer",
    numero: "stat",
  };
  if (presets[id])
    return {
      name: "motion",
      args: {
        start,
        end,
        presetId: presets[id],
        text: options.text,
        subtitle: options.subtitle,
        items: options.items,
        accent,
        mode: ["etapas", "diagrama", "numero"].includes(id)
          ? "fullscreen"
          : "overlay",
      },
    };
  const animations: MotionTween[] = [];
  const add = (
    selector: string,
    time: number,
    duration: number,
    from: MotionTween["from"],
    to: MotionTween["to"],
    ease = "power2.out",
  ) =>
    animations.push({
      selector,
      start: time,
      duration,
      ...(from ? { from } : {}),
      to,
      ease,
    });
  let body = "",
    css = "",
    mode = "overlay";
  const base =
    ".frame{position:absolute;inset:0;color:#fff;font-family:Barlow,sans-serif;display:flex;align-items:center;justify-content:center;padding:8%;box-sizing:border-box}.panel{padding:48px 60px;background:rgba(18,18,22,.94);border:1px solid #48484e;border-radius:24px;max-width:100%;font-size:72px;line-height:1.2} .accent{color:" +
    accent +
    "}.sub{font-size:34px;color:#c6c6cc;margin-top:24px}";
  if (id === "soco-pb") {
    const words = (options.text ?? "AGORA")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3),
      slot = d / words.length;
    body = words
      .map((w, i) => `<div class="impact w${i}">${escape(w)}</div>`)
      .join("");
    css =
      ".impact{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:160px;font-weight:700;text-shadow:0 6px 26px #000;opacity:0;text-align:center;padding:8%}.impact:last-child{color:" +
      accent +
      "}";
    words.forEach((_, i) => {
      add(
        `.w${i}`,
        i * slot,
        Math.min(fade, slot * 0.22),
        { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1 },
      );
      add(
        `.w${i}`,
        i * slot + slot * 0.75,
        Math.min(fade, slot * 0.24),
        undefined,
        { opacity: 0, scale: 1.08 },
      );
    });
  } else if (id === "modo-cinema") {
    css =
      ".cinema{position:absolute;left:12%;right:12%;bottom:18%;text-align:center;font-size:68px;line-height:1.25;letter-spacing:2px;text-shadow:0 3px 14px #000}";
    body = `<div class="cinema">${text}</div>`;
    add(".cinema", 0, fade, { opacity: 0, y: 18 }, { opacity: 1, y: 0 });
    add(".cinema", d - fade, fade, undefined, { opacity: 0 });
  } else if (id === "cortina-cor") {
    body = '<div class="wipe-line"></div>';
    css = `.wipe-line{position:absolute;left:0;top:0;bottom:0;width:5px;background:#fff;box-shadow:0 0 24px 8px ${accent}}`;
    add(".wipe-line", 0, d, { x: 0 }, { x: 1920 }, "linear");
  } else if (id === "prompt-digitando") {
    const characters = Array.from(options.text ?? "").slice(0, 140),
      chunks: string[] = [];
    for (let i = 0; i < characters.length; i += 2)
      chunks.push(characters.slice(i, i + 2).join(""));
    body = `<div class="panel chat"><div class="chat-heading">Você pediu</div><div class="typed">${chunks.map((c, i) => `<span class="char c${i}">${escape(c)}</span>`).join("")}<span class="cursor">│</span></div><div class="ready">✓ PRONTO</div></div>`;
    css = `.chat{position:absolute;left:16%;right:16%;top:22%;font-size:60px}.chat-heading{font-size:27px;color:#aaa;margin-bottom:24px}.typed{white-space:pre-wrap}.char{opacity:0}.cursor{color:${accent}}.ready{color:${accent};font-size:30px;text-align:right;margin-top:32px;opacity:0}`;
    add(".chat", 0, fade, { opacity: 0, y: 36 }, { opacity: 1, y: 0 });
    chunks.forEach((_, i) =>
      add(
        `.c${i}`,
        fade + (i / Math.max(1, chunks.length)) * d * 0.5,
        Math.max(0.001, Math.min(0.025, d * 0.01)),
        { opacity: 0 },
        { opacity: 1 },
        "none",
      ),
    );
    for (let i = 0; i < 5; i++)
      add(
        ".cursor",
        d * 0.08 + i * d * 0.12,
        Math.min(d * 0.05, 0.1),
        undefined,
        { opacity: i % 2 ? 1 : 0 },
        "none",
      );
    add(
      ".ready",
      d * 0.7,
      fade,
      { opacity: 0, scale: 0.9 },
      { opacity: 1, scale: 1 },
    );
    add(".chat", d - fade, fade, undefined, { opacity: 0, y: -14 });
  } else if (id === "lista-check") {
    const items = options.items ?? [];
    body = `<div class="panel list"><div class="list-title">${text}</div>${items.map((item, i) => `<div class="list-row r${i}"><span class="check k${i}">✓</span><span>${escape(item)}</span></div>`).join("")}</div>`;
    css = `.list{position:absolute;left:24%;right:24%;top:16%;font-size:46px}.list-title{font-size:34px;color:#aaa;margin-bottom:24px}.list-row{display:flex;align-items:center;gap:24px;padding:18px 0;border-top:1px solid #3a3a40}.check{color:${accent};font-weight:700;clip-path:inset(0 100% 0 0)}`;
    add(".list", 0, fade, { opacity: 0, y: 30 }, { opacity: 1, y: 0 });
    items.forEach((_, i) => {
      add(
        `.r${i}`,
        fade + (i / Math.max(1, items.length)) * d * 0.55,
        fade,
        { opacity: 0.2 },
        { opacity: 1 },
      );
      add(
        `.k${i}`,
        fade + (i / Math.max(1, items.length)) * d * 0.55,
        fade,
        { clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0% 0 0)" },
      );
    });
    add(".list", d - fade, fade, undefined, { opacity: 0 });
  } else if (id === "citacao") {
    body = `<div class="panel quote"><div class="quote-mark">“</div><div>${text}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    css = `.quote{text-align:center;font-size:76px;border:0;background:rgba(15,15,18,.9)}.quote-mark{font-size:180px;line-height:.65;color:${accent}}`;
    add(".quote", 0, fade, { opacity: 0, y: 25 }, { opacity: 1, y: 0 });
    add(".quote", d - fade, fade, undefined, { opacity: 0 });
  } else if (id === "cta") {
    body = `<div class="panel cta"><div>${text}</div><div class="cta-button">${sub || "Saiba mais"}</div></div>`;
    css = `.cta{text-align:center;font-size:76px}.cta-button{display:inline-block;margin-top:30px;background:${accent};color:#111;font-size:38px;padding:24px 48px;border-radius:18px;font-weight:700}`;
    add(".cta", 0, fade, { opacity: 0, y: 40 }, { opacity: 1, y: 0 });
    add(".cta-button", d * 0.35, fade, { scale: 0.9 }, { scale: 1 });
    add(".cta", d - fade, fade, undefined, { opacity: 0 });
  } else if (id === "barra-progresso") {
    body =
      '<div class="progress-track"><div class="progress-fill"></div></div>';
    css = `.progress-track{position:absolute;left:5%;right:5%;bottom:5%;height:12px;background:rgba(255,255,255,.25);border-radius:10px;overflow:hidden}.progress-fill{height:100%;width:100%;background:${accent};transform-origin:0 50%}`;
    add(".progress-fill", 0, d, { scaleX: 0 }, { scaleX: 1 }, "linear");
  } else if (id === "contador") {
    mode = "fullscreen";
    body = [3, 2, 1]
      .map((n, i) => `<div class="count n${i}">${n}</div>`)
      .join("");
    css = `.count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:320px;font-weight:700;color:${accent};opacity:0}`;
    [0, 1, 2].forEach((i) => {
      const slot = d / 3;
      add(
        `.n${i}`,
        i * slot,
        slot * 0.2,
        { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1 },
      );
      add(`.n${i}`, i * slot + slot * 0.7, slot * 0.29, undefined, {
        opacity: 0,
        scale: 1.2,
      });
    });
  } else throw new Error("Este comando não possui uma animação pronta.");
  return {
    name: "motion",
    args: {
      name: findChatCommand(id)?.label ?? id,
      start,
      end,
      mode,
      background: "#121216",
      accent,
      html: `<style>${base}${css}</style><div class="frame">${body}</div>`,
      animations,
    },
  };
}
