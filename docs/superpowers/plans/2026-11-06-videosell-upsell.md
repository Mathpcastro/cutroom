# Videosell Carrossell Upsell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `site/upsell/index.html` as the public Carrossell upsell page that sells Videosell for the existing R$ 97 one-time offer, restores original-versus-generated comparisons, and preserves Cakto integration hooks.

**Architecture:** Keep a self-contained static HTML page with local MP4/JPEG assets, inline CSS and a small accessible video controller. Use the approved Palco digital identity and factual current capabilities; do not add checkout logic, billing, fake plan state or claims about the unfinished avatar engine. Original references open on X with safe external links while generated demonstrations remain local.

**Tech Stack:** Semantic HTML, CSS, vanilla JavaScript, IntersectionObserver, local MP4/JPEG, Playwright for desktop/mobile/accessibility smoke tests.

---

## File map

- Modify `site/upsell/index.html`: complete visual/copy rewrite and comparison restoration.
- Keep `site/upsell/videos/*.mp4` and `*.jpg`: existing local demonstrations; no media replacement without visual verification.
- Create `tools/check-upsell-page.mjs`: static-server browser validation.
- Create `tests/upsell-page.test.ts`: source contract, Cakto hooks, local media and honest-offer checks.
- Reference `docs/superpowers/specs/2026-11-06-avatar-studio-design.md`, sections 14–15.
- Reference the approved visual mockup only for brand direction; do not ship its conceptual mascot as a product demonstration.

### Task 1: Lock the offer, media and Cakto contract with tests

**Files:**
- Create: `tests/upsell-page.test.ts`

- [ ] **Step 1: Write failing source-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

const pagePath = "site/upsell/index.html";
const readPage = () => readFile(pagePath, "utf8");

