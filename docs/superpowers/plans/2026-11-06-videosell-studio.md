# Videosell Studio and Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved avatar engine into the Videosell visual studio with independent profiles, avatar and non-avatar creation, advanced-editor preservation, full MCP parity and the approved Palco digital identity.

**Architecture:** A profile-scoped React shell calls the same application services exposed through IPC and MCP. Films reference immutable avatar revisions while advanced-editor projects retain their existing schema and persisted CutRoom identifiers. The UI is delivered only after the avatar-engine plan's real candidate receives explicit visual approval.

**Tech Stack:** React 19, TypeScript, Electron IPC/utilityProcess, Zod, existing Film/Voice/Render/Publish services, Vitest, Playwright Electron, Sora/Inter and local SVG/PNG/ICO brand assets.

---

## Entry gate and preservation rules

Before Task 1, verify that `docs/superpowers/plans/2026-11-06-videosell-avatar-engine.md` is complete, its three candidates were rendered through the real engine and the user approved one visually. If that approval is absent, execute only the independent upsell plan.

Read and preserve the current diffs in `electron/core/film-studio.ts`, `electron/core/studio-tool-defs.ts`, `electron/core/studio.ts` and `resources/film-recipes/pixel/index.html`. Never use `git checkout`, `git restore` or whole-file rewrites on these files. Apply additive edits around the external-audio and pixel-legibility work already present.

## File map

- Modify `src/shared/branding.ts`, `src/components/BrandMark.tsx`, `tools/generate-brand.ts`, `docs/branding.md`: single brand source and generated assets.
- Create `src/components/VideosellStudio.tsx`, `studio/*.tsx` and `studio/studio.css`: focused shell and page components.
- Create `electron/core/profile-store.ts`, `profile-service.ts`, `profile-tool-defs.ts`: profiles and migration.
- Create `src/shared/profile.ts`: versioned profile contract and non-secret credential references.
- Modify `src/App.tsx`, `src/shared/types.ts`, `electron/preload.ts`, `electron/main.ts`: studio entry and IPC bridge.
- Modify `electron/core/film.ts`, `electron/core/film-studio.ts`, `electron/core/studio-tool-defs.ts`: optional immutable avatar revision on films.
- Modify visible product metadata in `package.json`, `index.html`, `electron/main.ts`, assistant copy and public website text separately from internal protocol identifiers.
- Create Playwright checks under `tools/` and domain tests under `tests/`.

### Task 1: Generate the approved Videosell brand system

**Files:**
- Modify: `src/shared/branding.ts`
- Modify: `src/components/BrandMark.tsx`
- Modify: `tools/generate-brand.ts`
- Modify: `docs/branding.md`
- Create: `tests/videosell-brand.test.ts`

- [ ] **Step 1: Write failing brand-source tests**

```ts
import { describe, expect, it } from "vitest";
import { brandColors, brandName, brandTagline, brandViewBox } from "../src/shared/branding";

describe("Videosell brand", () => {
  it("uses the approved Palco digital identity", () => {
    expect(brandName).toBe("Videosell");
    expect(brandTagline).toBe("Avatares de IA para apresentar e vender seu produto.");
    expect(brandColors).toMatchObject({ ink: "#141318", violet: "#7C5CFF", lime: "#C8FF5A", paper: "#F7F6F1" });
    expect(brandViewBox).toBe("0 0 64 64");
  });
});
```

- [ ] **Step 2: Run and verify failure against the legacy brand**

Run: `npm test -- tests/videosell-brand.test.ts`
Expected: FAIL because the old source has no Videosell name, palette or 64×64 viewBox.

- [ ] **Step 3: Implement the shared identity**

```ts
export const brandName = "Videosell";
export const brandTagline = "Avatares de IA para apresentar e vender seu produto.";
export const brandViewBox = "0 0 64 64";
export const brandColors = { ink: "#141318", violet: "#7C5CFF", violetDeep: "#6445D8", lime: "#C8FF5A", paper: "#F7F6F1", white: "#FFFFFF" } as const;
export const brandPath = "M15 17L28.2 46C29.7 49.3 34.3 49.3 35.8 46L43 30";
```

`BrandMark` renders a rounded square, the shared path with 7 px rounded white stroke and the lime circle at `(46,18,r=5)`. Add `title` support for standalone accessible usage while decorative wordmark icons remain `aria-hidden`.

- [ ] **Step 4: Update deterministic asset generation**

