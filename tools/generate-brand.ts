import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { brandBars, brandTransform, brandViewBox } from "../src/shared/branding";

const directory = resolve("resources/branding");
await mkdir(directory, { recursive: true });
await mkdir("public", { recursive: true });
const bars = brandBars.map(b => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/>`).join("");
const mark = `<g fill="#181918" transform="${brandTransform}">${bars}</g>`;
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brandViewBox}">${mark}</svg>`;
const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="16" y="16" width="480" height="480" rx="112" fill="#f7f8f4"/><svg x="112" y="76" width="288" height="360" viewBox="${brandViewBox}">${mark}</svg></svg>`;
await writeFile(resolve(directory, "cutroom-mark.svg"), symbol + "\n");
await writeFile(resolve(directory, "cutroom-icon.svg"), tile + "\n");
await writeFile(resolve("public/cutroom.svg"), tile + "\n");
const browserFlag = process.argv.indexOf("--browser");
const browser = await chromium.launch({ executablePath: browserFlag < 0 ? undefined : process.argv[browserFlag + 1] });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const pngs: { size: number; png: Buffer }[] = [];
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent;width:100%;height:100%}body>svg{width:100%;height:100%;display:block}</style>${tile}`);
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(resolve(directory, `icon-${size}.png`), png);
    if (size <= 256) pngs.push({ size, png });
  }
} finally { await browser.close(); }
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach(({ size, png }, i) => {
  const entry = 6 + 16 * i;
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(resolve(directory, "icon.ico"), Buffer.concat([header, ...pngs.map(p => p.png)]));
console.log(`Generated identical landing mark and ${pngs.length}-size Windows icon.`);
