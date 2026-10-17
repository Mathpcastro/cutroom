"""CutRoom local transcription worker. JSONL progress on stdout, no network during transcription."""
import argparse
import json
import os
from pathlib import Path


def emit(**message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['install', 'transcribe', 'check'])
    parser.add_argument('--models', required=True)
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--media-id', default='')
    args = parser.parse_args()
    model_dir = Path(args.models) / 'base'
    if args.mode == 'install':
        from huggingface_hub import snapshot_download
        emit(progress=65, message='Baixando o modelo multilíngue base…')
        snapshot_download('Systran/faster-whisper-base', revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',
                          local_dir=str(model_dir), allow_patterns=['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.*'])
    os.environ['HF_HUB_OFFLINE'] = '1'
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir), device='cpu', compute_type='int8', local_files_only=True)
    if args.mode != 'transcribe':
        emit(progress=100, message='Modelo local carregado.', ready=True)
        return
    if not args.input or not args.output:
        raise ValueError('input e output são obrigatórios')
    emit(progress=2, message='Transcrevendo no seu computador…')
    segments, info = model.transcribe(args.input, word_timestamps=True, vad_filter=True, beam_size=5)
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({'text': word.word.strip(), 'start': round(word.start, 4), 'end': round(word.end, 4), 'mediaId': args.media_id})
        emit(progress=min(98, 100 * segment.end / max(info.duration, .001)), message='Transcrevendo…')
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix('.partial.json')
    temp.write_text(json.dumps({'words': words, 'language': info.language, 'duration': info.duration}, ensure_ascii=False), encoding='utf-8')
    temp.replace(target)
    emit(progress=100, words=len(words), language=info.language, output=str(target))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(error=str(error))
        raise SystemExit(1)
