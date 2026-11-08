# Videosell Product Tour Upsell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six-reference upsell with two improved demonstrations and a real application tour while preserving each original narration and the Cakto offer contract.

**Architecture:** Build media through the same local avatar/film services delivered by the studio plan. Capture the real Electron application with Playwright, then keep the static self-contained upsell and its accessible controller. Validate audio streams, local assets, browser behavior and visual output before replacing approved artifacts.

**Tech Stack:** TypeScript, Electron, Playwright, FFmpeg, existing Avatar/Film services, static HTML/CSS/JavaScript, Vitest.

---

## Entry gate and preservation rules

Execute after Tasks 1–7 of `2026-11-06-videosell-studio.md` are approved. Preserve all existing local diffs and never overwrite `electron/core/film-studio.ts`, `electron/core/studio-tool-defs.ts`, `electron/core/studio.ts` or `resources/film-recipes/pixel/index.html` for this upsell work. Preserve `href="#COMPRAR"` with `data-cakto-upsell`, `href="#RECUSAR"` with `data-cakto-downsell`, R$ 97 and pagamento único. Do not publish or configure Cakto.

### Task 1: Lock the two-comparison and product-tour contract

**Files:**
- Modify: `tests/upsell-page.test.ts`
- Modify: `tools/check-upsell-page.mjs`

- [ ] **Step 1: Replace the obsolete six-comparison assertions**

```ts
it("mostra somente dois comparativos e um tour real do produto", async () => {
  const originals = Array.from(document.querySelectorAll("a.orig"));
  expect(originals).toHaveLength(2);
  expect(originals.map((node) => node.getAttribute("href"))).toEqual(expect.arrayContaining([
    "https://x.com/finnardley/status/2116010421740007894",
    "https://x.com/twoclipping/status/2103835273813496100",
  ]));
  expect(document.querySelector("#produto-por-dentro")).not.toBeNull();
  const screens = Array.from(document.querySelectorAll("#produto-por-dentro img[data-studio-screen]"));
  expect(screens.length).toBeGreaterThanOrEqual(4);
  await Promise.all(screens.map((image) => access(localMediaPath(image.getAttribute("src")!)!)));
});
```

Change the local-media minimum from 12 to 8 and require at least two CTAs in the browser smoke test while changing `.orig` from `>= 6` to `=== 2`.

- [ ] **Step 2: Verify the contract fails for the current page**

Run: `npm test -- tests/upsell-page.test.ts`
Expected: FAIL because six `.orig` links exist and `#produto-por-dentro` is absent.

- [ ] **Step 3: Commit the new contract**

```bash
git add tests/upsell-page.test.ts tools/check-upsell-page.mjs
git commit -m "test: require Videosell product tour and two comparisons"
```

### Task 2: Generate better demonstrations with identical narration

**Files:**
- Create: `tools/build-upsell-demos.ts`
- Create: `tests/upsell-demo-media.test.ts`
- Replace after approval: `site/upsell/videos/professor.mp4`, `professor.jpg`, `ui-motion.mp4`, `ui-motion.jpg`
- Create: `artifacts/upsell-demos/`

- [ ] **Step 1: Write media assertions before replacement**

```ts
const audioHash = async (file: string) => execFile(ffmpegPath, [
  "-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "copy", "-f", "md5", "-",
]);

expect(await audioHash("site/upsell/videos/professor.mp4")).toEqual(
  await audioHash("artifacts/upsell-demos/original/professor.mp4"),
);
expect(await audioHash("site/upsell/videos/ui-motion.mp4")).toEqual(
  await audioHash("artifacts/upsell-demos/original/ui-motion.mp4"),
);
```

Also probe 1080 × 1920, 30 fps, 48 kHz audio, nonzero duration and poster dimensions. Preserve the two source MP4s in `artifacts/upsell-demos/original/` before the first replacement.

- [ ] **Step 2: Build through the real local services**

`tools/build-upsell-demos.ts` must load an approved example package from `resources/avatar-engine/examples/`, persist/select its immutable revision with `AvatarService`, create the avatar film through the snapshot adapter delivered in studio Task 6, and use `Films.setVoice` with the original MP4 as `voice.file` and `probeAudio(original).duration`. Omitting word timestamps is permitted because `Films.setVoice` still computes `TIMING.envelope`; do not synthesize or transcribe replacement narration.