Generate SVG, PNG, ICO and ICNS from the same geometry and colors. Keep the Windows icon legible at 16 px and inspect actual output at 16, 32, 48 and 256 px. Package Sora and Inter locally with their OFL license files; do not require Google Fonts during application render. Keep `signExecutable: false` until signing exists.

- [ ] **Step 5: Run brand generation and tests**

Run: `npx tsx tools/generate-brand.ts && npm test -- tests/videosell-brand.test.ts`
Expected: PASS and regenerated assets under `resources/branding`, with favicon updated. Document the command and local-font behavior in `docs/branding.md`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/branding.ts src/components/BrandMark.tsx tools/generate-brand.ts resources/branding public docs/branding.md resources/fonts resources/licenses tests/videosell-brand.test.ts
git commit -m "feat: apply Videosell Palco digital brand"
```

### Task 2: Versioned independent profiles with safe migration

**Files:**
- Create: `src/shared/profile.ts`
- Create: `electron/core/profile-store.ts`
- Create: `electron/core/profile-service.ts`
- Test: `tests/profile-store.test.ts`
- Test: `tests/profile-migration.test.ts`

- [ ] **Step 1: Write failing profile tests**

```ts
it("keeps two profiles and their projects independent", async () => {
  const service = new ProfileService({ store, secrets });
  const a = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
  const b = await service.create({ name: "Matheus", handle: "matheus" });
  await service.update(a.id, { brand: { accent: "#7C5CFF" }, voice: { provider: "local", voiceId: "atlas" } });
  await service.linkProject(a.id, "film-orbit");
  await service.linkProject(b.id, "film-matheus");
  expect((await service.get(b.id)).brand.accent).not.toBe("#7C5CFF");
  expect(await service.listProjects(a.id)).toEqual(["film-orbit"]);
  expect(await service.listProjects(b.id)).toEqual(["film-matheus"]);
});

