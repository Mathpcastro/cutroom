/**
 * Spec 5 E: an episode film. CRM.autoStory directs it from the engine text; `cast` maps each character
 * name to an avatar: "film" = the avatar frozen in the film (the profile avatar), or one of the app's
 * base avatars (strategist, companion, expert).
 */

export const BASE_AVATARS = ["strategist", "companion", "expert"] as const;
export type CastAvatar = "film" | (typeof BASE_AVATARS)[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function storyFilmHtml(o: {
  script: string;
  duration: number;
  voiceDuration: number;
  language?: string;
  cast: Record<string, CastAvatar>;
  hasFilmAvatar: boolean;
  episode?: { number: number; series: string; cta?: string };
}) {
  const title = /^#\s*(.+)$/m.exec(o.script)?.[1] ?? "Episódio";
  const castJs = Object.entries(o.cast)
    .map(([name, avatar]) => `${JSON.stringify(name)}: ${avatar === "film" ? "window.FILM_AVATAR || S.strategist" : `S.${avatar}`}`)
    .join(", ");
  return `<!doctype html>
<html lang="${o.language ?? "pt-BR"}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>${esc(title)}</title>
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #141318; }
  #film { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #141318; font-family: "Instrument Sans", sans-serif; }
  #continua { position: absolute; z-index: 999; left: 50%; bottom: 150px; transform: translateX(-50%); padding: 22px 44px; border-radius: 999px; background: #c8ff5a; color: #141318; font: 700 44px "Instrument Sans", sans-serif; white-space: nowrap; opacity: 0; box-shadow: 0 18px 50px #0008; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="${o.duration}" data-width="1080" data-height="1920">
  <audio id="voz" data-start="0" data-duration="${o.voiceDuration}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
  <template id="roteiro">${esc(o.script)}</template>
  <script src="kit/gsap.min.js"></script>
  <script src="brand.js"></script>
  <script src="timing.js"></script>
  ${o.hasFilmAvatar ? '<script src="avatar/runtime.js"></script>\n  <script src="avatar/voice.js"></script>' : ""}
  <script src="kit/cutroom-kit.js"></script>
  <script src="kit/cutroom-motion.js"></script>
  <script src="kit/avatar/engine.js"></script>
  <script src="kit/avatar/sample.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var D = ${o.duration};
    var tl = gsap.timeline({ paused: true });
    var S = window.CRM_SAMPLE_AVATARS || {}, palette = (window.BRAND && window.BRAND.palette) || {};
    CRM.autoStory({
      tl: tl, film: "#film", duration: D, engine: window.AvatarEngine,
      script: document.getElementById("roteiro").content.textContent,
      cast: { ${castJs} },
      fallback: [window.FILM_AVATAR || S.strategist, S.companion, S.expert].filter(Boolean),
      accent: palette.accent || "#7C5CFF",
      ${o.episode ? `episode: ${JSON.stringify({ number: o.episode.number, series: o.episode.series })},` : ""}
    });
    // The series CTA pill goes on top of everything the engine drew (the narrator says the "continua").
    var cta = document.createElement("div");
    cta.id = "continua";
    cta.textContent = ${JSON.stringify(o.episode?.cta ?? "Segue pra parte 2")};
    document.getElementById("film").appendChild(cta);
    tl.fromTo(cta, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, Math.max(0, D - 2.4));
    tl.set({}, {}, D);
    window.__timelines["film"] = tl;
  </script>
</div>
</body>
</html>`;
}
