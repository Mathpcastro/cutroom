import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { BrandMark } from "../src/components/BrandMark";
import {
  brandColors,
  brandName,
  brandPath,
  brandTagline,
  brandViewBox,
} from "../src/shared/branding";

function renderMark(props: { size?: number; title?: string } = {}) {
  const markup = renderToStaticMarkup(createElement(BrandMark, props));
  const { document } = parseHTML(`<html><body>${markup}</body></html>`);
  const svg = document.querySelector("svg");
  if (!svg) throw new Error("BrandMark did not render an SVG");
  return svg;
}

describe("Videosell brand", () => {
  it("uses the approved Palco digital identity", () => {
    expect(brandName).toBe("Videosell");
    expect(brandTagline).toBe(
      "Avatares de IA para apresentar e vender seu produto.",
    );
    expect(brandViewBox).toBe("0 0 64 64");
    expect(brandColors).toEqual({
      ink: "#141318",
      violet: "#7C5CFF",
      violetDeep: "#6445D8",
      lime: "#C8FF5A",
      paper: "#F7F6F1",
      white: "#FFFFFF",
    });
  });

  it("renders the approved mark from the shared geometry and colors", () => {
    const svg = renderMark({ size: 24 });
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("viewBox")).toBe(brandViewBox);

    const background = svg.querySelector("rect");
    expect(background?.getAttribute("x")).toBe("2");
    expect(background?.getAttribute("y")).toBe("2");
    expect(background?.getAttribute("width")).toBe("60");
    expect(background?.getAttribute("height")).toBe("60");
    expect(background?.getAttribute("rx")).toBe("16");
    expect(background?.getAttribute("fill")).toBe(brandColors.violet);

    const path = svg.querySelector("path");
    expect(path?.getAttribute("d")).toBe(brandPath);
    expect(path?.getAttribute("fill")).toBe("none");
    expect(path?.getAttribute("stroke")).toBe(brandColors.white);
    expect(path?.getAttribute("stroke-width")).toBe("7");
    expect(path?.getAttribute("stroke-linecap")).toBe("round");
    expect(path?.getAttribute("stroke-linejoin")).toBe("round");

    const dot = svg.querySelector("circle");
    expect(dot?.getAttribute("cx")).toBe("46");
    expect(dot?.getAttribute("cy")).toBe("18");
    expect(dot?.getAttribute("r")).toBe("5");
    expect(dot?.getAttribute("fill")).toBe(brandColors.lime);
  });

  it("is decorative by default and exposes a standalone accessible title", () => {
    const decorative = renderMark();
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.getAttribute("focusable")).toBe("false");
    expect(decorative.getAttribute("role")).toBeNull();
    expect(decorative.querySelector("title")).toBeNull();

    const standalone = renderMark({ title: "Videosell" });
    expect(standalone.getAttribute("aria-hidden")).toBeNull();
    expect(standalone.getAttribute("role")).toBe("img");
    expect(standalone.querySelector("title")?.textContent).toBe("Videosell");
  });

  it("uses the same geometry and colors in every generated SVG", async () => {
    const files = await Promise.all(
      [
        "resources/branding/cutroom-mark.svg",
        "resources/branding/cutroom-icon.svg",
        "public/cutroom.svg",
      ].map((file) => readFile(file, "utf8")),
    );
    for (const svg of files) {
      expect(svg).toContain(`viewBox="${brandViewBox}"`);
      expect(svg).toContain(
        '<rect x="2" y="2" width="60" height="60" rx="16" fill="#7C5CFF"/>',
      );
      expect(svg).toContain(`d="${brandPath}"`);
      expect(svg).toContain('stroke="#FFFFFF" stroke-width="7"');
      expect(svg).toContain('stroke-linecap="round" stroke-linejoin="round"');
      expect(svg).toContain('<circle cx="46" cy="18" r="5" fill="#C8FF5A"/>');
    }
  });

  it("packages the generated PNGs as multi-size ICO and ICNS icons", async () => {
    const ico = await readFile("resources/branding/icon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);
    const icoSizes = Array.from(
      { length: ico.readUInt16LE(4) },
      (_, index) => ico[6 + index * 16] || 256,
    );
    expect(icoSizes).toEqual([16, 24, 32, 48, 64, 128, 256]);

    const icns = await readFile("resources/branding/icon.icns");
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const types: string[] = [];
    for (let offset = 8; offset < icns.length; ) {
      const length = icns.readUInt32BE(offset + 4);
      expect(length).toBeGreaterThanOrEqual(8);
      types.push(icns.toString("ascii", offset, offset + 4));
      offset += length;
    }
    expect(types).toEqual([
      "icp4",
      "icp5",
      "icp6",
      "ic07",
      "ic08",
      "ic09",
      "ic10",
      "ic11",
      "ic12",
      "ic13",
      "ic14",
    ]);
  });

  it("bundles Sora and Inter locally with their OFL licenses", async () => {
    const assets = [
      "resources/fonts/Sora-Variable.ttf",
      "resources/fonts/Inter-Variable.ttf",
      "resources/licenses/Sora-OFL.txt",
      "resources/licenses/Inter-OFL.txt",
    ];
    for (const asset of assets) expect(existsSync(asset), asset).toBe(true);
    for (const license of assets.slice(2)) {
      expect(await readFile(license, "utf8")).toContain(
        "SIL OPEN FONT LICENSE",
      );
    }
  });
});
