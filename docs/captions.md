# Caption Studio

CutRoom ships 24 editable caption presets. The default displays a readable five-word phrase and highlights the spoken word. Other presets change grouping, word reveal, continuous karaoke fill, letter reveal, emphasis, font, position, background geometry and motion. They are not color variations of one single-word template.

The style panel offers category filters, six offline font families, size, words per phrase, seven display behaviors, top/center/bottom placement, safe margin, six entry animations, casing, text/highlight/outline/background colors, outline width, box or rounded pill backgrounds, opacity, weight, italic and letter spacing. Apply a preset to enable captions. The surrounding caption switch disables them without losing the style. The project must have genuine word timings; the application prepares local transcription when needed.

Custom styles can be named and saved under **Meus estilos**. They persist in this application's local profile and can be applied in later projects. Every project's `settings.captionStyle` is also serialized with its edits. A project created by an older CutRoom release receives the default when `captionStyle` is absent.

Sliders and color controls keep a local draft during the gesture, committing once on pointer release, keyboard release or blur. Duplicate commits are suppressed. The controls reconcile to persisted project settings after success, undo, project changes and failed edits; a missing transcription package must not leave an unapplied style selected.

## Shared renderer

`src/shared/captions.ts` is browser-compatible and contains the complete style validation, preset registry, source-to-output word mapping, grouping, ASS style and timed-event generator. `captionAssParts()` produces the same caption style and Dialogue events used by the preview and mixed-overlay export. Untrusted transcript text cannot introduce ASS override tags. Grouping respects punctuation, pauses, maximum duration, maximum words, media changes and clip boundaries. Muted clips produce no captions; repeated hooks repeat their captions; clipped words and speed changes map to output time.

The editor uses **JASSUB 2.5.21**, a real libass WebAssembly renderer, on a canvas driven by the output playhead. The worker, SIMD and fallback WASM and fonts are bundled by Vite. Online font discovery is disabled. The renderer's `data-render-status` reports `loading`, `ready` or `error`; errors are visible in the player. React text or CSS does not substitute for failed subtitle rendering. FFmpeg burns the generated ASS through its native libass filter with the same offline font resources. Existing motion overlays keep their separate `Default` ASS style.

`src/workers/captions.worker.ts` selects JASSUB's own Canvas2D fallback in its dedicated worker for Windows compositing compatibility. JASSUB 2.5.21 has no renderer-selection option, so the wrapper disables WebGL context creation only inside that worker. GPU decoding of the video remains enabled. Subtitle pixels retain alpha outside their glyphs and backgrounds. Caption changes preserve playback state; the output clock waits while the video is seeking or has no current frame.

Font size is in pixels at a 1080-pixel **short edge**, then scales with output resolution. Explicit word wrapping and font-size reduction keep long words within an 84% horizontal safe area. Rounded pills use native ASS vector drawing; boxed captions use ASS BorderStyle 3. Pop uses scale transforms; rise, slide and bounce use native movement transforms; typewriter uses per-character timed transparency; karaoke uses `\\kf` syllable fill.

The existing exporter rounds each clip duration to its nearest output frame. Its word offsets use those actual rendered durations. The editor timeline uses exact source duration divided by speed, so very large numbers of fractional-frame cuts can accumulate a timing difference of at most half a frame per cut. The subtitle rendering logic and visual style are shared; this existing timeline quantization difference is not hidden by the preview.

## Component APIs

```tsx
<CaptionStudio project={project} disabled={busy} onChange={style =>
  command({ name: 'captions', args: { enabled: true, style } })} />
<CaptionPreview project={project} time={outputTimelineSeconds} />
```

CaptionPreview fills its positioned parent, which must have the output aspect ratio. `captions` commands accept a partial `style` and merge it immutably; changing `presetId` loads that preset's defaults before applying explicit overrides. Unknown fields, presets, fonts, unsafe colors and out-of-range values are rejected before persistence.

## Provenance and licenses

- JASSUB: https://github.com/ThaUnknown/jassub — the installed package declares its libass/FreeType/HarfBuzz and JavaScript composite licenses in `node_modules/jassub/package.json` and `LICENSE`. Retain those notices in distributions; the wrapper's repository metadata alone does not describe the WASM dependency licenses.
- Bundled Barlow, Montserrat, Anton, Lora, Oswald and Caveat fonts are from their official Google Fonts/upstream distributions, with their OFL texts in `resources/fonts`.
- https://github.com/zeke/nice-ass-captions was inspected for the documented ASS grouping/highlight approach. No LICENSE was present at the inspected main revision and `pyproject.toml` did not declare one. No source was copied. CutRoom's TypeScript implementation and vector geometry were written independently.

Run `npx vitest run tests/captions.test.ts` for validation, immutable persistence, cut/speed/hook/mute mapping, escaping, shared ASS identity and actual offline libass rasterization of all 24 presets.

Run `npx tsx tools/check-caption-engine.ts` to regenerate the 24 labeled raster specimens, contact sheet, three native MP4 exports and JSON metadata under `artifacts/caption-engine`. Specimen typography uses explicitly synthetic text; native exports use the existing desktop fixture's local ASR words. The raster test also compares two actual rendered times for five timed behaviors. `tools/check-caption-preview.mjs` verifies the bundled worker and fonts in real Electron.

Run `node tools/check-caption-playback.mjs` for a 47-cut 1080p60 regression project. It clicks all 24 cards during playback, checks decoded frames and visible video pixels, reads the caption canvas alpha, cycles the caption switch six times, and verifies pause/resume. `--packaged` tests `release/win-unpacked/CutRoom.exe`; `--source <file>` uses an existing long recording read-only. The generated word timings are synthetic and do not claim to transcribe that recording.
