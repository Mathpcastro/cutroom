# Videosell Avatar Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, local avatar engine that produces three visually distinct pixel-art candidates, validates their rigs and pixels, renders review sheets through MCP, and stops for the user's visual approval.

**Architecture:** Claude/ChatGPT authors bounded JSON packages; the application persists only validated data and renders it with trusted integer raster primitives. A versioned immutable store feeds a Chromium-isolated renderer, shared validation gates, native PNG hashes and MCP tools. No model-authored JavaScript, external image generator, `eval`, Node access or network access enters the render path.

**Tech Stack:** TypeScript, Zod, Node.js crypto/fs, Electron utilityProcess, Chromium via puppeteer-core, Canvas ImageData, Vitest, existing MCP/tool infrastructure.

---

## File map

- Create `src/shared/avatar.ts`: Zod contract, canonical JSON, hashes, IDs and patch rules.
- Create `resources/avatar-engine/avatar-engine.js`: trusted integer rasterizer and rig evaluation.
- Create `resources/avatar-engine/avatar-engine.d.ts`: renderer public types.
- Create `resources/avatar-engine/proof.html` and `proof.js`: local review-sheet entry point with no network.
- Create `electron/core/avatar-store.ts`: atomic immutable revisions and candidate selection.
- Create `electron/core/avatar-render.ts`: worker requests and artifact handling.
- Create `electron/core/avatar-service.ts`: candidate, revision, validation and render use cases.
- Create `electron/core/avatar-tool-defs.ts`: MCP schemas shared by all providers.
- Create `tests/avatar-*.test.ts`: schema, pixels, store, service and MCP parity coverage.
- Modify `electron/render-motion.ts`: add isolated `avatar` mode.
- Modify `electron/core/film.ts`: export the existing worker runner without altering film behavior.
- Modify `electron/core/codex.ts`: append avatar tools to `EDITOR_TOOLS` and update visible assistant identity only in the later branding plan.
- Modify `electron/main.ts`: compose services and dispatch avatar tools.
- Preserve untouched in this plan: `electron/core/film-studio.ts`, `electron/core/studio-tool-defs.ts`, `electron/core/studio.ts`, `resources/film-recipes/pixel/index.html`, which already contain unrelated local work.

### Task 1: Versioned avatar contract and canonical hashes

**Files:**
- Create: `src/shared/avatar.ts`
- Test: `tests/avatar-schema.test.ts`

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { AVATAR_MOUTHS, AVATAR_POSES, avatarHash, parseAvatar, reviseAvatar } from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

describe("avatar contract", () => {
  it("requires every pose, expression and mouth", () => {
    const avatar = parseAvatar(avatarFixture());
    expect(Object.keys(avatar.poses)).toEqual(expect.arrayContaining([...AVATAR_POSES]));
    expect(Object.keys(avatar.mouths)).toEqual(expect.arrayContaining([...AVATAR_MOUTHS]));
  });

  it("canonicalizes key order for deterministic hashes", () => {
    const avatar = parseAvatar(avatarFixture());
    const reversed = JSON.parse(JSON.stringify(avatar, Object.keys(avatar).reverse()));
    expect(avatarHash(reversed)).toBe(avatarHash(avatar));
  });

  it("rejects code strings, cycles, fractional geometry and unknown palette colors", () => {
    const avatar = avatarFixture();
    avatar.parts[0].geometry[0] = { kind: "rect", x: 0.5, y: 2, width: 4, height: 5, color: "skin.base" };
    expect(() => parseAvatar(avatar)).toThrow(/inteiro/);
    const cycled = avatarFixture();
    cycled.parts[1].parent = cycled.parts[0].id;
    cycled.parts[0].parent = cycled.parts[1].id;
    expect(() => parseAvatar(cycled)).toThrow(/hierarquia/);
    const injected = avatarFixture();
    injected.artBible.notes = "alert(document.cookie)";
    expect(() => parseAvatar(injected)).toThrow(/código/);
  });

  it("rejects revision changes outside authorized part IDs", () => {
    const avatar = parseAvatar(avatarFixture());
    const patch = avatarFixture();
    patch.parts[2].geometry[0].color = "accent.base";
    expect(() => reviseAvatar(avatar, patch, ["hair.front"])).toThrow(/não autorizada/);
  });
});
```

- [ ] **Step 2: Add a complete reusable fixture**

Create `tests/fixtures/avatar-fixture.ts` with a 96×96 avatar, 64×64 portrait, 24-color semantic palette, fixed IDs `body`, `head`, `hair.back`, `hair.front`, `eyes`, `pupils`, `brows`, `lids`, `nose`, `mouth`, `ears`, `arm.left`, `arm.right`, `forearm.left`, `forearm.right`, `hand.left`, `hand.right` and `accessory`, five poses, six expressions, mouths `A`–`F` and `X`, integer primitives and a stable contact baseline `y=90`. Export `avatarFixture(): AvatarPackage` by returning `structuredClone(fixture)`.

- [ ] **Step 3: Run tests and verify the contract is absent**

Run: `npm test -- tests/avatar-schema.test.ts`
Expected: FAIL because `src/shared/avatar.ts` does not exist.

- [ ] **Step 4: Implement the bounded schema**

Use strict Zod objects. Export these exact constants and signatures:

```ts
export const AVATAR_POSES = ["neutral", "explaining", "pointing", "surprised", "celebrating"] as const;
export const AVATAR_EXPRESSIONS = ["neutral", "happy", "thinking", "surprised", "serious", "confident"] as const;
export const AVATAR_MOUTHS = ["A", "B", "C", "D", "E", "F", "X"] as const;
export const AVATAR_SCHEMA_VERSION = 1;

