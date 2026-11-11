import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editorThemeFor, resolveStudioTheme } from "../src/components/studio/studioTheme";

describe("studio theme", () => {
  it("resolves Automático from the system and keeps explicit choices", () => {
    expect(resolveStudioTheme("auto", true)).toBe("dark");
    expect(resolveStudioTheme("auto", false)).toBe("light");
    expect(resolveStudioTheme("dark", false)).toBe("dark");
    expect(resolveStudioTheme("light", true)).toBe("light");
  });

  it("moves the editor along only when it uses a default theme", () => {
    expect(editorThemeFor("dark", null)).toBe("graphite");
    expect(editorThemeFor("light", "graphite")).toBe("light");
    expect(editorThemeFor("dark", "nord")).toBeNull();
  });

  it("keeps literal colours out of the themed studio surfaces", () => {
    const css = readFileSync("src/components/studio/studio.css", "utf8").replace(/\r\n/g, "\n");
    // Dark chrome (sidebar/top bar), media, avatar canvas and token blocks may use literal colours.
    const allowed = /reel-reference-frames img|mp4-player|videosell-studio(\[data-studio-theme="dark"\])?\s*$|studio-sidebar|profile-|studio-nav|studio-brand|studio-font-scale|studio-language|studio-return-button|studio-topbar|studio-appearance|studio-advanced-button|studio-connection|studio-local-note|avatar-|reel-review-still|modal-backdrop|video|primary-button|reel-pilot|-dark|::selection/;
    const offenders: string[] = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (allowed.test(selector) || selector.startsWith("@")) continue;
      for (const decl of rule[2].matchAll(/(background|border[a-z-]*|(?<![a-z-])color)\s*:\s*([^;]*#[0-9a-f]{3,8}[^;]*);/gi)) {
        if (/^color$/i.test(decl[1]) && /#fff(fff)?\b/i.test(decl[2])) continue; // white text on accent buttons
        offenders.push(`${selector} { ${decl[1]}: ${decl[2]} }`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