```ts
await films.setVoice(filmId, {
  file: originalVideo,
  duration: await probeAudio(originalVideo),
  provider: "arquivo",
  voice: "narracao-original",
});
```

Generate the interface demonstration with the existing film renderer and real application frames captured by the same generator through Playwright before animation; save those source frames under `artifacts/upsell-demos/ui-frames/`, not an invented motion mockup. Task 3 independently captures the four static tour surfaces and does not need to precede this task. Render to staging, inspect at least six frames and the actual MP4, then copy the original audio stream over the staged video and atomically replace the public assets only when all media assertions pass.

- [ ] **Step 3: Verify generation and narration**

Run: `npx tsx tools/build-upsell-demos.ts && npm test -- tests/upsell-demo-media.test.ts`
Expected: both videos and posters pass; both audio-stream hashes match the preserved originals; no external request occurs during rendering.

- [ ] **Step 4: Commit approved media and reproducible generator**

```bash
git add tools/build-upsell-demos.ts tests/upsell-demo-media.test.ts site/upsell/videos artifacts/upsell-demos
git commit -m "feat: regenerate upsell demos with original narration"
```

### Task 3: Capture the real application tour

**Files:**
- Create: `tools/capture-videosell-tour.mjs`
- Create: `site/upsell/videos/studio-avatar.png`, `studio-profiles.png`, `studio-reel.png`, `studio-editor.png`
- Create: `artifacts/upsell-tour/`

- [ ] **Step 1: Capture four actual application surfaces**

Launch Electron with isolated `CUTROOM_USER_DATA`, fixture avatar/project data and no provider secrets. Capture the real avatar creator, profiles, Reel review and advanced editor. Use stable accessible locators from the studio implementation and assert each target is visible before capturing.

```js
await page.getByRole("heading", { name: "Criar meu avatar" }).waitFor();
await page.screenshot({ path: "site/upsell/videos/studio-avatar.png" });
```

Record viewport, app commit, fixture identity and source screenshot hashes in `artifacts/upsell-tour/manifest.json`. Do not use conceptual mockups or claim fixture data belongs to the user.

- [ ] **Step 2: Inspect captures**

Open all four PNGs, verify text legibility at mobile display size and ensure no key, token, real personal project or provider account appears. Regenerate after correcting any actual UI defect rather than hiding it with cropping.

- [ ] **Step 3: Commit the tour evidence**

```bash
git add tools/capture-videosell-tour.mjs site/upsell/videos/studio-*.png artifacts/upsell-tour
git commit -m "test: capture real Videosell application tour"
```

### Task 4: Rebuild the page around the product and validate

**Files:**
- Modify: `site/upsell/index.html`
- Modify: `artifacts/upsell/upsell-1440.png`, `upsell-768.png`, `upsell-390.png`, `upsell-320.png`

- [ ] **Step 1: Replace four comparisons with the product tour**

Keep only the professor and ui-motion comparison cards. Add a responsive `#produto-por-dentro` section before the funnel with the four real screens, captions describing implemented behavior and no fictional saved projects. Update the hero and comparison copy to reflect the now-implemented avatar studio truthfully.

- [ ] **Step 2: Preserve accessibility and offer behavior**

Retain the corrected sound controller, two Cakto CTAs, downsells, focus indicators, reduced motion, safe external links and remote-thumbnail fallback. All new images need meaningful alt text and local paths; no new remote dependency is allowed.

- [ ] **Step 3: Run complete validation**

Run: `npm test -- tests/upsell-page.test.ts tests/upsell-video-controller.test.ts tests/upsell-demo-media.test.ts && node tools/check-upsell-page.mjs && npm run build`
Expected: all tests pass, four viewports pass, no local-media/runtime errors and production build succeeds.

- [ ] **Step 4: Inspect and correct the final page**

Open all four full-page screenshots and representative frames of both MP4s. Verify the hero, exactly two comparisons, four-screen tour, R$ 97 offer and mobile reading order. Correct visual defects before approval.

- [ ] **Step 5: Commit and hand off without publishing**

```bash
git add site/upsell/index.html artifacts/upsell
git commit -m "feat: focus Videosell upsell on the actual product"
```
