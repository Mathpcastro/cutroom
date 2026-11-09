import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { beforeAll, describe, expect, it } from "vitest";

const pagePath = fileURLToPath(
  new URL("../site/upsell/index.html", import.meta.url),
);
const pageDirectory = dirname(pagePath);
const mediaRoot = resolve(pageDirectory, "videos");
const prohibitedClaimPattern =
  /\bgratuit\w*|\bgr[áa]tis\b|\bteste\s+gr[áa]tis\b|\btrial\b|\bopen[\s.-]*source\b|\bgarantias?\s+de\s+vendas?\b|\bvendas?\s+garantidas?\b|\bgarantimos\s+vendas?\b/giu;
const negationBeforeClaim =
  /(?:\bsem(?:\s+(?:um|uma|o|a|nenhum|nenhuma|qualquer))*\s*|\b(?:não|nunca|jamais)(?:\s+(?:um|uma|o|a|é|e|tem|temos|há|oferece|oferecemos|possui|inclui|está|esta|será|sera))*\s*)$/iu;

function localMediaPath(reference: string) {
  const normalized = reference.trim().replace(/^\.\//, "");
  if (!normalized.startsWith("videos/")) return undefined;

  const filePath = resolve(pageDirectory, normalized);
  const pathInsideMediaRoot = relative(mediaRoot, filePath);
  if (
    !pathInsideMediaRoot ||
    pathInsideMediaRoot === ".." ||
    pathInsideMediaRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathInsideMediaRoot)
  ) {
    return undefined;
  }
  return filePath;
}

function cssUrlReferences(css: string) {
  return Array.from(
    css.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^'")]+))\s*\)/gi),
    (match) => (match[2] ?? match[3] ?? "").trim(),
  ).filter((reference) => reference.length > 0);
}

function hasHiddenDeclaration(css: string) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .some((declaration) => {
      const match = declaration.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
      if (!match) return false;
      const property = match[1].toLowerCase();
      const value = match[2]
        .replace(/\s*!important\s*$/i, "")
        .trim()
        .toLowerCase();
      return (
        (property === "display" && value === "none") ||
        (property === "visibility" && value === "hidden")
      );
    });
}

