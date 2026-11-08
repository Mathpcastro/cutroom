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

describe("contrato da página pública de upsell Videosell", () => {
  let document: ReturnType<typeof parseHTML>["document"];
  let visibleText: string;

  beforeAll(async () => {
    const html = await readFile(pagePath, "utf8");
    ({ document } = parseHTML(html));

    const { document: visibleDocument } = parseHTML(html);
    visibleDocument
      .querySelectorAll("script, style, noscript, template")
      .forEach((element) => element.remove());
    visibleText = (visibleDocument.body.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
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
    expect(visibleText).not.toMatch(
      /gratuit\w*|open[\s.-]*source|teste\s+gr[áa]tis|garantia\s+de\s+vendas?|vendas?\s+garantidas?|garantimos\s+vendas?|\btrial\b/i,
    );
  });

  it("referencia pelo menos 12 mídias locais e todas existem", async () => {
    const domReferences = Array.from(
      document.querySelectorAll("video, source, img"),
    ).flatMap((element) => {
      if (element.tagName === "IMG" && element.closest("a.orig")) return [];

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
      element.closest("a.orig")
        ? []
        : cssUrlReferences(element.getAttribute("style") ?? ""),
    );
    const stylesheetReferences = Array.from(
      document.querySelectorAll("style"),
    ).flatMap((style) =>
      Array.from(
        (style.textContent ?? "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
      ).flatMap((rule) =>
        rule[1].includes(".orig") ? [] : cssUrlReferences(rule[2]),
      ),
    );
    const references = [
      ...domReferences,
      ...inlineCssReferences,
      ...stylesheetReferences,
    ];
    const invalidReferences = references.filter(
      (reference) => localMediaPath(reference) === undefined,
    );

    expect(invalidReferences).toEqual([]);
    expect(references.length).toBeGreaterThanOrEqual(12);
    await Promise.all(
      references.map((reference) => access(localMediaPath(reference)!)),
    );
  });

  it("inclui pelo menos seis comparativos com o original", () => {
    const originalLinks = Array.from(document.querySelectorAll("a.orig"));

    expect(originalLinks.length).toBeGreaterThanOrEqual(6);
    for (const anchor of originalLinks) {
      expect(anchor.getAttribute("href")).toMatch(/^https?:\/\//i);
    }
  });

  it("inclui as duas provas sociais externas", () => {
    const originalHrefs = Array.from(
      document.querySelectorAll("a.orig"),
      (anchor) => anchor.getAttribute("href"),
    );

    expect(originalHrefs).toContain(
      "https://x.com/finnardley/status/2116010421740007894",
    );
    expect(originalHrefs).toContain(
      "https://x.com/twoclipping/status/2103835273813496100",
    );
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
