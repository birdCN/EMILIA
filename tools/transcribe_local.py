"""Small per-request client; the local large-v3-turbo GPU model stays warm.

Keeps the existing Node server compatible without restarting active lessons.
No silent fallback to base.en and no audio or transcript persistence here.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from asr_turbo_service import ensure_worker, transcribe_file


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Local GPU English transcription")
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    try:
        if args.prepare:
            result = ensure_worker()
        else:
            if not args.audio:
                parser.error("audio path is required unless --prepare is used")
            path = Path(args.audio).resolve()
            if not path.is_file():
                raise FileNotFoundError(path)
            result = transcribe_file(path)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") else 2
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