function visibleTextFromHtml(html: string) {
  const { document } = parseHTML(html.replace(/<!--[\s\S]*?-->/g, ""));
  const css = Array.from(
    document.querySelectorAll("style"),
    (style) => style.textContent ?? "",
  ).join("\n");

  document.querySelectorAll("[hidden]").forEach((element) => element.remove());
  document.querySelectorAll("[style]").forEach((element) => {
    if (hasHiddenDeclaration(element.getAttribute("style") ?? "")) {
      element.remove();
    }
  });

  const cssWithoutConditionalHeaders = css.replace(
    /@(?:media|supports|layer|container)\b[^{]*\{/gi,
    "",
  );
  for (const rule of cssWithoutConditionalHeaders.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    if (!hasHiddenDeclaration(rule[2])) continue;
    for (const selector of rule[1].split(",")) {
      try {
        document
          .querySelectorAll(selector.trim())
          .forEach((element) => element.remove());
      } catch {
        // Seletores não suportados pelo parser não tornam texto oculto visível.
      }
    }
  }

  document
    .querySelectorAll("script, style, noscript, template")
    .forEach((element) => element.remove());
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function prohibitedClaims(text: string) {
  const claims: string[] = [];
  for (const match of text.matchAll(prohibitedClaimPattern)) {
    const precedingText = text.slice(
      Math.max(0, (match.index ?? 0) - 80),
      match.index,
    );
    if (!negationBeforeClaim.test(precedingText)) {
      claims.push(match[0]);
    }
  }
  return claims;
}

describe("helpers do contrato de upsell", () => {
  it("rejeita promessas explícitas de gratuidade e vendas garantidas", () => {
    expect(prohibitedClaims("Videosell grátis")).toEqual(["grátis"]);
    expect(prohibitedClaims("vendas garantidas")).toEqual([
      "vendas garantidas",
    ]);
  });

  it("aceita negações e disclaimers honestos", () => {
    expect(prohibitedClaims("Não é grátis.")).toEqual([]);
    expect(prohibitedClaims("Sem garantia de vendas.")).toEqual([]);
  });

  it("remove da oferta e dos termos todo conteúdo oculto", () => {
    const text = visibleTextFromHtml(`
      <!doctype html>
      <html>
        <body>
          <style>
            .hidden { display: none !important; }
            .invisible { visibility: hidden; }
          </style>
          <p>Videosell Carrossell R$ 97 Pagamento único</p>
          <p class="hidden">Videosell grátis</p>
          <p class="invisible">trial</p>
          <p hidden>gratuito</p>
          <p style="display:none">gratis</p>
          <p style="visibility: hidden">vendas garantidas</p>
          <script>open source</script>
          <noscript>gratuita</noscript>
          <template>teste grátis</template>
          <!-- garantia de vendas -->
        </body>
      </html>
    `);

    expect(text).toBe("Videosell Carrossell R$ 97 Pagamento único");
  });
});

describe("contrato da página pública de upsell Videosell", () => {
  let document: ReturnType<typeof parseHTML>["document"];
  let visibleText: string;

  beforeAll(async () => {
    const html = await readFile(pagePath, "utf8");
    ({ document } = parseHTML(html));
    visibleText = visibleTextFromHtml(html);
  });

  it("apresenta Videosell, Carrossell e a oferta de pagamento único", () => {
    expect(visibleText).toContain("Videosell");
    expect(visibleText).toContain("Carrossell");
    expect(visibleText).toContain("R$ 97");
    expect(visibleText).toContain("Pagamento único");
  });

  it("preserva os gatilhos e destinos de upsell e downsell da Cakto", () => {
    const upsells = Array.from(
      document.querySelectorAll('a[data-cakto-upsell][href="#COMPRAR"]'),
    );
    const downsells = Array.from(
      document.querySelectorAll('a[data-cakto-downsell][href="#RECUSAR"]'),
    );
    const comprarLinks = Array.from(
      document.querySelectorAll('a[href="#COMPRAR"]'),
    );
    const recusarLinks = Array.from(
      document.querySelectorAll('a[href="#RECUSAR"]'),
    );

    expect(upsells.length).toBeGreaterThan(0);
    expect(downsells.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("a[data-cakto-upsell]").length).toBe(
      upsells.length,
    );
    expect(document.querySelectorAll("a[data-cakto-downsell]").length).toBe(
      downsells.length,
    );
    for (const anchor of comprarLinks) {
      expect(anchor.hasAttribute("data-cakto-upsell")).toBe(true);
    }
    for (const anchor of recusarLinks) {
      expect(anchor.hasAttribute("data-cakto-downsell")).toBe(true);
    }
  });

  it("não promete gratuidade, open source, teste grátis ou vendas garantidas", () => {
    expect(prohibitedClaims(visibleText)).toEqual([]);
  });

  it("referencia pelo menos 8 mídias locais e todas existem", async () => {
    const domReferences = Array.from(
      document.querySelectorAll("video, source, img"),
    ).flatMap((element) => {
      if (
        (element.tagName === "IMG" || element.tagName === "SOURCE") &&
        element.closest("a.orig")
      ) {
        return [];
      }

      return ["src", "poster", "srcset"].flatMap((attribute) => {
        const value = element.getAttribute(attribute)?.trim();
        if (!value) return [];
        if (attribute !== "srcset") return [value];
        return value
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter((reference) => reference.length > 0);
      });
    });
    const inlineCssReferences = Array.from(
      document.querySelectorAll("[style]"),
    ).flatMap((element) =>
      cssUrlReferences(element.getAttribute("style") ?? ""),
    );
    const stylesheetReferences = Array.from(
      document.querySelectorAll("style"),
    ).flatMap((style) => cssUrlReferences(style.textContent ?? ""));
    const references = [
      ...domReferences,
      ...inlineCssReferences,
      ...stylesheetReferences,
    ];
    const invalidReferences = references.filter(
      (reference) => localMediaPath(reference) === undefined,
    );

    expect(invalidReferences).toEqual([]);
    expect(references.length).toBeGreaterThanOrEqual(8);
    await Promise.all(
      references.map((reference) => access(localMediaPath(reference)!)),
    );
  });

  const viralOriginals = [
    "https://x.com/finnardley/status/2115786060231770351",
    "https://x.com/finnardley/status/2114305886420086817",
    "https://x.com/twoclipping/status/2103835273813496100",
  ];

  it("compara três virais originais com a versão do Videosell e mostra o tour real", async () => {
    const pairs = Array.from(document.querySelectorAll("#comparativo .pair"));
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      expect(pair.querySelector(".viral a.orig")).not.toBeNull();
      expect(pair.querySelector(".ours video[src^='videos/']")).not.toBeNull();
    }
    expect(document.querySelector("#produto-por-dentro")).not.toBeNull();
    const screens = Array.from(
      document.querySelectorAll("#produto-por-dentro img[data-studio-screen]"),
    );
    expect(screens.length).toBeGreaterThanOrEqual(4);
    await Promise.all(
      screens.map((image) =>
        access(localMediaPath(image.getAttribute("src")!)!),
      ),
    );
  });

  it("aponta cada comparativo para o post original no X", () => {
    const originalHrefs = Array.from(
      document.querySelectorAll("a.orig"),
      (anchor) => anchor.getAttribute("href"),
    );
    expect(originalHrefs).toEqual(viralOriginals);
  });

  it("cita fonte para cada exemplo real de vídeo que vende", () => {
    const proofs = Array.from(document.querySelectorAll("#por-que .proof"));
    expect(proofs.length).toBeGreaterThanOrEqual(3);
    for (const proof of proofs) {
      expect(proof.querySelector("a.src")?.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("abre cada link externo em nova aba com proteção", () => {
    const externalLinks = Array.from(document.querySelectorAll("a")).filter(
      (anchor) => /^https?:\/\//i.test(anchor.getAttribute("href") ?? ""),
    );

    expect(externalLinks.length).toBeGreaterThan(0);
    for (const anchor of externalLinks) {
      expect((anchor.getAttribute("target") ?? "").toLowerCase()).toBe(
        "_blank",
      );
      const relTokens = (anchor.getAttribute("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      expect(relTokens).toEqual(
        expect.arrayContaining(["noopener", "noreferrer"]),
      );
    }
  });
});
