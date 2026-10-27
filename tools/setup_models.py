"""Download speech and embedding models from upstream repositories."""
from __future__ import annotations
import argparse
import os
import shutil
from pathlib import Path
import requests
from huggingface_hub import hf_hub_download, snapshot_download

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime"
CACHE = RUNTIME / "cache" / "huggingface"
SOURCES = {
    "tts": "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    "voices": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
    "asr": "https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo",
    "pronunciation": "https://huggingface.co/Systran/faster-whisper-base.en",
    "rag": "https://huggingface.co/Xenova/multilingual-e5-small",
}

def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        print(f"Already present: {target.name}")
        return
    partial = target.with_suffix(target.suffix + ".part")
    with requests.get(url, stream=True, timeout=(20, 120)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
    os.replace(partial, target)

def main() -> None:
    parser = argparse.ArgumentParser(description="Download optional model weights from their upstream sources")
    parser.add_argument("--download", action="store_true", help="Download several GB; review model licenses first")
    parser.add_argument("--only", choices=["all", "tts", "asr", "pronunciation", "rag"], default="all")
    args = parser.parse_args()
    for label, url in SOURCES.items():
        print(f"{label}: {url}")
    if not args.download:
        print("No download performed. Read THIRD_PARTY_NOTICES.md, then use --download.")
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.only in ("all", "tts"):
        tts = RUNTIME / "tts" / "kokoro"
        download("https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx", tts / "kokoro-v1.0.onnx")
        for voice in ("jf_alpha", "af_heart", "af_sky"):
            source = hf_hub_download("onnx-community/Kokoro-82M-v1.0-ONNX", f"voices/{voice}.bin", cache_dir=CACHE)
            (tts / "voices").mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, tts / "voices" / f"{voice}.bin")
    if args.only in ("all", "asr"):
        snapshot_download("dropbox-dash/faster-whisper-large-v3-turbo", local_dir=RUNTIME / "asr" / "large-v3-turbo", cache_dir=CACHE,
                          allow_patterns=["config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "vocabulary.txt", "LICENSE*", "README.md"])
    if args.only in ("all", "asr", "pronunciation"):
        snapshot_download("Systran/faster-whisper-base.en", local_dir=RUNTIME / "asr" / "base.en", cache_dir=CACHE,
                          allow_patterns=["config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "vocabulary.txt", "LICENSE*", "README.md"])
    if args.only in ("all", "rag"):
        root = RUNTIME / "rag" / "models" / "multilingual-e5-small-int8"
        for filename in ("tokenizer.json", "tokenizer_config.json", "config.json", "onnx/model_int8.onnx"):
            source = hf_hub_download("Xenova/multilingual-e5-small", filename, cache_dir=CACHE)
            target = root / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    print("Download finished. Run npm run doctor. Weights remain under ignored runtime/.")

if __name__ == "__main__":
    main()
