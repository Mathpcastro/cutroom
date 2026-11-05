import { describe, expect, it } from "vitest";
import { brandFromCarrossell, validateBrand } from "../electron/core/brand";

describe("brand", () => {
  it("maps the Carrossell CLI brand, ignoring the masked avatar", () => {
    const brand = brandFromCarrossell({
      profileId: "p1",
      profile: { brand: "Carrossell", brandContext: "Vendo carrosséis.", designKit: "Laranja #ff5a36" },
      brandInfo: {
        name: "Matheus",
        handle: "omatheusdaia",
        avatar: "[imagem]",
        palette: { accent: "#ff5a36", ink: "#000000", paper: "#ffffff", soft: "#f2f0ec" },
      },
    });
    expect(brand).toMatchObject({
      name: "Carrossell",
      handle: "omatheusdaia",
      source: "carrossell",
      profileId: "p1",
      palette: { accent: "#ff5a36", ink: "#000000", paper: "#ffffff", soft: "#f2f0ec" },
    });
    expect(brand.logo).toBeUndefined();
  });
  it("refuses a profile without an approved context and bad manual input", () => {
    expect(() => brandFromCarrossell({ profile: {}, brandInfo: {} })).toThrow(/Contexto da Marca/);
    const manual = {
      name: "Minha marca",
      context: "SaaS de agenda para clínicas.",
      palette: { accent: "#123456", ink: "#000000", paper: "#ffffff" },
      source: "manual",
    };
    expect(validateBrand(manual).name).toBe("Minha marca");
    expect(() => validateBrand({ ...manual, palette: { ...manual.palette, accent: "red" } })).toThrow(/accent/);
    expect(() => validateBrand({ ...manual, fonts: { heading: "Comic Sans" } })).toThrow(/Fonte/);
    expect(() => validateBrand({ ...manual, logo: "https://x/logo.png" })).toThrow(/Logo/);
  });
});