describe("Videosell upsell page", () => {
  it("presents Videosell as the Carrossell upsell at the existing price", async () => {
    const html = await readPage();
    expect(html).toContain("Videosell");
    expect(html).toContain("Carrossell");
    expect(html).toContain("R$ 97");
    expect(html).toContain("Pagamento único");
    expect(html).toContain('data-cakto-upsell');
    expect(html).toContain('data-cakto-downsell');
    expect(html).toContain('href="#COMPRAR"');
    expect(html).toContain('href="#RECUSAR"');
    expect(html).not.toMatch(/gratuito|open.source|teste grátis|garantia de vendas/i);
  });

  it("uses only existing local demonstration media", async () => {
    const html = await readPage();
    const sources = [...html.matchAll(/(?:src|poster)="(videos\/[^"]+)"/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThanOrEqual(12);
    await Promise.all(sources.map((source) => access(`site/upsell/${source}`)));
  });

  it("restores original-versus-generated comparison links", async () => {
    const html = await readPage();
    expect(html.match(/class="orig"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain("https://x.com/finnardley/status/2116010421740007894");
    expect(html).toContain("https://x.com/twoclipping/status/2103835273813496100");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
```

- [ ] **Step 2: Run tests against the old page and record the expected failure**

Run: `npm test -- tests/upsell-page.test.ts`
Expected: FAIL on Videosell naming and missing `.orig` comparisons. Existing media must pass; a missing-media failure means the test discovered a separate asset problem that must be fixed before visual work.

- [ ] **Step 3: Commit the regression contract**

```bash
git add tests/upsell-page.test.ts
git commit -m "test: define Videosell upsell page contract"
```

### Task 2: Apply Palco digital and rebuild the hero

**Files:**
- Modify: `site/upsell/index.html:1-116`

- [ ] **Step 1: Replace metadata, fonts and design tokens**

Use this title and description:

```html
<title>Videosell — avatares e vídeos com IA para o seu produto</title>
<meta name="description" content="Complemente o Carrossell com Reels, narração, formatos em código e publicação. Videosell por R$ 97, pagamento único.">
```

Load Sora and Inter for this public page. Define tokens shared by every section:

```css
:root {
  --ink: #141318;
  --ink-2: #1B1B22;
  --paper: #F7F6F1;
  --white: #FFFFFF;
  --muted: #6E6B77;
  --violet: #7C5CFF;
  --violet-deep: #6445D8;
  --lime: #C8FF5A;
  --line: #DDD9E2;
}
body { margin: 0; color: var(--ink); background: var(--paper); font-family: Inter, system-ui, sans-serif; line-height: 1.5; }
h1, h2, h3, .wordmark { font-family: Sora, sans-serif; letter-spacing: -.04em; }
:focus-visible { outline: 3px solid var(--lime); outline-offset: 4px; }
```

The button uses `var(--violet-deep)` with white text; lime is reserved for accents and dark-surface highlights. Do not use lime body text on white.

- [ ] **Step 2: Add the actual Videosell logo**

Use the approved geometry, not two legacy CutRoom bars:

```html
<a class="brand" href="#inicio" aria-label="Videosell — início">
  <svg width="42" height="42" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect width="64" height="64" rx="18" fill="#7C5CFF"/>
    <path d="M15 17L28.2 46C29.7 49.3 34.3 49.3 35.8 46L43 30" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="46" cy="18" r="5" fill="#C8FF5A"/>
  </svg>
  <span class="wordmark">Video<span>sell</span></span>
</a>
```

- [ ] **Step 3: Rewrite the hero with current, supportable copy**

Use the existing `videos/professor.mp4` and poster in the phone. Hero copy:

```html
<p class="eyebrow">Carrossell + Videosell</p>
<h1>Seu produto ganha <span>rosto, voz e presença.</span></h1>
<p class="lead">Você já cria carrosséis com o Carrossell. Com o Videosell, transforma ideias em Reels com roteiro, narração, animação e a sua marca — tudo no seu computador, com a IA que você já usa.</p>
<div class="mech" aria-label="Como funciona">
  <span><b>1</b> Descreva o vídeo</span><span><b>2</b> Revise o resultado</span><span><b>3</b> Publique no seu perfil</span>
</div>
<a class="cta" href="#COMPRAR" data-cakto-upsell>Quero o Videosell <small>por R$ 97</small></a>
<p class="price">Pagamento único. Oferta desta página.</p>
<a class="no" href="#RECUSAR" data-cakto-downsell>Não, obrigado. Vou continuar somente com os carrosséis.</a>
```

Do not say the customizable avatar engine is already available. Current demonstrations may be described as pixel-art presenter, UI motion, landing flyover, stickman, “E se…” and illustrated explainer.

- [ ] **Step 4: Build responsive hero and phone styles**

Desktop uses two columns; at `max-width: 760px`, one column, `h1` clamps to readable mobile size, CTA wraps, and the phone stays below the copy. The phone video uses `autoplay muted loop playsinline preload="metadata" data-autoplay` and an accessible sound button added by the controller in Task 5.

- [ ] **Step 5: Run contract tests and inspect desktop/mobile**

Run: `npm test -- tests/upsell-page.test.ts`
Expected: naming/price/media assertions PASS; comparison assertion still FAIL until Task 3. Capture the page at 1440×1000 and 390×844 and inspect the hero before continuing.

- [ ] **Step 6: Commit**

```bash
git add site/upsell/index.html tests/upsell-page.test.ts
git commit -m "feat: rebrand Carrossell upsell hero for Videosell"
```

### Task 3: Restore six original-versus-generated comparisons

**Files:**
- Modify: `site/upsell/index.html`

- [ ] **Step 1: Create one reusable comparison structure per format**

Each comparison contains a local generated video and an `.orig` link. Use this structure and repeat with the exact pairs below:

```html
<article class="case">
  <h3>Aula com <span>apresentador em pixel art</span></h3>
  <div class="reel">
    <video src="videos/professor.mp4" poster="videos/professor.jpg" muted loop playsinline preload="metadata" data-autoplay></video>
    <span class="tag-ours">Feito no Videosell</span>
    <a class="orig" href="https://x.com/finnardley/status/2116010421740007894" target="_blank" rel="noopener noreferrer" aria-label="Ver referência original de @finnardley no X">
      <img src="https://pbs.twimg.com/amplify_video_thumb/2116009362552434688/img/jkPpJnTcWGJQzywL.jpg" alt="Referência original de @finnardley" loading="lazy">
      <span>Referência no X</span>
    </a>
  </div>
  <p>Apresentador em pixel art, narração e cartões sincronizados com a fala.</p>
</article>
```

Pairs:

1. `professor` → the URL/image above, `@finnardley`.
2. `ui-motion` → `https://x.com/twoclipping/status/2103835273813496100`, image `https://pbs.twimg.com/amplify_video_thumb/2103830256347910144/img/YsUzKmE5XqGD9NZR.jpg`.
3. `landing-flyover` → `https://x.com/twoclipping/status/2110329502676951367`, image `https://pbs.twimg.com/amplify_video_thumb/2110328827956068352/img/Yfz92C5G-vOXGdv4.jpg`.
4. `stickman` → `https://x.com/finnardley/status/2115786060231770351`, image `https://pbs.twimg.com/amplify_video_thumb/2115784242701500416/img/a_e-E2kTPxvwNIU5.jpg`.
5. `e-se` → `https://x.com/finnardley/status/2117997239125585942`, image `https://pbs.twimg.com/amplify_video_thumb/2117994784631541761/img/VzOtyP3iKz8Z5d3a.jpg`.
6. `kurzgesagt` → `https://x.com/finnardley/status/2114305886420086817`, image `https://pbs.twimg.com/amplify_video_thumb/2114305237498388481/img/DMcFgslJnlOdVQ94.jpg`.

Keep attribution and do not reproduce old view/save counts as current facts. Describe the pairs as “referência de formato”, never “o Videosell faz igual” or evidence of guaranteed viral performance.

- [ ] **Step 2: Add a graceful local fallback for remote reference thumbnails**

Remote X images are references, not required render assets. Add an `onerror` handler through JavaScript that hides only the failed image and replaces it with a text card containing the creator handle and “Abrir referência no X”. Do not silently remove the link or download third-party media into the product.

- [ ] **Step 3: Layout comparisons without nested horizontal overflow**

Desktop: three cards per row with `.orig` inset at the lower-right. Mobile: one card per row; no mandatory horizontal carousel. Keep 9:16 media, visible captions and 44 px minimum sound/link targets. The page itself must have no horizontal scroll at 320, 390, 768 and 1440 px.

- [ ] **Step 4: Run comparison tests**

Run: `npm test -- tests/upsell-page.test.ts`
Expected: all source-contract tests PASS with at least six `.orig` links and all local media present.

- [ ] **Step 5: Commit**

```bash
git add site/upsell/index.html
git commit -m "feat: restore upsell original video comparisons"
```

### Task 4: Rewrite the funnel, inclusions and final offer honestly

**Files:**
- Modify: `site/upsell/index.html`

- [ ] **Step 1: Replace monetization filler with the Carrossell + Videosell workflow**

Use four stages: `Reels alcançam`, `Perfil recebe`, `Carrosséis aprofundam`, `Link apresenta a oferta`. The last stage is not a promised sale. Keep the seven-day example as an example, not an automatic schedule created by visiting the page.

- [ ] **Step 2: Keep only current inclusions**

List the existing desktop app and updates, seven current formats with starter films/guides, local narration, optional ElevenLabs/OpenAI voices with the user's keys, music/effects with credits, Claude Code/Codex skill, review and export, and configured Instagram scheduling. Do not list custom avatar creation, multiple commercial profiles or the new visual studio until the corresponding implementation is delivered.

- [ ] **Step 3: Retain qualified proof and third-party cost disclosure**

If retaining the existing Matheus result, use exactly: “Resultado individual do Matheus, não uma promessa de faturamento. Resultados dependem do produto, da oferta, da execução e da constância.” Do not add new numbers. Add: “Claude, Codex, provedores de IA e vozes premium podem cobrar separadamente nas suas próprias contas.”

- [ ] **Step 4: Close with the same real offer and hooks**

```html
<section class="dark final" id="oferta">
  <div class="wrap">
    <p class="eyebrow">Carrossell + Videosell</p>
    <h2>Complete seu conteúdo com vídeo.</h2>
    <p class="sub">Crie, revise e publique Reels com a IA e a marca que você já usa.</p>
    <a class="cta" href="#COMPRAR" data-cakto-upsell>Quero o Videosell <small>por R$ 97</small></a>
    <p class="price">Pagamento único. Oferta desta página.</p>
    <a class="no" href="#RECUSAR" data-cakto-downsell>Não, obrigado.</a>
  </div>
</section>
<footer>Videosell · Carrossell</footer>
```

- [ ] **Step 5: Commit**

```bash
git add site/upsell/index.html
git commit -m "feat: align Videosell upsell offer and funnel"
```

### Task 5: Accessible media behavior and reduced motion

**Files:**
- Modify: `site/upsell/index.html`

- [ ] **Step 1: Replace the video controller**

Use real button labels and states, pause offscreen videos, mute every other video before enabling sound, and honor reduced motion:

```js
const videos = [...document.querySelectorAll("video[data-autoplay]")];
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const soundButtons = new Map();

for (const video of videos) {
  const button = document.createElement("button");
  button.className = "sound";
  button.type = "button";
  button.textContent = "Ouvir";
  button.setAttribute("aria-label", `Ouvir vídeo: ${video.closest("article")?.querySelector("h3")?.textContent?.trim() || "demonstração"}`);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", async () => {
    const enableSound = video.muted;
    for (const other of videos) {
      other.muted = true;
      if (other !== video) other.pause();
      const otherButton = soundButtons.get(other);
      otherButton.textContent = "Ouvir";
      otherButton.setAttribute("aria-pressed", "false");
    }
    video.muted = !enableSound;
    button.textContent = enableSound ? "Sem som" : "Ouvir";
    button.setAttribute("aria-pressed", String(enableSound));
    if (enableSound) { video.currentTime = 0; await video.play(); }
  });
  soundButtons.set(video, button);
  video.parentElement.append(button);
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const video = entry.target;
    if (entry.isIntersecting && !reduced.matches && video.muted) video.play().catch(() => {});
    else if (!entry.isIntersecting) video.pause();
  }
}, { threshold: 0.35 });
videos.forEach((video) => observer.observe(video));
reduced.addEventListener("change", () => { if (reduced.matches) videos.forEach((video) => video.pause()); });
```

Remove the `autoplay` attribute from every video in the markup so no browser starts playback before the controller evaluates reduced motion. All automatic playback is owned by this controller. A user clicking “Ouvir” is an explicit play request and may play under reduced motion.

- [ ] **Step 2: Add non-motion and mobile safeguards**

Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }`. Remove decorative animation, not the user's ability to manually play videos. Ensure external links have discernible names and lazy reference images have alt text.

- [ ] **Step 3: Commit**

```bash
git add site/upsell/index.html
git commit -m "feat: make upsell video previews accessible"
```

### Task 6: Real browser validation and visual approval

**Files:**
- Create: `tools/check-upsell-page.mjs`

- [ ] **Step 1: Implement a static-server Playwright smoke test**

Use `node:http` to serve only `site/upsell`, normalize paths, reject traversal and return correct MIME types for HTML, MP4, JPEG and SVG. Launch Playwright Chromium and check 1440×1000, 768×1024, 390×844 and 320×740:

```js
const sizes = [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }];
for (const viewport of sizes) {
  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error(`Overflow horizontal em ${viewport.width}px`);
  if (await page.locator(".orig").count() < 6) throw new Error("Comparativos ausentes");
  if (await page.locator("[data-cakto-upsell]").count() < 2) throw new Error("CTAs da Cakto ausentes");
  await page.screenshot({ path: `artifacts/upsell/upsell-${viewport.width}.png`, fullPage: true });
}
```

Capture `pageerror`, console errors and failed local media requests. External X image failures use the designed fallback and are reported separately, not confused with missing local assets.

- [ ] **Step 2: Add keyboard and reduced-motion checks**

Tab to the first CTA and verify focus visibility and `href="#COMPRAR"`. Emulate reduced motion, reload, wait for intersection and assert all videos remain paused. Activate the first sound button with Enter and verify `aria-pressed="true"` and only that video is unmuted.

- [ ] **Step 3: Run all validation**

Run: `npm test -- tests/upsell-page.test.ts && node tools/check-upsell-page.mjs && npm run build`
Expected: source tests PASS, no local media errors, no page errors, no unintended horizontal overflow, keyboard/reduced-motion checks PASS and app production build remains successful.

- [ ] **Step 4: Inspect the actual screenshots**

Open all four full-page screenshots and verify hero, comparison cards, price, CTA and mobile reading order. Correct visual defects before approval; do not treat a successful DOM assertion as visual approval.

- [ ] **Step 5: Commit and hand off**

```bash
git add site/upsell/index.html tools/check-upsell-page.mjs artifacts/upsell
git commit -m "test: validate Videosell upsell across desktop and mobile"
```

Deliver the HTML path and screenshots for user review. Do not upload to Cakto, change the course, publish the offer or activate a checkout in this task.