export interface AvatarPackage {
  schemaVersion: 1;
  id: string;
  revision: number;
  canvas: { full: 96; portrait: 64; baseline: number };
  identity: { anchors: string[]; inferred: string[] };
  artBible: { light: "top-left" | "top-right"; outline: string; notes: string };
  palette: Record<string, string>;
  parts: AvatarPart[];
  poses: Record<string, AvatarPose>;
  expressions: Record<string, AvatarExpression>;
  mouths: Record<string, MouthShape>;
}

export function parseAvatar(input: unknown): AvatarPackage;
export function canonicalAvatar(input: unknown): string;
export function avatarHash(input: unknown): string;
export function reviseAvatar(current: AvatarPackage, next: unknown, allowedPartIds: string[]): AvatarPackage;
```

`canonicalAvatar` recursively sorts object keys, excludes the revision-independent filesystem paths, and `avatarHash` returns SHA-256 of canonical UTF-8 JSON. Reject executable-looking strings matching `<script`, `javascript:`, `eval(`, `Function(`, `require(`, `import(`, `process.` or `document.` in model-authored text. Limit packages to 256 parts, 2,048 primitives per part, 64 colors and 256 KiB canonical JSON.

- [ ] **Step 5: Implement immutable part revision checks**

`reviseAvatar` parses both packages, requires identical `id`, `revision`, canvas, identity anchors and palette tokens, canonicalizes each part by ID, and throws when any changed part is absent from `allowedPartIds`. Pose corrections are represented as part-owned overrides so they obey the same rule.

- [ ] **Step 6: Run the contract suite**

Run: `npm test -- tests/avatar-schema.test.ts`
Expected: all avatar-schema tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/avatar.ts tests/avatar-schema.test.ts tests/fixtures/avatar-fixture.ts
git commit -m "feat: add deterministic avatar package contract"
```

### Task 2: Integer pixel rasterizer

**Files:**
- Create: `resources/avatar-engine/avatar-engine.js`
- Create: `resources/avatar-engine/avatar-engine.d.ts`
- Test: `tests/avatar-engine.test.ts`

- [ ] **Step 1: Write failing native-pixel tests**

Load the ESM renderer with a dynamic import and pass a plain `ImageData` adapter. Test exact RGBA bytes rather than screenshots:

```ts
import { describe, expect, it } from "vitest";
import { renderAvatarPixels } from "../resources/avatar-engine/avatar-engine.js";
import { avatarFixture } from "./fixtures/avatar-fixture";

describe("avatar rasterizer", () => {
  it("is byte-deterministic", () => {
    const avatar = avatarFixture();
    const state = { pose: "neutral", expression: "neutral", mouth: "X", blink: 0, frame: 0 };
    const a = renderAvatarPixels(avatar, state, "full");
    const b = renderAvatarPixels(avatar, state, "full");
    expect(a.width).toBe(96);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it("uses only palette colors and binary alpha", () => {
    const result = renderAvatarPixels(avatarFixture(), { pose: "neutral", expression: "happy", mouth: "A", blink: 0, frame: 0 }, "full");
    const colors = new Set<string>();
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 3] === 0 || result.data[i + 3] === 255).toBe(true);
      if (result.data[i + 3]) colors.add(`${result.data[i]},${result.data[i + 1]},${result.data[i + 2]}`);
    }
    expect(colors.size).toBeLessThanOrEqual(32);
  });

  it("keeps the neutral baseline fixed and supports portrait output", () => {
    const avatar = avatarFixture();
    const portrait = renderAvatarPixels(avatar, { pose: "neutral", expression: "neutral", mouth: "X", blink: 0, frame: 0 }, "portrait");
    expect(portrait.width).toBe(64);
    expect(portrait.height).toBe(64);
  });
});
```

- [ ] **Step 2: Verify tests fail before the renderer exists**

Run: `npm test -- tests/avatar-engine.test.ts`
Expected: FAIL resolving `avatar-engine.js`.

- [ ] **Step 3: Implement only integer primitives**

Implement `rect`, `polygon`, `run` and `matrix`. Fill polygons with integer scanline intersection and deterministic tie-breaking; never call Canvas path filling, SVG rendering, CSS transforms, `drawImage` smoothing or fractional transforms. Sort parts by `zIndex` then original index. Apply joint offsets after rounding to integers.

Public API:

```js
export function renderAvatarPixels(avatar, state, viewport = "full") {
  const size = viewport === "portrait" ? 64 : 96;
  const data = new Uint8ClampedArray(size * size * 4);
  // Evaluate the selected pose/expression/mouth and write binary-alpha palette pixels.
  return { width: size, height: size, data };
}

export async function avatarPixelHash(avatar, state, viewport = "full") {
  const pixels = renderAvatarPixels(avatar, state, viewport);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", pixels.data);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { ...pixels, hash };
}
```

Use the Web Crypto API available in both the Chromium worker and the supported Node runtime, so the same module remains deterministic without a new dependency. Callers must `await avatarPixelHash(...)`.

- [ ] **Step 4: Add TypeScript declarations**

```ts
export interface AvatarRenderState {
  pose: string;
  expression: string;
  mouth: string;
  blink: number;
  frame: number;
}
export interface AvatarPixels { width: number; height: number; data: Uint8ClampedArray }
export function renderAvatarPixels(avatar: unknown, state: AvatarRenderState, viewport?: "full" | "portrait"): AvatarPixels;
export function avatarPixelHash(avatar: unknown, state: AvatarRenderState, viewport?: "full" | "portrait"): Promise<AvatarPixels & { hash: string }>;
```

- [ ] **Step 5: Run raster tests and inspect a golden PNG**

Run: `npm test -- tests/avatar-engine.test.ts`
Expected: PASS, with no antialiasing and identical byte buffers across two runs. Save a debug PNG only under the test temporary directory and inspect it before committing.

- [ ] **Step 6: Commit**

```bash
git add resources/avatar-engine/avatar-engine.js resources/avatar-engine/avatar-engine.d.ts tests/avatar-engine.test.ts
git commit -m "feat: rasterize avatar rigs as native pixels"
```

### Task 3: Poses, expressions, blinking and voice-independent mouths

**Files:**
- Modify: `resources/avatar-engine/avatar-engine.js`
- Test: `tests/avatar-rig.test.ts`

- [ ] **Step 1: Write failing rig tests**

```ts
it.each(["A", "B", "C", "D", "E", "F", "X"])("renders mouth %s without voice data", (mouth) => {
  const result = renderAvatarPixels(avatarFixture(), { pose: "explaining", expression: "confident", mouth, blink: 0, frame: 12 }, "full");
  expect(result.data.some((value) => value !== 0)).toBe(true);
});

it("blinks without moving the body baseline", () => {
  const open = renderAvatarPixels(avatarFixture(), { pose: "neutral", expression: "neutral", mouth: "X", blink: 0, frame: 0 }, "full");
  const closed = renderAvatarPixels(avatarFixture(), { pose: "neutral", expression: "neutral", mouth: "X", blink: 1, frame: 0 }, "full");
  expect(Buffer.from(open.data).equals(Buffer.from(closed.data))).toBe(false);
  expect(contactBaseline(open)).toBe(contactBaseline(closed));
});

it("limits breathing to one native pixel", () => {
  const a = renderAvatarPixels(avatarFixture(), { pose: "neutral", expression: "neutral", mouth: "X", blink: 0, frame: 0 }, "full");
  const b = renderAvatarPixels(avatarFixture(), { pose: "neutral", expression: "neutral", mouth: "X", blink: 0, frame: 15 }, "full");
  expect(maxPartDelta(a, b, "body")).toBeLessThanOrEqual(1);
});
```

Define `contactBaseline` and `maxPartDelta` as test helpers using the fixture's part bounds; do not add production APIs solely for tests.

- [ ] **Step 2: Verify the new tests fail**

Run: `npm test -- tests/avatar-rig.test.ts`
Expected: FAIL on missing pose/expression/blink behavior.

- [ ] **Step 3: Implement rig evaluation**

Resolve state in this exact order: base part geometry, pose `partId` override, expression `partId` override, mouth replacement, eyelid/blink replacement, integer joint offsets. Clamp breathing offsets to `[-1, 0, 1]`; blink is clamped to `[0, 1]` and quantized to `0`, `0.5` or `1`. Voice timing is not read by this module.

- [ ] **Step 4: Run all engine tests**

Run: `npm test -- tests/avatar-engine.test.ts tests/avatar-rig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/avatar-engine/avatar-engine.js tests/avatar-rig.test.ts
git commit -m "feat: animate avatar poses expressions and mouths"
```

### Task 4: Deterministic technical quality gates

**Files:**
- Create: `src/shared/avatar-quality.ts`
- Test: `tests/avatar-quality.test.ts`

- [ ] **Step 1: Write failing gate tests**

Cover empty silhouette, floating contact, out-of-bounds parts, detached accessories, non-palette RGBA, partial alpha, identity changes and altered unauthorized parts. Each test constructs one defect and asserts a stable error code:

```ts
const report = validateAvatarPackage(defectiveAvatar, { previous: approvedAvatar, allowedPartIds: ["mouth"] });
expect(report.ok).toBe(false);
expect(report.findings).toContainEqual(expect.objectContaining({ code: "IDENTITY_CHANGED" }));
expect(report.findings.map((finding) => finding.code)).not.toContain("PALETTE_COLOR_UNKNOWN");
```

- [ ] **Step 2: Run and confirm missing quality module**

Run: `npm test -- tests/avatar-quality.test.ts`
Expected: FAIL resolving `avatar-quality.ts`.

- [ ] **Step 3: Implement explicit findings**

Export:

```ts
export interface AvatarFinding { code: string; message: string; partId?: string }
export interface AvatarQualityReport { ok: boolean; findings: AvatarFinding[]; hashes: Record<string, string> }
export function validateAvatarPackage(avatar: unknown, context?: { previous?: AvatarPackage; allowedPartIds?: string[] }): AvatarQualityReport;
```

Check schema, palette token references, integer geometry, bounds, hierarchy, required states, contact baseline, silhouette pixel count and identity/patch invariants. Hashes cover neutral, silhouette, grayscale, light background, dark background, expression sheet, mouth sheet and movement loop. Aesthetic scores remain separate and cannot be auto-marked as user approval.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/avatar-quality.test.ts`
Expected: PASS with stable codes and no false finding in the valid fixture.

- [ ] **Step 5: Commit**

```bash
git add src/shared/avatar-quality.ts tests/avatar-quality.test.ts
git commit -m "feat: validate avatar identity and pixel quality"
```

### Task 5: Atomic immutable avatar store

**Files:**
- Create: `electron/core/avatar-store.ts`
- Test: `tests/avatar-store.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Use a temporary directory per test. Verify candidate creation, selection, immutable revision loading, last-known-good preservation, path traversal rejection and atomic recovery:

```ts
const store = new AvatarStore(root);
const candidate = await store.createCandidate(avatarFixture());
await store.selectCandidate(candidate.avatarId, candidate.candidateId);
const approved = await store.saveRevision(candidate.avatarId, candidate.candidateId);
await expect(store.saveRevision(candidate.avatarId, "invalid-candidate")).rejects.toThrow();
expect((await store.loadRevision(candidate.avatarId, approved.revision)).hash).toBe(approved.hash);
await expect(store.loadRevision("../outside", 1)).rejects.toThrow(/inválido/);
```

- [ ] **Step 2: Verify the store tests fail**

Run: `npm test -- tests/avatar-store.test.ts`
Expected: FAIL resolving `avatar-store.ts`.

- [ ] **Step 3: Implement storage layout and atomic writes**

Store packages under `<root>/<avatarId>/candidates/<candidateId>/avatar.json` and approved snapshots under `<root>/<avatarId>/revisions/<revision>/avatar.json`. Engine assets and renders live in sibling directories, never inside project JSON. Write UTF-8 JSON to `<file>.partial`, fsync, rename, and leave prior files untouched on validation failure.

Public methods:

```ts
createCandidate(input: unknown): Promise<{ avatarId: string; candidateId: string; hash: string }>;
selectCandidate(avatarId: string, candidateId: string): Promise<void>;
saveRevision(avatarId: string, candidateId: string): Promise<{ revision: number; hash: string; path: string }>;
loadRevision(avatarId: string, revision: number): Promise<{ avatar: AvatarPackage; hash: string; path: string }>;
listRevisions(avatarId: string): Promise<Array<{ revision: number; hash: string; approved: boolean }>>;
```

- [ ] **Step 4: Run store tests**

Run: `npm test -- tests/avatar-store.test.ts`
Expected: PASS, including simulated rename failure preserving the previous approved revision.

- [ ] **Step 5: Commit**

```bash
git add electron/core/avatar-store.ts tests/avatar-store.test.ts
git commit -m "feat: persist immutable avatar revisions atomically"
```

### Task 6: Isolated review-sheet renderer

**Files:**
- Create: `resources/avatar-engine/proof.html`
- Create: `resources/avatar-engine/proof.js`
- Create: `electron/core/avatar-render.ts`
- Modify: `electron/render-motion.ts`
- Modify: `electron/core/film.ts:318`
- Test: `tests/avatar-render.integration.test.ts`

- [ ] **Step 1: Export the existing worker without behavior changes**

Change only the declaration in `electron/core/film.ts`:

```ts
export async function runFilmWorker(dir: string, spec: Record<string, unknown>, runner: FilmRunner, directory = dir) {
```

Add a film test asserting existing stills requests still contain `browser`, `fps` and `directory`. Run `npm test -- tests/film.test.ts` before proceeding; preserve all unrelated local changes.

- [ ] **Step 2: Write the failing Chromium integration test**

Launch the installed test Chromium only in this integration file. Request neutral, expressions and mouths sheets. Assert native PNG dimensions, two identical hashes and an empty `networkRequests` array. Skip with an explicit reason only when no Chromium is configured; never replace the render assertion with a JPEG screenshot.

- [ ] **Step 3: Implement the no-network proof document**

`proof.html` contains a strict CSP with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self'`. It loads `avatar-engine.js` and `proof.js` as modules. `proof.js` reads a JSON script tag, calls `renderAvatarPixels`, writes `ImageData` to native canvases, and composes review sheets using integer-scale `drawImage` with `imageSmoothingEnabled=false`.

Expose `window.__avatarProof = { render(sheet) }`; each result includes PNG canvas data and pixel hashes. Do not expose filesystem, Node, shell, network or arbitrary JavaScript evaluation.

- [ ] **Step 4: Add `avatar` mode to the utility process**

Extend the `Spec.mode` union with `"avatar"`. The new function opens only `proof.html`, intercepts every request, permits only the local proof server plus `data:`/`blob:`, records all requests, and writes requested PNG artifacts. Return `{ complete: true, files, hashes, errors, networkRequests }`.

- [ ] **Step 5: Implement `avatar-render.ts`**

Call `runFilmWorker` with `mode: "avatar"`, the avatar revision directory and a temporary `.renders` output. Validate returned paths remain under the revision folder. Keep review JPEGs separate from native PNGs and never hash JPEG data.

- [ ] **Step 6: Run integration and regression tests**

Run: `npm test -- tests/avatar-render.integration.test.ts tests/film.test.ts`
Expected: PASS; PNG hashes repeat exactly, external requests are blocked, and existing film tests remain green.

- [ ] **Step 7: Commit**

```bash
git add resources/avatar-engine/proof.html resources/avatar-engine/proof.js electron/core/avatar-render.ts electron/render-motion.ts electron/core/film.ts tests/avatar-render.integration.test.ts tests/film.test.ts
git commit -m "feat: render isolated avatar review sheets"
```

### Task 7: Candidate and revision application service

**Files:**
- Create: `electron/core/avatar-service.ts`
- Test: `tests/avatar-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Test three distinct candidates, invalid candidate rejection, identity freezing on selection, authorized part revision, best-candidate preservation and per-job cancellation. Use fake store/render adapters; do not call real models.

```ts
const service = new AvatarService({ store, renderer });
const created = await service.createCandidates({ description: "Mascote de um SaaS financeiro", packages: [strategist, companion, expert] });
expect(created.candidates).toHaveLength(3);
expect(new Set(created.candidates.map((candidate) => candidate.hash)).size).toBe(3);
const selected = await service.selectCandidate(created.avatarId, created.candidates[0].candidateId);
await expect(service.revisePart({ avatarId: created.avatarId, revision: selected.revision, allowedPartIds: ["mouth"], package: changedHair })).rejects.toThrow(/não autorizada/);
const reviewed = await service.reviewCandidate({ avatarId: created.avatarId, candidateId: created.candidates[0].candidateId, rubric: { identity: 18, silhouette: 14, pixelCraft: 14, palette: 14, expressions: 14, rig: 14, export: 5 }, evidence: ["neutral.png", "expressions.png"] });
expect(reviewed.total).toBe(93);
```

- [ ] **Step 2: Verify the service tests fail**

Run: `npm test -- tests/avatar-service.test.ts`
Expected: FAIL resolving `avatar-service.ts`.

- [ ] **Step 3: Implement service orchestration**

`createCandidates` accepts the three already model-authored `packages`; the singular MCP tool calls `createCandidate`, which delegates to the same validation/storage path. No recursive agent invocation occurs. The UI/model orchestration supplies `description` as metadata only. Every candidate is parsed, quality-checked and hashed before storage. Selection freezes identity anchors. Revision requires `allowedPartIds`, preserves the last approved snapshot on any failure and records quality reports. `reviewCandidate` applies the approved weights `20/15/15/15/15/15/5`, requires visual evidence for model-provided aesthetic scores and keeps the highest-scoring valid candidate rather than the last one. Permit two or three correction rounds and stop at the first user-approved result. Each render job gets its own `AbortController`.

- [ ] **Step 4: Run service tests**

Run: `npm test -- tests/avatar-service.test.ts`
Expected: PASS, including invalid package not replacing the best candidate.

- [ ] **Step 5: Commit**

```bash
git add electron/core/avatar-service.ts tests/avatar-service.test.ts
git commit -m "feat: orchestrate avatar candidates and safe revisions"
```

### Task 8: Complete MCP contract for the first milestone

**Files:**
- Create: `electron/core/avatar-tool-defs.ts`
- Create: `electron/core/avatar-vision.ts`
- Modify: `electron/core/codex.ts:76-157`
- Modify: `electron/main.ts` tool dispatch and service composition
- Test: `tests/avatar-mcp.test.ts`
- Test: `tests/avatar-vision.test.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write failing tool-contract tests**

Require these exact tools: `avatar_get_contract`, `avatar_create_candidate`, `avatar_render`, `avatar_validate`, `avatar_review`, `avatar_select_candidate`, `avatar_revise_part`, `avatar_save_revision`, `avatar_compare_revisions`, `avatar_cancel`, `avatar_import_reference` and `avatar_analyze_reference`. Assert each has a strict object schema, required IDs and no arbitrary file destination. Assert candidate packages are limited below the existing 1 MiB transport limit; the application schema's 256 KiB limit remains authoritative.

- [ ] **Step 2: Verify tests fail before registration**

Run: `npm test -- tests/avatar-mcp.test.ts tests/providers.test.ts`
Expected: FAIL because avatar tools are not registered.

- [ ] **Step 3: Define tools in a separate module**

Use the existing `objectSchema` convention. `avatar_create_candidate` accepts `{ avatarId?, description?, referenceAssetId?, package }`; `avatar_revise_part` accepts `{ avatarId, revision, allowedPartIds: string[], package }`; `avatar_render` accepts `{ avatarId, revision, sheets: Array<"neutral"|"silhouette"|"grayscale"|"backgrounds"|"expressions"|"mouths"|"motion"> }`. `avatar_review` accepts the seven rubric fields and evidence paths defined in Task 7. `avatar_import_reference` accepts only an absolute PNG/JPEG/WebP path and copies it into the avatar assets folder after signature and size validation. `avatar_analyze_reference` accepts `{ avatarId, assetId, providerId, prompt }` and returns structured identity anchors plus inferred fields, never an avatar package assembled outside the schema.

- [ ] **Step 4: Implement and test the bounded vision adapter**

`avatar-vision.ts` uses the selected existing provider only when `supportsVision` is true. It sends the imported reference only during `avatar_analyze_reference`, strips credentials from logs, validates the returned anchors with Zod and marks occluded or ambiguous traits as inferred. Tests use a fake vision provider and assert that no call occurs during local render, candidate storage or deterministic validation.

- [ ] **Step 5: Register and dispatch through shared service methods**

Append `...AVATAR_TOOLS` to `EDITOR_TOOLS`. Add a dispatch map in `electron/main.ts` that calls `avatarService` methods; do not create a second UI-only implementation. Return one composite JPEG for visual model review plus native PNG artifact paths and hashes. Do not weaken the global 1 MiB request limit and do not modify the locally changed `studio-tool-defs.ts`.

- [ ] **Step 6: Run MCP and provider tests**

Run: `npm test -- tests/avatar-mcp.test.ts tests/avatar-vision.test.ts tests/providers.test.ts tests/desktop-mcp.test.ts tests/codex.test.ts`
Expected: PASS, with equivalent service calls through MCP, no duplicate tool names and no provider call during offline rendering.

- [ ] **Step 7: Commit**

```bash
git add electron/core/avatar-tool-defs.ts electron/core/avatar-vision.ts electron/core/codex.ts electron/main.ts tests/avatar-mcp.test.ts tests/avatar-vision.test.ts tests/providers.test.ts
git commit -m "feat: expose deterministic avatar engine over MCP"
```

### Task 9: Three real candidates and visual review artifacts

**Files:**
- Create: `resources/avatar-engine/examples/strategist.json`
- Create: `resources/avatar-engine/examples/companion.json`
- Create: `resources/avatar-engine/examples/expert.json`
- Test: `tests/avatar-examples.test.ts`

- [ ] **Step 1: Author three genuinely different packages**

Create three complete schema-valid packages, not palette swaps:

- `strategist`: angular hair, structured jacket, tablet accessory, confident stance.
- `companion`: rounded silhouette, curly hair, oversized hoodie, open explaining gesture.
- `expert`: asymmetrical hair, glasses, rolled sleeves, pointer accessory.

Each uses 24–32 colors, 3–5 tone material ramps, one light direction, colored 1 px internal outlines, readable clusters and full required rigs. Do not copy third-party sprites or use the mockup mascot as an engine result.

- [ ] **Step 2: Write example validation and distinctness tests**

```ts
it.each(["strategist", "companion", "expert"])("validates %s and every required state", async (name) => {
  const avatar = parseAvatar(JSON.parse(await readFile(`resources/avatar-engine/examples/${name}.json`, "utf8")));
  expect(validateAvatarPackage(avatar).ok).toBe(true);
});

it("produces different neutral hashes and silhouettes", async () => {
  const avatars = await Promise.all(["strategist", "companion", "expert"].map(readExample));
  const hashes = await Promise.all(avatars.map(async (avatar) => (await avatarPixelHash(avatar, neutralState, "full")).hash));
  expect(new Set(hashes).size).toBe(3);
  expect(pairwiseSilhouetteDifference(avatars)).toBeGreaterThan(0.12);
});
```

- [ ] **Step 3: Run deterministic gates**

Run: `npm test -- tests/avatar-examples.test.ts`
Expected: PASS for all three, with no technical gate bypassed.

- [ ] **Step 4: Render review sheets through the real MCP path**

Render neutral, silhouette, grayscale, backgrounds, expressions, mouths and motion for every candidate. Save artifacts under the local avatar store, then copy only the three review sheets needed for user review into `artifacts/avatar-proof/` inside the workspace. Record engine version, package hashes and render commands in `artifacts/avatar-proof/manifest.json`.

- [ ] **Step 5: Run the complete verification suite**

Run: `npm test && npm run build`
Expected: all deterministic tests PASS and production build succeeds. Integration tests that call real model providers remain separate and are never reported as deterministic.

- [ ] **Step 6: Commit the engine proof**

```bash
git add resources/avatar-engine/examples tests/avatar-examples.test.ts artifacts/avatar-proof
git commit -m "feat: prove avatar engine with three reviewable candidates"
```

- [ ] **Step 7: Stop for mandatory visual approval**

Present the three actual rendered candidates and their expression/mouth sheets to the user. Record the selected candidate and requested part-level corrections. Do not start the full studio plan until the user approves an avatar produced by this engine; automatic quality gates are not a substitute for that approval.
