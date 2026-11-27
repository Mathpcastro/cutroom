import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function listTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listTsxFiles(path);
      return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
    }),
  );
  return nested.flat();
}

function withoutComments(source: string) {
  let output = "";
  let state: "code" | "single" | "double" | "template" | "line" | "block" = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "line") {
      if (char === "\n") {
        output += "\n";
        state = "code";
      } else output += " ";
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        output += "  ";
        i += 1;
        state = "code";
      } else output += char === "\n" ? "\n" : " ";
    } else if (state === "code") {
      if (char === "/" && next === "/") {
        output += "  ";
        i += 1;
        state = "line";
      } else if (char === "/" && next === "*") {
        output += "  ";
        i += 1;
        state = "block";
      } else {
        output += char;
        if (char === "'") state = "single";
        else if (char === '"') state = "double";
        else if (char === "`") state = "template";
      }
    } else {
      output += char;
      if (char === "\\" && i + 1 < source.length) {
        output += source[i + 1];
        i += 1;
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
    }
  }
  return output;
}

function visibleCutRoomStrings(source: string, fileName: string) {
  const code = withoutComments(source);
  const violations: string[] = [];
  const inspect = (value: string, position: number) => {
    // This is the real output folder for existing films and exports.
    const withoutPreservedDataPath = value.replace(
      /(?:Vídeos|Videos)\/CutRoom(?:\/[^\s"'<>}]*)?/g,
      "",
    );
    if (/\bCutRoom\b/.test(withoutPreservedDataPath)) {
      const line = code.slice(0, position).split("\n").length;
      violations.push(`${fileName}:${line}`);
    }
  };
  const literal = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gs;
  for (const match of code.matchAll(literal))
    inspect(match[0].slice(1, -1), match.index ?? 0);
  for (const match of code.matchAll(/>([^<>]*)</gs))
    inspect(match[1], (match.index ?? 0) + 1);
  return violations;
}

describe("visible product name", () => {
  it("sets the packaged app product name to Videosell", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.build.productName).toBe("Videosell");
  });

  it("does not expose CutRoom in TSX text or string literals", async () => {
    const files = await listTsxFiles("src");
    const violations = (
      await Promise.all(
        files.map(async (file) =>
          visibleCutRoomStrings(await readFile(file, "utf8"), file),
        ),
      )
    ).flat();
    expect(violations).toEqual([]);
  });
});
