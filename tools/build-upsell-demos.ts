import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { AvatarService } from "../electron/core/avatar-service";
import { AvatarStore } from "../electron/core/avatar-store";
import { filmStills, renderFilm, type FilmRunner } from "../electron/core/film";
import { FilmStudio, type FilmHost } from "../electron/core/film-studio";
import { ffmpegPath, ffprobePath } from "../electron/core/media";
import { probeAudio, type Studio } from "../electron/core/studio";
import { captureVideosellTour } from "./capture-videosell-tour.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "artifacts", "upsell-demos");
const publicDir = join(root, "site", "upsell", "videos");
const runtime = join(artifacts, "runtime");

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((value): value is string => Boolean(value));
  const browser = candidates.find((candidate) => existsSync(candidate));
  if (!browser) throw new Error("Chromium local não encontrado.");
  return browser;
}

async function audioHash(file: string) {
  const { stdout } = await execFile(ffmpegPath, [
    "-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "copy", "-f", "md5", "-",
  ]);
  return stdout.trim();
}

async function probe(file: string) {
  const { stdout } = await execFile(ffprobePath, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ]);
  return JSON.parse(stdout) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string }>;
  };
}

async function assertMedia(video: string, poster: string, original: string) {
  const info = await probe(video);
  const stream = info.streams.find((item) => item.codec_type === "video");
  const audio = info.streams.find((item) => item.codec_type === "audio");
  if (stream?.width !== 1080 || stream.height !== 1920 || stream.avg_frame_rate !== "30/1") {
    throw new Error(`Vídeo fora do contrato vertical: ${video}`);
  }
  if (audio?.sample_rate !== "48000" || Number(info.format.duration) <= 0) {
    throw new Error(`Áudio/duração fora do contrato: ${video}`);
  }
  if ((await audioHash(video)) !== (await audioHash(original))) {
    throw new Error(`O stream da narração foi alterado: ${video}`);
  }
  const image = await probe(poster);
  const dimensions = image.streams.find((item) => item.codec_type === "video");
  if (dimensions?.width !== 1080 || dimensions.height !== 1920) {
    throw new Error(`Pôster fora de 1080 × 1920: ${poster}`);
  }
}

