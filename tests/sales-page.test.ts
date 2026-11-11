import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sales = readFileSync(resolve("site/videosell/index.html"), "utf8");
const upsell = readFileSync(resolve("site/upsell/index.html"), "utf8");

describe("página de vendas do Videosell (/videosell)", () => {
  it("vende por R$ 147 em pagamento único, sem os ganchos e o preço do upsell", () => {
    expect(sales).toContain("R$ 147");
    expect(sales).toContain("Pagamento único");
    expect(sales).not.toContain("R$ 97");
    expect(sales).not.toContain("data-cakto-");
    expect(sales).not.toMatch(/Compra do .*aprovada/);
  });

  it("todo botão de compra usa o link único do checkout", () => {
    const buy = [...sales.matchAll(/<a class="cta big"[^>]*>/g)].map((m) => m[0]);
    expect(buy.length).toBeGreaterThanOrEqual(2);
    for (const tag of buy) expect(tag).toContain("data-checkout");
    expect(sales).toContain("var CHECKOUT_URL");
  });

  it("usa só mídia que existe na pasta compartilhada", () => {
    const files = [...new Set([...sales.matchAll(/(?:src|poster)="videos\/([^"]+)"/g)].map((m) => m[1]))];
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) expect(existsSync(resolve("site/upsell/videos", file)), file).toBe(true);
  });

  it("o upsell ancora no preço normal", () => {
    expect(upsell).toContain("R$ 147");
    expect(upsell).toContain("R$ 97");
  });
});