it("migrates global brand and voice without copying secrets", async () => {
  const profile = await migrateLegacyProfile({ brand: legacyBrand, voice: legacyVoice, root });
  expect(profile.name).toBe("Perfil padrão");
  expect(profile.voice.credentialRef).toBe("elevenlabs");
  expect(JSON.stringify(profile)).not.toContain(legacyVoice.apiKey);
});
```

Use a fake secret store and fixtures with a recognizable fake key; assert no secret appears in profile JSON, film JSON or logs.

- [ ] **Step 2: Run and confirm missing profile modules**

Run: `npm test -- tests/profile-store.test.ts tests/profile-migration.test.ts`
Expected: FAIL resolving profile modules.

- [ ] **Step 3: Implement the profile schema**

```ts
export interface StudioProfile {
  version: 1;
  id: string;
  name: string;
  handle: string;
  defaultAvatar?: { avatarId: string; revision: number; hash: string };
  voice: { provider: "elevenlabs" | "kokoro" | "openai" | "local"; voiceId: string; credentialRef?: string };
  personality: { description: string; presentation: string };
  brand: { name: string; accent: string; ink: string; paper: string; logoAssetId?: string };
  instagram: { connectionId?: string; preferences: Record<string, unknown> };
  commercialGoal: string;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Strictly validate IDs, handles, colors and avatar hashes. Secrets remain in `SecretStore`; profiles contain only non-secret references.

- [ ] **Step 4: Implement atomic storage and migration**

Store under `<userData>/profiles/<id>/profile.json`, write `.partial` then rename, and store a small `profiles/index.json` with active profile ID. Store linked film IDs in `<userData>/profiles/<id>/projects.json`; implement `linkProject(profileId, filmId)` and `listProjects(profileId)` with duplicate/foreign-ID rejection and atomic writes. Migrate existing global `brand.json`, `voice.json` and publish preferences once into `Perfil padrão`; retain legacy files until all tests pass and never duplicate secrets. Deleting a profile requires explicit confirmation and cannot silently delete shared media.

- [ ] **Step 5: Run profile and migration tests**

Run: `npm test -- tests/profile-store.test.ts tests/profile-migration.test.ts`
Expected: PASS for two-profile isolation, atomic writes, default migration and secret exclusion.

- [ ] **Step 6: Commit**

```bash
git add src/shared/profile.ts electron/core/profile-store.ts electron/core/profile-service.ts tests/profile-store.test.ts tests/profile-migration.test.ts
git commit -m "feat: add isolated Videosell creator profiles"
```

### Task 3: Shared profile IPC and MCP coverage

**Files:**
- Create: `electron/core/profile-tool-defs.ts`
- Modify: `electron/core/codex.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/profile-mcp.test.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write failing parity tests**

Require `profile_create`, `profile_get`, `profile_list`, `profile_update`, `profile_duplicate`, `profile_delete`, `profile_select` and `profile_list_projects`. Assert UI IPC and MCP call the same `ProfileService` methods and delete requires `{ profileId, confirmation: "DELETE" }` plus explicit caller authorization.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/profile-mcp.test.ts tests/providers.test.ts`
Expected: FAIL because profile tools are absent.

- [ ] **Step 3: Implement definitions and dispatch**

Use strict object schemas; never accept a destination path, credential value or arbitrary Instagram publish action in profile tools. `profile_duplicate` copies brand/preferences and avatar references but not secret values or projects. Register tools once in `EDITOR_TOOLS` and once in the main dispatch map.

- [ ] **Step 4: Expose typed preload methods**

Add `window.cutroom.studioProfiles` with `list`, `get`, `create`, `update`, `duplicate`, `select` and `remove`. Keep the `window.cutroom` identifier for compatibility even though visible copy says Videosell.

- [ ] **Step 5: Run parity tests**

Run: `npm test -- tests/profile-mcp.test.ts tests/providers.test.ts tests/desktop-mcp.test.ts`
Expected: PASS, no duplicate tool names, and deletion cannot occur without confirmation.

- [ ] **Step 6: Commit**

```bash
git add electron/core/profile-tool-defs.ts electron/core/codex.ts electron/main.ts electron/preload.ts src/shared/types.ts tests/profile-mcp.test.ts tests/providers.test.ts
git commit -m "feat: share creator profiles across UI and MCP"
```

### Task 4: Build the studio shell and new application entry

**Files:**
- Create: `src/components/VideosellStudio.tsx`
- Create: `src/components/studio/StudioHome.tsx`
- Create: `src/components/studio/StudioNav.tsx`
- Create: `src/components/studio/ProfileSwitcher.tsx`
- Create: `src/components/studio/studio.css`
- Modify: `src/App.tsx`
- Modify: `index.html`
- Modify: `package.json` visible metadata only
- Test: `tools/check-videosell-studio.mjs`

- [ ] **Step 1: Write the failing Electron navigation check**

Launch the real Electron app with isolated `CUTROOM_USER_DATA`. Assert initial visible actions are `Criar meu avatar`, `Criar um Reel com avatar`, `Criar sem avatar` and `Continuar criando`; assert `Ajustes avançados` opens the existing editor and the profile switcher is visible.

- [ ] **Step 2: Implement explicit page state, not a new router**

```ts
export type StudioPage = "home" | "avatars" | "create" | "projects" | "voices" | "brand" | "publish" | "settings";
export function VideosellStudio({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const [page, setPage] = useState<StudioPage>("home");
  return <div className="videosell-studio"><StudioNav page={page} onPage={setPage} onOpenAdvanced={onOpenAdvanced} /><StudioHome onPage={setPage} /></div>;
}
```

Split each non-home page into its own component when implemented; `StudioHome` must not become a monolith. Preserve the current `App` editor as `onOpenAdvanced` content and keep existing DOM events/protocols working.

- [ ] **Step 3: Apply the approved home composition**

Implement sidebar `Início`, `Meus avatares`, `Projetos`, `Vozes`, `Marca`, `Conexões`, profile switcher and advanced entry. Main content includes the three creation choices and recent projects. Use real profile/project data; empty states must not display fictional Nexo, Orbit Labs or project cards as saved user data.

- [ ] **Step 4: Change visible product metadata without breaking identifiers**

Set visible title/product name/artifact names to Videosell where release compatibility allows. Preserve npm package name, GitHub repository, `appId`, update channel, `window.cutroom`, `cutroom://`, `.cutroom.json` and existing storage paths in this task. If artifact renaming can break updates, keep the old artifact name and record the release migration separately rather than silently breaking updates.

- [ ] **Step 5: Run navigation and regression checks**

Run: `node tools/check-videosell-studio.mjs && npm test && npm run build`
Expected: studio is the initial surface, advanced editor opens and existing tests/build PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/VideosellStudio.tsx src/components/studio src/App.tsx src/shared/types.ts index.html package.json tools/check-videosell-studio.mjs
git commit -m "feat: open Videosell in the creator studio"
```

### Task 5: Visual avatar creator using the approved engine

**Files:**
- Create: `src/components/studio/AvatarCreator.tsx`
- Create: `src/components/studio/AvatarCanvas.tsx`
- Create: `src/components/studio/AvatarPartsPanel.tsx`
- Create: `src/components/studio/AvatarReviewPanel.tsx`
- Modify: `electron/preload.ts`
- Modify: `src/shared/types.ts`
- Test: `tools/check-avatar-creator.mjs`

- [ ] **Step 1: Write failing creator interaction checks**

With a fixture avatar store, verify text-only creation, photo-selection consent, three candidate rendering, candidate selection, expression/pose/mouth tabs, part-only revision and final revision save. Photo consent text must name the selected remote provider; local/offline flows remain available.

- [ ] **Step 2: Implement the canvas from actual engine artifacts**

`AvatarCanvas` loads native PNG or local `ImageData` from `AvatarService`; use CSS `image-rendering: pixelated` and integer display scales. Never substitute an SVG mockup, external generated image or the brand mascot for the engine result.

- [ ] **Step 3: Implement four focused editing areas**

`Aparência`, `Expressões e poses`, `Voz e personalidade`, `Marca`. Appearance edits map to explicit part IDs. Review displays neutral, silhouette, grayscale, backgrounds, expression, mouth and movement sheets plus technical findings. Finalize only after gates pass or the user explicitly approves the shown result; store `approvedByUserAt` separately from automatic scores.

- [ ] **Step 4: Implement reference-photo privacy**

Photo import uses `avatar_import_reference`; preview remains local. Generation/revision sends it only after the user chooses a provider and confirms that action. Do not put the photo in film assets, MP4 or public packages by default.

- [ ] **Step 5: Run creator and engine regression checks**

Run: `node tools/check-avatar-creator.mjs && npm test -- tests/avatar-service.test.ts tests/avatar-render.integration.test.ts`
Expected: real candidate workflow PASS, revision hashes remain deterministic and invalid revisions do not replace the approved one.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/AvatarCreator.tsx src/components/studio/AvatarCanvas.tsx src/components/studio/AvatarPartsPanel.tsx src/components/studio/AvatarReviewPanel.tsx electron/preload.ts src/shared/types.ts tools/check-avatar-creator.mjs
git commit -m "feat: add visual creator for deterministic avatars"
```

### Task 6: Attach immutable avatar revisions to films

**Files:**
- Modify: `electron/core/film.ts:14-24`
- Modify: `electron/core/film-studio.ts`
- Modify: `electron/core/studio-tool-defs.ts`
- Create: `electron/core/film-avatar.ts`
- Test: `tests/film-avatar.test.ts`

- [ ] **Step 1: Preserve unrelated work and write failing snapshot tests**

Read the current diffs before editing. Test creating a film with and without avatar:

```ts
expect(withAvatar.avatar).toEqual({ avatarId, revision: 3, hash: approvedHash });
expect(withoutAvatar.avatar).toBeUndefined();
const oldBytes = await readFile(withAvatarSnapshotPath, "utf8");
await avatarService.revisePart(authorizedRevision);
expect(await readFile(withAvatarSnapshotPath, "utf8")).toBe(oldBytes);
```

Also test explicit `updateFilmAvatar` changing only the target film and cache key.

- [ ] **Step 2: Implement the additive film metadata**

```ts
export interface FilmAvatarRef { avatarId: string; revision: number; hash: string }
export interface FilmMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  avatar?: FilmAvatarRef;
}
```

If the current `FilmMeta` has additional required fields, retain all of them exactly; this snippet shows only the additive relationship, not a replacement interface.

- [ ] **Step 3: Copy revision and engine snapshots per film**

`film-avatar.ts` validates the requested hash against the approved revision, copies package and engine assets into the film's avatar folder, and returns the immutable reference. Render loads only that snapshot. Its voice adapter reads the existing `TIMING.envelope` at 30 fps and maps silence to `X` and quantized energy bands to mouths `A`–`F` without changing the package or moving the baseline; tests cover silence, speech and externally supplied narration already supported by `studio.ts`. Editing a profile has no effect on old films; an explicit update operation is required.

- [ ] **Step 4: Extend existing tools additively**

Add optional `avatar` to film creation and a dedicated update operation. Do not require avatar on any current format and do not remove or rewrite external-audio parameters already present in `film-studio.ts`, `studio-tool-defs.ts` or `studio.ts`.

- [ ] **Step 5: Run film and voice regressions**

Run: `npm test -- tests/film-avatar.test.ts tests/film.test.ts tests/studio.test.ts`
Expected: PASS for avatar/no-avatar films, unchanged old projects, external audio behavior and cache separation.

- [ ] **Step 6: Commit**

```bash
git add electron/core/film.ts electron/core/film-avatar.ts electron/core/film-studio.ts electron/core/studio-tool-defs.ts tests/film-avatar.test.ts
git commit -m "feat: snapshot avatar revisions inside Videosell films"
```

### Task 7: Complete Reel creation with or without avatar

**Files:**
- Create: `src/components/studio/ReelCreator.tsx`
- Create: `src/components/studio/ReelReview.tsx`
- Modify: `src/components/VideosellStudio.tsx`
- Test: `tools/check-reel-flows.mjs`

- [ ] **Step 1: Write two end-to-end flow checks**

With fixture services, create one film with the approved avatar and one using a non-character format. Both follow objective/offer, script, voice, format, scenes, effects, review and export. Assert no avatar selection is required in the second flow and existing formats/effects remain available.

- [ ] **Step 2: Implement a shared creator with optional avatar section**

Use one state machine:

```ts
type ReelDraft = { profileId: string; objective: string; offer: string; script: string; voice: VoiceSelection; formatId: string; avatar?: FilmAvatarRef };
```

`avatar` is optional. Scene components receive the film's immutable avatar snapshot only when present. Do not fork separate render logic for UI and MCP.

- [ ] **Step 3: Integrate review, advanced editor and export**

Review uses actual rendered stills and validation findings. `Ajustes avançados` opens the existing project/timeline with film assets linked. Export uses existing RenderService; immediate Instagram publication still requires explicit confirmation, while schedules follow their original authorization.

- [ ] **Step 4: Run both flows and media checks**

Run: `node tools/check-reel-flows.mjs && npm test -- tests/film-avatar.test.ts tests/composio.test.ts`
Expected: both MP4 flows PASS at 1080×1920, audio 48 kHz, product loudness standard preserved, and publish confirmation behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/ReelCreator.tsx src/components/studio/ReelReview.tsx src/components/VideosellStudio.tsx tools/check-reel-flows.mjs
git commit -m "feat: create Reels with or without avatars"
```

### Task 8: Final visible rebrand, accessibility and migration verification

**Files:**
- Modify: visible CutRoom strings in `src/`, `electron/`, `website/public/index.html` and documentation that describes the product
- Modify: `src/styles.css`, `src/themes.css`
- Create: `tools/check-videosell-release.mjs`

- [ ] **Step 1: Inventory before replacing strings**

Search `CutRoom` and `cutroom` and classify each occurrence as visible product name, persisted identifier, protocol, license/copyright, file format, storage path or third-party integration. Replace only appropriate visible names. Never change license history or compatibility keys by global substitution.

- [ ] **Step 2: Apply Sora/Inter and Palco digital tokens**

Use neutrals for most surfaces, violet for primary actions and lime for accents. Package fonts locally. Test all six existing themes or explicitly consolidate them into a tested Videosell theme while preserving appearance preferences migration; do not leave a theme selector pointing to removed themes.

- [ ] **Step 3: Implement release checks**

Playwright checks studio first-run, two-profile separation, avatar creation with real fixture, non-avatar creation, advanced editor, keyboard/focus, minimum window width, local font loading, zero external requests during render, legacy project opening and no exposed secrets. Verify no marketing surface says the product is free/open source or that unfinished features already exist.

- [ ] **Step 4: Run complete validation**

Run: `npm test && npm run build && node tools/check-design.mjs && node tools/check-usability.mjs && node tools/check-videosell-release.mjs`
Expected: all automated tests/build/checks PASS. Record any external-provider integration separately with provider/model/evidence rather than presenting it as deterministic.

- [ ] **Step 5: Update project records**

Update the Obsidian project state, validation results and diary with actual commands and outcomes. Include unresolved issues and the avatar approval evidence. Do not claim macOS installer validation or real Cakto/Instagram actions unless they were actually performed.

- [ ] **Step 6: Commit**

```bash
git add src electron website/public docs tools/check-videosell-release.mjs
git commit -m "feat: complete Videosell studio migration and release checks"
```
