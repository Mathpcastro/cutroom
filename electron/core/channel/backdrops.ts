/**
 * Scenery drawn in code (SVG) for character and counter scenes, so a channel with a fixed
 * character changes place every scene without stock photos or licenses. Flat illustration,
 * 1920×1080 viewBox; `slice` keeps the floor at the bottom in 9:16 too.
 */
export const BACKDROPS = ["quarto", "sala", "cozinha", "rua", "parque", "escritorio", "noite", "campo"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

const svg = (body: string) =>
  `<svg class="bd-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax slice">${body}</svg>`;

const window = (x: number, y: number, w: number, h: number, sky: string) =>
  `<rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" rx="10" fill="#F4EEE2"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/><circle cx="${x + w * 0.72}" cy="${y + h * 0.32}" r="${h * 0.12}" fill="#FFE9A8"/><rect x="${x + w / 2 - 6}" y="${y}" width="12" height="${h}" fill="#F4EEE2"/><rect x="${x}" y="${y + h / 2 - 6}" width="${w}" height="12" fill="#F4EEE2"/>`;

const DRAW: Record<Backdrop, string> = {
  quarto: svg(
    `<rect width="1920" height="1080" fill="#7FA6C9"/><rect y="0" width="1920" height="40" fill="#6C93B6"/>${window(1240, 170, 420, 320, "#BFE3F7")}` +
      `<rect x="260" y="230" width="230" height="300" rx="8" fill="#F2C14E"/><rect x="290" y="260" width="170" height="240" fill="#E86A4C"/>` +
      `<rect y="820" width="1920" height="260" fill="#9C6B4E"/><rect y="820" width="1920" height="18" fill="#7E5440"/>` +
      `<rect x="1180" y="640" width="640" height="220" rx="26" fill="#EDE7DD"/><rect x="1180" y="600" width="640" height="70" rx="20" fill="#F7F3EC"/><rect x="1150" y="560" width="40" height="320" rx="10" fill="#6E4A3A"/><rect x="1800" y="600" width="40" height="280" rx="10" fill="#6E4A3A"/>` +
      `<rect x="560" y="700" width="120" height="140" rx="10" fill="#6E4A3A"/><rect x="600" y="600" width="12" height="100" fill="#333"/><path d="M560 600 L652 600 L630 540 L582 540Z" fill="#FFD27A"/>`,
  ),
  sala: svg(
    `<rect width="1920" height="1080" fill="#C9B79C"/>${window(160, 160, 380, 300, "#A9D8F0")}` +
      `<rect x="760" y="250" width="420" height="250" rx="16" fill="#222"/><rect x="780" y="270" width="380" height="210" rx="8" fill="#3B3F48"/><rect x="930" y="500" width="80" height="60" fill="#444"/>` +
      `<rect y="840" width="1920" height="240" fill="#8E6A4C"/><ellipse cx="960" cy="930" rx="560" ry="70" fill="#B5574B" opacity=".75"/>` +
      `<rect x="1280" y="620" width="520" height="240" rx="40" fill="#5D7B6F"/><rect x="1260" y="560" width="560" height="110" rx="40" fill="#6E8F82"/>` +
      `<rect x="200" y="660" width="70" height="180" rx="14" fill="#7A5A44"/><circle cx="235" cy="620" r="70" fill="#5E9A62"/><circle cx="190" cy="580" r="50" fill="#6FB073"/>`,
  ),
  cozinha: svg(
    `<rect width="1920" height="1080" fill="#E9DCC3"/>${window(780, 150, 360, 260, "#BFE3F7")}` +
      `<rect x="80" y="160" width="560" height="220" rx="10" fill="#C77B4E"/><rect x="1280" y="160" width="560" height="220" rx="10" fill="#C77B4E"/>` +
      `<rect y="620" width="1920" height="40" fill="#5C4537"/><rect y="660" width="1920" height="420" fill="#D58A5A"/><rect y="820" width="1920" height="260" fill="#B86E44"/>` +
      `<rect x="1580" y="300" width="260" height="520" rx="22" fill="#F1F1F1"/><rect x="1600" y="520" width="16" height="70" rx="6" fill="#BBB"/>` +
      `<rect x="300" y="540" width="160" height="80" rx="12" fill="#3A3A3A"/><ellipse cx="380" cy="540" rx="90" ry="16" fill="#555"/>` +
      `<rect x="980" y="540" width="70" height="90" rx="10" fill="#F2C14E"/>`,
  ),
  rua: svg(
    `<rect width="1920" height="1080" fill="#9ED3F0"/><circle cx="1600" cy="180" r="80" fill="#FFE9A8"/>` +
      `<rect x="60" y="260" width="360" height="620" fill="#E58E6A"/><rect x="430" y="380" width="300" height="500" fill="#F2C14E"/><rect x="1200" y="300" width="340" height="580" fill="#7FA6C9"/><rect x="1550" y="420" width="320" height="460" fill="#C9B79C"/>` +
      Array.from({ length: 6 }, (_, i) => `<rect x="${100 + (i % 2) * 150}" y="${320 + Math.floor(i / 2) * 170}" width="100" height="110" fill="#FFF3D6"/>`).join("") +
      Array.from({ length: 6 }, (_, i) => `<rect x="${1240 + (i % 2) * 150}" y="${360 + Math.floor(i / 2) * 160}" width="100" height="100" fill="#E8F3FB"/>`).join("") +
      `<rect y="880" width="1920" height="200" fill="#5B5B63"/><rect y="860" width="1920" height="30" fill="#A9A9B2"/>` +
      Array.from({ length: 8 }, (_, i) => `<rect x="${60 + i * 240}" y="970" width="120" height="14" fill="#E6E6E6"/>`).join("") +
      `<rect x="860" y="430" width="16" height="440" fill="#3A3A3A"/><ellipse cx="868" cy="430" rx="50" ry="22" fill="#3A3A3A"/>`,
  ),
  parque: svg(
    `<rect width="1920" height="1080" fill="#A7DBF5"/><circle cx="260" cy="200" r="90" fill="#FFE9A8"/>` +
      `<ellipse cx="420" cy="760" rx="700" ry="200" fill="#7CC07A"/><ellipse cx="1500" cy="780" rx="760" ry="210" fill="#6BB26B"/><rect y="820" width="1920" height="260" fill="#5EA35E"/>` +
      `<rect x="1460" y="420" width="50" height="420" fill="#7A5A44"/><circle cx="1485" cy="380" r="170" fill="#4F9A55"/><circle cx="1390" cy="440" r="110" fill="#5DAA62"/>` +
      `<rect x="250" y="500" width="40" height="340" fill="#7A5A44"/><circle cx="270" cy="470" r="130" fill="#58A35C"/>` +
      `<rect x="1000" y="740" width="320" height="30" rx="8" fill="#8E6A4C"/><rect x="1000" y="690" width="320" height="24" rx="8" fill="#8E6A4C"/><rect x="1020" y="770" width="16" height="70" fill="#5C4537"/><rect x="1284" y="770" width="16" height="70" fill="#5C4537"/>`,
  ),
  escritorio: svg(
    `<rect width="1920" height="1080" fill="#D9DEE6"/>${window(1380, 140, 400, 300, "#BFE3F7")}` +
      `<rect x="120" y="180" width="520" height="24" fill="#8E6A4C"/><rect x="120" y="330" width="520" height="24" fill="#8E6A4C"/>` +
      Array.from({ length: 9 }, (_, i) => `<rect x="${140 + i * 54}" y="${(i % 3) * 8 + 100}" width="40" height="${80 - (i % 3) * 8}" fill="${["#E86A4C", "#2B5DA8", "#F2C14E"][i % 3]}"/>`).join("") +
      `<rect y="840" width="1920" height="240" fill="#6E7280"/>` +
      `<rect x="1100" y="620" width="760" height="40" rx="8" fill="#8E6A4C"/><rect x="1130" y="660" width="30" height="190" fill="#5C4537"/><rect x="1800" y="660" width="30" height="190" fill="#5C4537"/>` +
      `<rect x="1360" y="440" width="320" height="190" rx="12" fill="#222"/><rect x="1376" y="456" width="288" height="158" rx="6" fill="#2F6FD6"/><rect x="1500" y="630" width="40" height="0" fill="#222"/>`,
  ),
  noite: svg(
    `<rect width="1920" height="1080" fill="#16213E"/><circle cx="1520" cy="200" r="90" fill="#F4F1DE"/><circle cx="1556" cy="182" r="90" fill="#16213E"/>` +
      Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 197) % 1920}" cy="${(i * 113) % 520}" r="${i % 3 === 0 ? 3 : 2}" fill="#FFFFFF" opacity=".8"/>`).join("") +
      `<path d="M0 760 L120 760 L120 600 L260 600 L260 700 L380 700 L380 540 L520 540 L520 760 L700 760 L700 640 L860 640 L860 760 L1060 760 L1060 580 L1220 580 L1220 700 L1380 700 L1380 620 L1540 620 L1540 760 L1700 760 L1700 660 L1920 660 L1920 1080 L0 1080Z" fill="#0F1730"/>` +
      Array.from({ length: 14 }, (_, i) => `<rect x="${150 + i * 125}" y="${690 + (i % 3) * 18}" width="22" height="22" fill="#F2C14E" opacity=".85"/>`).join("") +
      `<rect y="880" width="1920" height="200" fill="#0B1022"/>`,
  ),
  campo: svg(
    `<rect width="1920" height="1080" fill="#F6C98B"/><circle cx="960" cy="560" r="160" fill="#FCE3A0"/>` +
      `<path d="M0 640 Q480 520 960 640 T1920 620 L1920 1080 L0 1080Z" fill="#B7C26A"/><path d="M0 760 Q520 660 1040 760 T1920 740 L1920 1080 L0 1080Z" fill="#94A852"/>` +
      `<rect y="880" width="1920" height="200" fill="#7E9145"/>` +
      `<rect x="1500" y="520" width="200" height="160" fill="#C2553E"/><path d="M1480 530 L1600 440 L1720 530Z" fill="#8E3B2C"/><rect x="1580" y="600" width="44" height="80" fill="#5C2E22"/>` +
      Array.from({ length: 7 }, (_, i) => `<rect x="${120 + i * 90}" y="790" width="10" height="90" fill="#6B4A2E"/>`).join("") + `<rect x="120" y="810" width="550" height="8" fill="#6B4A2E"/>`,
  ),
};

/** SVG markup of a backdrop (unknown names fall back to `quarto`). */
export function backdropSvg(name: string) {
  return DRAW[(BACKDROPS as readonly string[]).includes(name) ? (name as Backdrop) : "quarto"];
}
