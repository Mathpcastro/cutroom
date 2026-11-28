import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateUserData, type MigrationFs } from "../electron/core/data-migration";

/**
 * 0.9.6-teste.1 shipped a migration that never ran: main.ts passed app.getPath("userData") as the new
 * folder, which Electron names after package.json "name" ("cutroom"). On Windows %APPDATA%\cutroom is
 * %APPDATA%\CutRoom, so the migration answered "same-path" and the app kept the old folder.
 */
describe("migration wiring in main.ts", () => {
  const main = readFileSync("electron/main.ts", "utf8");

  it("migrates and rolls back into <appData>/Videosell, never into Electron's default userData", () => {
    expect(main).toMatch(/const newUserDataDir = join\(appDataDir, "Videosell"\);/);
    const calls = main.match(/newDir: [^,\n]+/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).toBe("newDir: newUserDataDir");
  });

  it("points the app at the Videosell folder after the migration, and at CutRoom only on fallback", () => {
    expect(main).toContain('if (migration.userDataPath) app.setPath("userData", migration.userDataPath);');
    expect(main).toContain('else if (migration.status !== "skipped") app.setPath("userData", newUserDataDir);');
  });

  it("an old folder differing only in case from the new one is the same folder (why the fix is needed)", () => {
    const fs = { existsSync: () => true } as unknown as MigrationFs;
    const result = migrateUserData({
      fs, path: path.win32, platform: "win32", appDataDir: "C:\\Users\\a\\AppData\\Roaming",
      oldDir: "C:\\Users\\a\\AppData\\Roaming\\CutRoom", newDir: "C:\\Users\\a\\AppData\\Roaming\\cutroom",
      appVersion: "0.9.6", isPackaged: true,
    });
    expect(result.status).toBe("same-path");
  });

  it("the Claude Desktop bridge looks in the Videosell folder first", () => {
    const bridge = readFileSync("tools/cutroom-claude-desktop-bridge.cjs", "utf8");
    expect(bridge).toContain('return [path.join(base, "Videosell"), path.join(base, "CutRoom"), path.join(base, "cutroom")];');
  });
});