function professorHtml(duration: number) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>
@font-face{font-family:Anton;src:url(fonts/Anton-Regular.ttf)}@font-face{font-family:Instrument;src:url(fonts/InstrumentSans.ttf)}
*{box-sizing:border-box;margin:0}html,body{width:1080px;height:1920px;overflow:hidden;background:#f3efe7}#film{position:relative;width:1080px;height:1920px;overflow:hidden;color:#191722;background:#f3efe7;font-family:Instrument,sans-serif}.cam{position:absolute;inset:0}.kicker{position:absolute;left:72px;top:86px;padding:18px 26px;border-radius:99px;background:#191722;color:#d5ff68;font:700 27px Instrument;letter-spacing:3px}.scene{position:absolute;inset:0;visibility:hidden;opacity:0}.hook{visibility:visible;opacity:1}.big{position:absolute;left:70px;right:70px;top:360px;font:150px/.98 Anton;letter-spacing:-2px}.big em{display:block;color:#6547e8;font-style:normal}.sub{position:absolute;left:76px;right:76px;top:790px;font-size:45px;line-height:1.3;color:#625e6c}.post{position:absolute;left:90px;top:330px;width:900px;background:#fff;border-radius:40px;overflow:hidden;box-shadow:0 28px 80px #30243b22}.art{height:520px;display:grid;place-items:center;text-align:center;padding:50px;background:linear-gradient(145deg,#6949e9,#a98cf5);color:#fff;font:105px/1.02 Anton}.bar{padding:36px 44px;font-size:48px;font-weight:750}.zero{position:absolute;right:80px;top:1110px;padding:32px 46px;background:#191722;color:#fff;border-radius:28px;font-size:42px}.zero b{display:block;color:#d5ff68;font:120px Anton}.steps{position:absolute;left:75px;right:75px;top:350px;display:grid;gap:28px}.step{display:flex;align-items:center;gap:30px;padding:38px;background:#fff;border:3px solid #e1dbeb;border-radius:30px;font-size:48px;font-weight:700}.step i{display:grid;place-items:center;min-width:92px;height:92px;border-radius:24px;background:#6949e9;color:#fff;font:64px Anton}.proof{position:absolute;left:70px;right:70px;top:370px;text-align:center}.proof b{display:block;color:#6949e9;font:280px Anton}.proof strong{display:block;font:85px/1.05 Anton}.proof p{margin-top:35px;font-size:44px;color:#625e6c}.cta{position:absolute;left:170px;right:170px;top:1050px;padding:30px;text-align:center;background:#191722;color:#d5ff68;border-radius:99px;font-size:39px;font-weight:750}#avatar{position:absolute;right:20px;bottom:90px;width:430px;height:430px;image-rendering:pixelated}.footer{position:absolute;left:70px;bottom:90px;font:700 28px Instrument;letter-spacing:3px;color:#6d6678}
</style></head><body><div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920"><div class="cam"><div class="kicker">AULA · CONTEÚDO QUE CONVERTE</div>
<section class="scene hook"><div class="big">MIL CURTIDAS.<em>ZERO ASSINATURAS.</em></div><p class="sub">O problema não é o produto.<br>É o tipo de post.</p></section>
<section class="scene feed"><div class="post"><div class="art">5 DICAS PRA<br>CRESCER NO<br>INSTAGRAM</div><div class="bar">♥ 1.000 curtidas</div></div><div class="zero">Assinaturas hoje<b>0</b></div></section>
<section class="scene teach"><div class="steps"><div class="step"><i>1</i>A dor do cliente</div><div class="step"><i>2</i>A prova de que resolve</div><div class="step"><i>3</i>O convite pra testar</div></div></section>
<section class="scene result"><div class="proof"><b>112</b><strong>ASSINATURAS</strong><p>Um modelo de post pensado<br>para o próximo passo.</p></div><div class="cta">CURTIDA OU ASSINATURA?</div></section>
<canvas id="avatar" width="96" height="96"></canvas><div class="footer">CUTROOM · PROFESSOR</div></div>
<audio id="voz" data-start="0" data-duration="${duration - 1.8}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
<script src="kit/gsap.min.js"></script><script src="brand.js"></script><script src="timing.js"></script><script src="avatar/runtime.js"></script><script src="avatar/voice.js"></script><script src="kit/cutroom-kit.js"></script>
<script type="module">
const {renderAvatarPixels}=await import(window.FILM_AVATAR_ENGINE);const canvas=document.getElementById('avatar'),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;const D=${duration};function draw(t){const v=window.FILM_AVATAR_VOICE,f=Math.max(0,Math.min(v.mouths.length-1,Math.floor(t*v.fps))),mouth=v.mouths[f]||'X',p=renderAvatarPixels(window.FILM_AVATAR,{pose:t>D*.78?'celebrating':'explaining',expression:'neutral',mouth,blink:f%107<4?1:0,frame:f},'full');if(canvas.width!==p.width||canvas.height!==p.height){canvas.width=p.width;canvas.height=p.height}ctx.putImageData(new ImageData(p.data,p.width,p.height),0,0)}const tl=gsap.timeline({paused:true}),state={t:0};const scenes=['.hook','.feed','.teach','.result'],starts=[0,D*.22,D*.45,D*.76];for(let i=1;i<scenes.length;i++){tl.to(scenes[i-1],{autoAlpha:0,y:-35,duration:.3},starts[i]-.3);tl.fromTo(scenes[i],{autoAlpha:0,y:40},{autoAlpha:1,y:0,duration:.45,ease:'power3.out'},starts[i])}tl.fromTo('.cam',{scale:1},{scale:1.025,transformOrigin:'50% 45%',duration:D,ease:'none'},0);tl.to(state,{t:D,duration:D,ease:'none',onUpdate:()=>draw(state.t)},0);tl.set({}, {}, D);window.__timelines=window.__timelines||{};window.__timelines["film"]=tl;draw(0);
</script></div></body></html>`;
}

function uiHtml(duration: number) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>
@font-face{font-family:Anton;src:url(fonts/Anton-Regular.ttf)}@font-face{font-family:Instrument;src:url(fonts/InstrumentSans.ttf)}*{box-sizing:border-box;margin:0}html,body{width:1080px;height:1920px;overflow:hidden;background:#15131b}#film{position:relative;width:1080px;height:1920px;overflow:hidden;background:radial-gradient(circle at 85% 8%,#51369d 0,#15131b 48%);color:#fff;font-family:Instrument,sans-serif}.grid{position:absolute;inset:0;background-image:radial-gradient(#ffffff16 2px,transparent 2px);background-size:42px 42px}.top{position:absolute;left:64px;right:64px;top:82px;display:flex;justify-content:space-between;align-items:center;font-size:27px;font-weight:750;letter-spacing:3px;color:#d5ff68}.top span:last-child{color:#fff}.title{position:absolute;left:64px;right:64px;top:190px;font:100px/1.02 Anton}.shot{position:absolute;left:60px;top:490px;width:960px;height:667px;padding:14px;background:#ffffff18;border:2px solid #ffffff28;border-radius:36px;box-shadow:0 35px 100px #0008;visibility:hidden;opacity:0}.shot:first-of-type{visibility:visible;opacity:1}.shot img{display:block;width:100%;height:100%;object-fit:cover;border-radius:24px}.caption{position:absolute;left:70px;right:70px;top:1260px;font-size:44px;line-height:1.3;color:#d7d2df}.track{position:absolute;left:70px;right:70px;top:1430px;height:18px;border-radius:20px;background:#ffffff20;overflow:hidden}.progress{height:100%;width:100%;background:#d5ff68;transform-origin:left}.chip{position:absolute;left:70px;top:1530px;padding:24px 34px;border-radius:99px;background:#6949e9;font-size:34px;font-weight:750}.brand{position:absolute;right:70px;bottom:100px;font:44px Anton}.brand b{color:#d5ff68}
</style></head><body><div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920"><div class="grid"></div><div class="top"><span>FLUXO REAL NO VIDEOSSELL</span><span>01 → 04</span></div><div class="title">DO PEDIDO<br>AO REEL PRONTO.</div>
<figure class="shot"><img src="assets/studio-avatar.png" alt=""></figure><figure class="shot"><img src="assets/studio-profiles.png" alt=""></figure><figure class="shot"><img src="assets/studio-reel.png" alt=""></figure><figure class="shot"><img src="assets/studio-editor.png" alt=""></figure>
<div class="caption">Crie o avatar, organize o perfil,<br>revise os quadros e ajuste o filme.</div><div class="track"><div class="progress"></div></div><div class="chip">NARRAÇÃO + CENAS + REVISÃO</div><div class="brand">CUT<b>ROOM</b></div>
<audio id="voz" data-start="0" data-duration="${duration - 1.8}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio><script src="kit/gsap.min.js"></script><script src="brand.js"></script><script src="timing.js"></script><script src="kit/cutroom-kit.js"></script><script>
const D=${duration},tl=gsap.timeline({paused:true}),shots=document.querySelectorAll('.shot');for(let i=1;i<shots.length;i++){const at=D*i/4;tl.to(shots[i-1],{autoAlpha:0,y:-25,duration:.25},at-.25);tl.fromTo(shots[i],{autoAlpha:0,y:35},{autoAlpha:1,y:0,duration:.4,ease:'power3.out'},at)}tl.fromTo('.progress',{scaleX:0},{scaleX:1,duration:D,ease:'none'},0);tl.set({}, {}, D);window.__timelines=window.__timelines||{};window.__timelines["film"]=tl;
</script></div></body></html>`;
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  await captureVideosellTour({ projectRoot: root });
  const examplePath = join(root, "resources", "avatar-engine", "examples", "expert.json");
  const example = JSON.parse(await readFile(examplePath, "utf8"));
  await copyFile(examplePath, join(artifacts, "approved-expert.json"));
  const store = new AvatarStore(join(runtime, "avatars"));
  const avatars = new AvatarService({ store, renderer: async () => { throw new Error("O pacote aprovado não precisa de nova renderização."); } });
  const created = await avatars.createCandidate({ description: "Professor aprovado para o comparativo público", package: example });
  const selected = await avatars.saveRevision({ avatarId: created.avatarId, candidateId: created.candidates[0].candidateId });
  const avatar = { avatarId: selected.avatarId, revision: selected.revision, hash: selected.hash };
  const runner: FilmRunner = { worker: join(root, "dist-electron", "render-motion.js"), browser: browserPath() };
  const host: FilmHost = {
    films: undefined as never,
    avatarStore: store,
    avatarEngineDir: join(root, "resources", "avatar-engine"),
    brand: { get: async () => null },
    runner: async () => runner,
    videosDir: join(artifacts, "staging"),
    job: async (_kind, _label, run) => run(new AbortController().signal, () => undefined),
  };
  const { Films } = await import("../electron/core/film");
  const films = new Films(join(runtime, "films"), join(root, "resources", "film-kit"), createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), join(root, "resources", "film-recipes"));
  host.films = films;
  const studio = new FilmStudio(host, {} as Studio);
  const manifest: Record<string, unknown> = { generatedAt: new Date().toISOString(), avatar, renderer: "FilmStudio + Films.setVoice + renderFilm", demos: [] };

  for (const name of ["professor", "ui-motion"] as const) {
    const original = join(artifacts, "original", `${name}.mp4`);
    const duration = await probeAudio(original);
    const createdFilm = await studio.create({ name: `Upsell ${name} ${Date.now()}`, format: name, aspect: "9:16", ...(name === "professor" ? { avatar } : {}) });
    await films.setVoice(createdFilm.film, { file: original, duration: await probeAudio(original), provider: "arquivo", voice: "narracao-original" });
    if (name === "ui-motion") {
      for (const screen of ["studio-avatar", "studio-profiles", "studio-reel", "studio-editor"]) {
        await films.addAsset(createdFilm.film, join(artifacts, "ui-frames", `${screen}.png`), `${screen}.png`);
      }
    }
    const finalDuration = +(duration + 1.8).toFixed(3);
    await films.writeFile(createdFilm.film, "index.html", name === "professor" ? professorHtml(finalDuration) : uiHtml(finalDuration));
    const report = await films.check(createdFilm.film);
    if (!report.ok) throw new Error(report.errors.join("\n"));
    const reviewDir = join(artifacts, "review", name);
    await mkdir(reviewDir, { recursive: true });
    const times = [0.5, duration * 0.2, duration * 0.4, duration * 0.6, duration * 0.8, duration - 0.2];
    const stills = await filmStills(films, createdFilm.film, times, runner);
    if (stills.errors.length) throw new Error(`${name}: ${stills.errors.join("\n")}`);
    for (const [index, frame] of stills.files.entries()) await copyFile(frame.file, join(reviewDir, `frame-${index + 1}.png`));
    const rendered = join(artifacts, "staging", `${name}-engine.mp4`);
    await renderFilm(films, createdFilm.film, rendered, runner);
    const muxed = join(artifacts, "staging", `${name}-original-audio.mp4`);
    await execFile(ffmpegPath, ["-v", "error", "-y", "-i", rendered, "-i", original, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", muxed]);
    const poster = join(artifacts, "staging", `${name}.jpg`);
    await execFile(ffmpegPath, ["-v", "error", "-y", "-ss", String(duration * 0.55), "-i", muxed, "-frames:v", "1", "-q:v", "2", poster]);
    await assertMedia(muxed, poster, original);
    const finalVideo = join(publicDir, `${name}.mp4`);
    const finalPoster = join(publicDir, `${name}.jpg`);
    const videoPartial = `${finalVideo}.partial`;
    const posterPartial = `${finalPoster}.partial`;
    await copyFile(muxed, videoPartial);
    await copyFile(poster, posterPartial);
    await rename(videoPartial, finalVideo);
    await rename(posterPartial, finalPoster);
    (manifest.demos as unknown[]).push({ name, filmId: createdFilm.film, duration: finalDuration, originalAudioMd5: await audioHash(original), deliveredAudioMd5: await audioHash(finalVideo), videoSha256: createHash("sha256").update(await readFile(finalVideo)).digest("hex"), posterSha256: createHash("sha256").update(await readFile(finalPoster)).digest("hex"), reviewFrames: times });
    console.log(`PASS ${name}: motor real, seis frames e narração original preservada`);
  }
  await writeFile(join(artifacts, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await main();
