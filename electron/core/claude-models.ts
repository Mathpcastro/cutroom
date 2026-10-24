import type { Connection, ReasoningEffort } from "../../src/shared/types";

const effortOrder: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const clean = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= max &&
  !/[\x00-\x1f]/.test(value)
    ? value.trim()
    : undefined;

/** Version comes from a resolved identifier, never from an assumed alias-to-release table. */
export function claudeModelName(id: string): string {
  const modern =
    /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-|\[|$)/i.exec(id);
  const legacy = /^claude-(\d+)-(\d+)-(opus|sonnet|haiku)(?:-|$)/i.exec(id);
  if (modern)
    return `Claude ${modern[1][0].toUpperCase() + modern[1].slice(1)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ""}${/\[1m\]/i.test(id) ? " · 1M" : ""}`;
  if (legacy)
    return `Claude ${legacy[3][0].toUpperCase() + legacy[3].slice(1)} ${legacy[1]}.${legacy[2]}`;
  return id;
}

/** Only the official running CLI's initialize response supplies available models/capabilities. */
export function mapClaudeModels(value: unknown): Connection["models"] {
  if (!Array.isArray(value))
    throw new Error(
      "A CLI do Claude não informou o catálogo de modelos. Atualize a CLI e reconecte.",
    );
  const seen = new Set<string>();
  const models: Connection["models"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const id = clean(entry.value);
    if (!id || id.startsWith("-") || seen.has(id)) continue;
    seen.add(id);
    const resolved = clean(entry.resolvedModel);
    const display = clean(entry.displayName) || id;
    const description = clean(entry.description, 1000);
    const full = resolved ? claudeModelName(resolved) : undefined;
    const name =
      id === "default" ? `Padrão · ${full || display}` : full || display;
    const supported =
      entry.supportsEffort === true &&
      Array.isArray(entry.supportedEffortLevels)
        ? effortOrder.filter((e) => entry.supportedEffortLevels.includes(e))
        : [];
    const defaultEffort = entry.defaultEffortLevel || entry.defaultEffort;
    models.push({
      id,
      name,
      modelId: resolved,
      description: [
        description,
        !resolved ? "Versão não informada pela CLI." : undefined,
      ]
        .filter(Boolean)
        .join(" "),
      reasoningEfforts: supported,
      defaultReasoningEffort: supported.includes(defaultEffort)
        ? defaultEffort
        : undefined,
      supportsAdaptiveThinking: entry.supportsAdaptiveThinking === true,
      // Claude CLI supports its own multimodal MCP protocol; unknown custom models remain unconfirmed.
      supportsVision: resolved?.startsWith("claude-") || undefined,
    });
  }
  if (!models.length)
    throw new Error(
      "Nenhum modelo foi informado pela CLI do Claude. Atualize a CLI e confira sua configuração.",
    );
  return models;
}
