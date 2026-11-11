// node tools/build-site.mjs
// Monta as duas páginas do Videosell prontas para subir no carrosseisquevendem.com.br:
//   site/dist/videosell/       → /videosell       (página de vendas, R$ 147)
//   site/dist/app/videosell/   → /app/videosell   (upsell do Carrossell, R$ 97)
// Cada pasta leva só os vídeos e imagens que a sua página usa.
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const media = join(site, "upsell", "videos");
const pages = [
  { source: join(site, "videosell", "index.html"), target: join(site, "dist", "videosell") },
  { source: join(site, "upsell", "index.html"), target: join(site, "dist", "app", "videosell") },
];
rmSync(join(site, "dist"), { recursive: true, force: true });
for (const page of pages) {
  const html = readFileSync(page.source, "utf8");
  const files = [...new Set([...html.matchAll(/(?:src|poster)="videos\/([^"]+)"/g)].map((m) => m[1]))];
  mkdirSync(join(page.target, "videos"), { recursive: true });
  writeFileSync(join(page.target, "index.html"), html);
  let bytes = 0;
  for (const file of files) {
    cpSync(join(media, file), join(page.target, "videos", file));
    bytes += statSync(join(media, file)).size;
  }
  console.log(`${page.target.replace(site, "site")}: index.html + ${files.length} arquivos de mídia (${(bytes / 1048576).toFixed(1)} MB)`);
}
