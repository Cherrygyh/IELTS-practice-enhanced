#!/usr/bin/env python3
"""Generate review transcripts from local listening audio on Apple Silicon.

Install mlx-whisper and imageio-ffmpeg in a separate virtual environment first.
The model downloads once; audio is decoded and transcribed locally. These are
automatic transcripts, not official scripts, and may contain recognition errors.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def bounded_segments(segments, duration):
    # Whisper can extend its final 30-second window beyond the decoded audio.
    result = []
    for segment in segments:
        start = max(0.0, round(segment["start"], 2))
        end = min(duration, round(segment["end"], 2))
        text = segment["text"].strip()
        if text and start < end:
            result.append({"start": start, "end": end, "text": text})
    return result


def write_transcript(folder, payload):
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    for name, text in (
        ("transcript.json", serialized),
        ("transcript.js", "window.IELTSListeningTranscript = " + serialized.rstrip() + ";\n"),
    ):
        path = folder / name
        temporary_path = path.with_suffix(path.suffix + ".tmp")
        temporary_path.write_text(text)
        temporary_path.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    parser.add_argument("--test", type=int)
    parser.add_argument("--part", type=int, choices=(1, 2, 3, 4))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    import imageio_ffmpeg
    import mlx.core as mx
    import mlx_whisper
    import numpy as np

    # Bound unused GPU buffers so long batches fit on an 8 GB Mac.
    mx.set_cache_limit(256 * 1024**2)
    manifest = json.loads((args.root / "ListeningPractice/sources.json").read_text())
    for entry in manifest["entries"]:
        if args.test is not None and entry["test"] != args.test:
            continue
        if args.part is not None and entry["part"] != args.part:
            continue
        folder = (args.root / entry["path"]).parent
        audio_path = folder / "audio.mp3"
        output_path = folder / "transcript.json"
        audio_hash = hashlib.sha256(audio_path.read_bytes()).hexdigest()
        if output_path.exists() and not args.overwrite:
            payload = json.loads(output_path.read_text())
            if payload.get("audioSha256") == audio_hash:
                write_transcript(folder, payload)
                print(f"Skip {entry['test']:02d}.{entry['part']}: matching transcript exists", flush=True)
                continue

        started = time.monotonic()
        print(f"Transcribing {entry['test']:02d}.{entry['part']}...", flush=True)
        decoded = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-i", str(audio_path),
             "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", "16000", "-"],
            check=True, capture_output=True,
        ).stdout
        audio = np.frombuffer(decoded, np.int16).astype(np.float32) / 32768.0
        result = mlx_whisper.transcribe(
            audio, path_or_hf_repo=args.model, language="en", task="transcribe",
            verbose=False, temperature=0, condition_on_previous_text=False,
        )
        segments = bounded_segments(result["segments"], len(audio) / 16000)
        if not segments:
            raise RuntimeError(f"No speech recognized in {audio_path}")
        payload = {
            "source": "automatic", "model": args.model, "language": "en",
            "audioSha256": audio_hash,
            "segments": segments,
        }
        write_transcript(folder, payload)
        mx.clear_cache()
        print(f"Saved {entry['test']:02d}.{entry['part']}: {len(segments)} segments, "
              f"{len(audio) / 16000:.0f}s audio in {time.monotonic() - started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
