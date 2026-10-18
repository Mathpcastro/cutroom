# Third-party notices

CutRoom's original application code is MIT licensed. Independently distributed libraries, tools, fonts and pretrained models retain their own licenses. They are not relicensed as MIT by this repository.

- VideoUse, Browser Use, MIT: https://github.com/browser-use/video-use. Consulted for the edit/transcript/EDL workflow, 30 ms fades and two-pass loudness. Copyright notice is retained in `resources/licenses/video-use-MIT.txt`.
- Codex CLI/App Server, OpenAI, Apache-2.0: https://github.com/openai/codex. Native package notices remain in its packaged resources; license included separately.
- FFmpeg Windows build 6.1.1, Gyan, GPLv3: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1. Binary license and supplier README are included. The supplier identifies FFmpeg source commit e38092ef93: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93. Build dependency/source information: https://www.gyan.dev/ffmpeg/builds/ and https://github.com/GyanD/codexffmpeg. This is a separate command-line program, invoked by process boundaries.
- ffprobe-static wrapper, Josh Johnston, MIT: https://github.com/joshwnj/ffprobe-static. The executable is an FFmpeg component; its configuration/version is recorded in the distributed notices.
- uv, Astral, MIT/Apache-2.0: https://github.com/astral-sh/uv/tree/0.11.21. Bootstrap downloaded from its official release and verified by SHA256. Managed Python comes from python-build-standalone; its license notices are retained in the installed runtime.
- Faster Whisper, SYSTRAN, MIT: https://github.com/SYSTRAN/faster-whisper. Uses CTranslate2, PyAV/FFmpeg and ONNX Runtime dependencies with their respective installed notices. Python dependencies are pinned in `requirements.lock`.
- Whisper model, OpenAI, MIT: https://github.com/openai/whisper. Converted multilingual base model: https://huggingface.co/Systran/faster-whisper-base.
- Barlow font, Jeremy Tribby, SIL Open Font License 1.1: `resources/fonts/OFL.txt`, https://github.com/jpt/barlow.
- Caption fonts Montserrat, Anton, Lora, Oswald and Caveat: SIL Open Font License 1.1; individual notices are in `resources/fonts/OFL-*.txt`. Fonts are bundled for offline preview and export.
- JASSUB 2.5.21, https://github.com/ThaUnknown/jassub: the JavaScript wrapper is MIT (`resources/licenses/JASSUB-MIT.txt`). Its unmodified WebAssembly build includes libass/FreeType/HarfBuzz/FriBidi and other dependencies; the published package declares `LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0`. Upstream dependency license texts are retained in `resources/licenses/JASSUB-dependency-notices.txt`; sources/build instructions are at the upstream repository and its recursively cloned submodules. The npm package and version are pinned in the lockfile. CutRoom's caption preset definitions and ASS generator are original code.
- Electron, React, Lucide, Zod and fflate: their package license files remain in the installed dependency distributions.

No OpenCut or LosslessCut source, artwork or components were copied into CutRoom. For the reuse assessment see `docs/upstream.md`.
