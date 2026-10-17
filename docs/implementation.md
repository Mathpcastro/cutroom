# CutRoom implementation

User direction: a new public open-source desktop editor with chat on the left, video/timeline on the right. No CutRoom registration or custom OAuth. Connect to an existing local Codex CLI session through App Server. Existing session credentials remain managed by Codex. Optional own API credential is entered by the user locally rather than supplied by the project.

## Architecture

- `src/shared/types.ts`: the shared project, editing commands and desktop bridge contract.
- `src/App.tsx`, components and styles: React editor shell and interactions.
- `electron/main.ts`, `preload.ts`: isolated renderer, allowlisted IPC, app lifecycle, file dialogs and project state.
- `electron/core/project.ts`: pure reversible editing operations and schema validation.
- `electron/core/media.ts`: ffprobe, local FFmpeg analysis, previews and exports.
- `electron/core/codex.ts`: JSONL App Server client, existing-account detection, local editing tools and streamed chat.
- `electron/core/packages.ts`: downloadable versioned transcription package and local worker.
- `resources/workers`: bundled Python transcription code and style preset descriptions.
- `docs/upstream.md`: reuse findings and license attribution. Do not copy GPL editor source into the MIT app.

## Implementation checklist

- [x] Initialize independent repository and shared contract.
- [x] Build dark desktop workspace, real player, media import, transcript, chat and reversible timeline controls.
- [x] Implement project validation, source-time range removal, split/trim, speed, zoom, subtitles, audio normalization, all overlay types, preset and result hook.
- [x] Adapt FFmpeg-based editing principles from VideoUse; preserve originals, word timing, short audio fades and cache transcriptions.
- [x] Connect local Codex App Server, reuse its existing authentication, expose constrained editing tools, stream responses and handle cancellation/failure.
- [x] Install Faster Whisper runtime/model without requiring a user Python installation and cache it outside application files.
- [x] Package Windows app with FFmpeg/ffprobe and documentation of installation/runtime needs.
- [x] Verify domain behavior, real FFmpeg export, Electron UI and real Codex connection. See verification.md for actual inference and packaged app evidence.
- [x] Review security, correctness and user requirements, fix findings, commit and push only project files.

## Verification

Use `npm test`, `npm run build`, a generated audiovisual fixture exported using the same renderer as the application, and Electron automation for import, manual/text edits, undo/redo, save/reopen and export. Test the Codex protocol against a controlled subprocess plus the real installed CLI. Transcription package install must execute a real local sample before delivery claims. Build the distributable and inspect its contents. Keep evidence in ignored `artifacts/` and final verification in tracked docs.
