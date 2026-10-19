import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { getHyperframeRuntimeScript } from "@hyperframes/core/runtime-script";
import type { MotionScene, Project } from "../../src/shared/types";
import { validateMotion } from "./motion-definition";

const motionRequire = createRequire(import.meta.url);
let scripts: Promise<string> | undefined;
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
export const MOTION_ENGINE_VERSION = "hf-0.8.173-cutroom-1";
export function motionCacheKey(
  scene: MotionScene,
  settings: Project["settings"],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        MOTION_ENGINE_VERSION,
        scene.html,
        scene.animations,
        scene.duration,
        scene.mode,
        scene.background,
        settings.width,
        settings.height,
        settings.fps,
      ]),
    )
    .digest("hex");
}
export async function motionDocument(
  scene: MotionScene,
  settings: Project["settings"],
  resources: string,
  preview = true,
) {
  validateMotion(scene);
  scripts ??= readFile(motionRequire.resolve("gsap/dist/gsap.min.js"), "utf8");
  const gsap = await scripts,
    nonce = randomBytes(24).toString("base64");
  const [regular, bold] = await Promise.all(
    ["Barlow-Regular.ttf", "Barlow-Bold.ttf"].map((f) =>
      readFile(join(resources, "fonts", f)).then((b) => b.toString("base64")),
    ),
  );
  // Producer inserts its own trusted bootstrap scripts while compiling. Author HTML is
  // validated before this document exists; only the opaque preview accepts nonce scripts.
  const csp = `default-src 'none'; script-src ${preview ? `'nonce-${nonce}'` : "'self' 'unsafe-inline'"}; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // The author canvas is 1920 wide; every output resolution uses the same typography/layout.
  const scale = settings.width / 1920,
    designHeight = settings.height / scale;
  const bootstrap = `window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, {duration:${scene.duration}});for(const t of ${safeJson(scene.animations)}){const targets=document.querySelector('#design').querySelectorAll(t.selector);const vars={...t.to,duration:t.duration,ease:t.ease||'power2.out',immediateRender:false};if(t.from)tl.fromTo(targets,t.from,vars,t.start);else tl.to(targets,vars,t.start);}window.__timelines['cutroom-motion']=tl;tl.seek(0);`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>@font-face{font-family:Barlow;src:url(data:font/ttf;base64,${regular})} @font-face{font-family:Barlow;src:url(data:font/ttf;base64,${bold});font-weight:700}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#stage{position:relative;width:${settings.width}px;height:${settings.height}px;background:${scene.mode === "fullscreen" ? (scene.background ?? "#151515") : "transparent"}}#design{position:absolute;left:0;top:0;width:1920px;height:${designHeight}px;transform:scale(${scale});transform-origin:0 0}</style></head><body><div id="stage" data-composition-id="cutroom-motion" data-start="0" data-duration="${scene.duration}" data-width="${settings.width}" data-height="${settings.height}"><div id="design">${scene.html}</div></div><script nonce="${nonce}">${gsap}</script><script nonce="${nonce}">${bootstrap}</script><script nonce="${nonce}">${getHyperframeRuntimeScript()}</script></body></html>`;
}
