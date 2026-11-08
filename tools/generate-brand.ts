import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  brandColors,
  brandPath,
  brandViewBox,
} from "../src/shared/branding";

const directory = resolve("resources/branding");
await mkdir(directory, { recursive: true });
await mkdir("public", { recursive: true });

const localFontAssets = [
  "resources/fonts/Sora-Variable.ttf",
  "resources/fonts/Inter-Variable.ttf",
  "resources/licenses/Sora-OFL.txt",
  "resources/licenses/Inter-OFL.txt",
];
await Promise.all(localFontAssets.map((file) => readFile(resolve(file))));

const mark =
  `<rect x="2" y="2" width="60" height="60" rx="16" fill="${brandColors.violet}"/>` +
  `<path d="${brandPath}" fill="none" stroke="${brandColors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="46" cy="18" r="5" fill="${brandColors.lime}"/>`;
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brandViewBox}">${mark}</svg>`;
const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${brandViewBox}">${mark}</svg>`;
await writeFile(resolve(directory, "cutroom-mark.svg"), symbol + "\n");
await writeFile(resolve(directory, "cutroom-icon.svg"), tile + "\n");
await writeFile(resolve("public/cutroom.svg"), tile + "\n");

const browserFlag = process.argv.indexOf("--browser");
const platformBrowsers =
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const executablePath =
  browserFlag >= 0
    ? process.argv[browserFlag + 1]
    : [
        process.env.CHROMIUM_EXECUTABLE_PATH,
        chromium.executablePath(),
        ...platformBrowsers,
      ]
        .filter((candidate): candidate is string => Boolean(candidate))
        .find((candidate) => existsSync(candidate));
const browser = await chromium.launch({ executablePath });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map<number, Buffer>();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent;width:100%;height:100%}body>svg{width:100%;height:100%;display:block}</style>${tile}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    pngs.set(size, png);
    await writeFile(resolve(directory, `icon-${size}.png`), png);
  }
} finally {
  await browser.close();
}

const icoSizes = sizes.filter((size) => size <= 256);
const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let icoOffset = icoHeader.length;
icoSizes.forEach((size, index) => {
  const png = pngs.get(size)!;
  const entry = 6 + 16 * index;
  icoHeader[entry] = size === 256 ? 0 : size;
  icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(png.length, entry + 8);
  icoHeader.writeUInt32LE(icoOffset, entry + 12);
  icoOffset += png.length;
});
await writeFile(
  resolve(directory, "icon.ico"),
  Buffer.concat([icoHeader, ...icoSizes.map((size) => pngs.get(size)!)]),
);

const icnsTypes: [string, number][] = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 48],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];
const icnsChunks = icnsTypes.map(([type, size]) => {
  const png = pngs.get(size)!;
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(header.length + png.length, 4);
  return Buffer.concat([header, png]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, "ascii");
icnsHeader.writeUInt32BE(
  icnsHeader.length +
    icnsChunks.reduce((total, chunk) => total + chunk.length, 0),
  4,
);
await writeFile(
  resolve(directory, "icon.icns"),
  Buffer.concat([icnsHeader, ...icnsChunks]),
);

console.log(
  `Generated Videosell SVG, ${sizes.length} PNG sizes, ${icoSizes.length}-size ICO and ICNS from the shared mark.`,
);
