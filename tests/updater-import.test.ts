import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// electron-updater é CommonJS. O processo principal é empacotado como ESM, e um import nomeado
// derruba o app na abertura ("Named export 'autoUpdater' not found"). Só o app empacotado mostra
// o erro, então o formato do import é travado aqui.
describe("electron-updater no processo principal", () => {
  const source = readFileSync("electron/core/updater.ts", "utf8");

  it("importa pelo export padrão", () => {
    expect(source).toMatch(/import electronUpdater from "electron-updater";/);
  });

  it("não usa import nomeado", () => {
    expect(source).not.toMatch(/import\s*\{[^}]*\}\s*from "electron-updater"/);
  });
});
