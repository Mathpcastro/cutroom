import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const pagePath = "site/upsell/index.html";

describe("contrato da página pública de upsell Videosell", () => {
  let html: string;

  beforeAll(async () => {
    html = await readFile(pagePath, "utf8");
  });

  it("apresenta Videosell, Carrossell e a oferta de pagamento único", () => {
    expect(html).toContain("Videosell");
    expect(html).toContain("Carrossell");
    expect(html).toContain("R$ 97");
    expect(html).toContain("Pagamento único");
  });

  it("preserva os gatilhos e destinos de upsell e downsell da Cakto", () => {
    expect(html).toContain("data-cakto-upsell");
    expect(html).toContain("data-cakto-downsell");
    expect(html).toContain('href="#COMPRAR"');
    expect(html).toContain('href="#RECUSAR"');
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
    expect(html.match(/class="orig"/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("inclui as duas provas sociais externas", () => {
    expect(html).toContain(
      "https://x.com/finnardley/status/2116010421740007894",
    );
    expect(html).toContain(
      "https://x.com/twoclipping/status/2103835273813496100",
    );
  });

  it("abre links externos com proteção contra opener e referrer", () => {
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
