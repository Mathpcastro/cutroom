import { z } from "zod";
import {
  prepareChatCommand,
  type ChatCommandContext,
  type ChatCommandOptions,
} from "../../src/shared/chat-commands";
import type { Project } from "../../src/shared/types";
import { applyCommand, projectDuration, validateProject } from "./project";
import { commandMotion } from "./chat-command-effects";

export const chatCommandRequest = z
  .object({
    id: z.string().max(80),
    options: z
      .object({
        start: z.number().finite().optional(),
        end: z.number().finite().optional(),
        text: z.string().max(500).optional(),
        subtitle: z.string().max(500).optional(),
        items: z.array(z.string().min(1).max(300)).max(6).optional(),
        amount: z.number().finite().optional(),
      })
      .strict()
      .optional(),
    context: z
      .object({
        time: z.number().finite().min(0).optional(),
        selectedId: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    model: z.string().max(200).optional(),
    reasoningEffort: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
  })
  .strict();
export const resolveChatCommand = prepareChatCommand;
export function applyNativeChatCommand(
  project: Project,
  id: string,
  options: ChatCommandOptions = {},
  context: ChatCommandContext = {},
) {
  const resolved = resolveChatCommand(id, project, options, context),
    { definition } = resolved,
    o = resolved.options;
  id = definition.id;
  let p = validateProject(project);
  const simple: Record<string, Record<string, unknown>> = {
    normalizar: { enabled: true, targetLufs: -14 },
    legendar: { enabled: true, style: { presetId: "clean-phrase" } },
    "legenda-karaoke": { enabled: true, style: { presetId: "karaoke" } },
    "legenda-palavra": { enabled: true, style: { presetId: "word-pop" } },
    "sem-legendas": { enabled: false },
  };
  if (simple[id])
    return applyCommand(p, {
      name: id === "normalizar" ? "normalize" : "captions",
      args: simple[id],
    });
  if (id === "dividir") {
    let offset = 0;
    for (const clip of p.clips) {
      const length = (clip.end - clip.start) / clip.speed;
      if (o.start! > offset + 0.0001 && o.start! < offset + length - 0.0001)
        return applyCommand(p, {
          name: "split",
          args: {
            clipId: clip.id,
            time: clip.start + (o.start! - offset) * clip.speed,
          },
        });
      offset += length;
    }
    throw new Error(
      "Posicione o cursor dentro de um clipe, afastado das bordas, para dividir.",
    );
  }
  const ranged = { start: o.start!, end: o.end! };
  const looks: Record<string, string> = {
    pb: "monochrome",
    "soco-pb": "monochrome",
    "modo-cinema": "cinema",
    "cor-viva": "vivid",
    desfocar: "blur",
    vinheta: "vignette",
    "cortina-cor": "color-wipe",
  };
  if (
    looks[id] ||
    ["zoom", "espelhar", "silenciar", "timelapse", "camera-lenta"].includes(id)
  )
    p = applyCommand(p, {
      name: "clip_style",
      args: {
        ...ranged,
        ...(looks[id] ? { look: looks[id] } : {}),
        ...(id === "soco-pb" ? { factor: 1.2 } : {}),
        ...(id === "zoom" ? { factor: o.amount } : {}),
        ...(id === "espelhar" ? { mirrored: true } : {}),
        ...(id === "silenciar" ? { muted: true } : {}),
        ...(["timelapse", "camera-lenta"].includes(id)
          ? { speed: o.amount, ...(id === "timelapse" ? { muted: true } : {}) }
          : {}),
      },
    });
  if (definition.kind === "motion" || ["soco-pb", "modo-cinema"].includes(id))
    p = applyCommand(p, commandMotion(id, p, { ...o, ...ranged }));
  if (
    p.updatedAt === project.updatedAt &&
    JSON.stringify(p) === JSON.stringify(project)
  )
    throw new Error("Este comando não alterou o projeto.");
  return p;
}
