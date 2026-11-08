import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { beforeAll, describe, expect, it } from "vitest";

const pagePath = "site/upsell/index.html";

describe("contrato da página pública de upsell Videosell", () => {
  let html: string;
  let document: ReturnType<typeof parseHTML>["document"];

  beforeAll(async () => {
    html = await readFile(pagePath, "utf8");
    ({ document } = parseHTML(html));
  });

  it("apresenta Videosell, Carrossell e a oferta de pagamento único", () => {
    expect(html).toContain("Videosell");
    expect(html).toContain("Carrossell");
    expect(html).toContain("R$ 97");
    expect(html).toContain("Pagamento único");
  });

  it("preserva os gatilhos e destinos de upsell e downsell da Cakto", () => {
    const upsells = Array.from(
      document.querySelectorAll("[data-cakto-upsell]"),
    );
    const downsells = Array.from(
      document.querySelectorAll("[data-cakto-downsell]"),
    );

    expect(upsells.length).toBeGreaterThan(0);
    expect(downsells.length).toBeGreaterThan(0);
    for (const upsell of upsells) {
      expect(upsell.getAttribute("href")).toBe("#COMPRAR");
    }
    for (const downsell of downsells) {
      expect(downsell.getAttribute("href")).toBe("#RECUSAR");
    }
  });

  it("não promete gratuidade, open source, teste grátis ou garantia de vendas", () => {
    expect(html).not.toMatch(
      /gratuit\w*|gr[áa]tis|open[\s-]*source|teste\s+gr[áa]tis|garantia\s+de\s+vendas?/i,
    );
  });

  it("referencia pelo menos 12 mídias locais e todas existem", async () => {
    const references = Array.from(
      html.matchAll(/\b(?:src|poster)=(["'])(videos\/[^"']+)\1/g),
      (match) => match[2],
    );

    expect(references.length).toBeGreaterThanOrEqual(12);
    await Promise.all(
      references.map((reference) =>
        access(resolve(dirname(pagePath), reference)),
      ),
    );
  });

  it("inclui pelo menos seis comparativos com o original", () => {
    expect(document.querySelectorAll(".orig").length).toBeGreaterThanOrEqual(6);
  });

  it("inclui as duas provas sociais externas", () => {
    expect(html).toContain(
      "https://x.com/finnardley/status/2116010421740007894",
    );
    expect(html).toContain(
      "https://x.com/twoclipping/status/2103835273813496100",
    );
  });

  it("protege cada link externo aberto em nova aba", () => {
    const externalBlankLinks = Array.from(
      document.querySelectorAll("a"),
    ).filter(
      (anchor) =>
        /^https?:\/\//i.test(anchor.getAttribute("href") ?? "") &&
        (anchor.getAttribute("target") ?? "").toLowerCase() === "_blank",
    );

    expect(externalBlankLinks.length).toBeGreaterThan(0);
    for (const anchor of externalBlankLinks) {
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
