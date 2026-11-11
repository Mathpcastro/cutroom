"""CutRoom offline narration with Kokoro-82M (ONNX, int8). Runs in CutRoom's private Python.

speak:  python speak_kokoro.py speak --model M --voices V --text-file T --voice pm_alex --out out.wav
check:  python speak_kokoro.py check --model M --voices V
Prints one JSON line per event; errors as {"error": "..."} with a non-zero exit code.
"""
import argparse
import json
import sys
import time


def emit(**message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["speak", "check"])
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--text-file")
    parser.add_argument("--voice", default="pm_alex")
    parser.add_argument("--lang", default="pt-br")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--out")
    args = parser.parse_args()

    import soundfile as sf
    from kokoro_onnx import Kokoro

    started = time.time()
    kokoro = Kokoro(args.model, args.voices)
    if args.mode == "check":
        samples, rate = kokoro.create("Teste.", voice=args.voice, speed=1.0, lang=args.lang)
        emit(done=True, ok=len(samples) > 0, voices=sorted(kokoro.get_voices()))
        return
    with open(args.text_file, encoding="utf-8") as handle:
        text = handle.read().strip()
    if not text:
        raise ValueError("Roteiro vazio.")
    emit(progress=20, message="Gerando a narração…")
    samples, rate = kokoro.create(text, voice=args.voice, speed=max(0.5, min(2.0, args.speed)), lang=args.lang)
    sf.write(args.out, samples, rate, subtype="PCM_16")
    emit(done=True, duration=round(len(samples) / rate, 3), rate=rate, seconds=round(time.time() - started, 2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 — reported to the app as text
        emit(error=str(error))
        sys.exit(1)
