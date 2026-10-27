from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

import edge_tts


def speech_parts(text: str) -> list[str]:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    parts: list[str] = []
    for sentence in sentences or [text]:
        if len(sentence) <= 105:
            parts.append(sentence)
            continue
        remaining = sentence
        while len(remaining) > 105:
            candidates = [remaining.rfind(mark, 45, 105) for mark in (", ", "; ", "—", " – ")]
            split_at = max(candidates)
            if split_at < 45:
                split_at = remaining.rfind(" ", 45, 105)
            if split_at < 45:
                split_at = 100
            if remaining[split_at:split_at + 2] in (", ", "; "):
                split_at += 1
            parts.append(remaining[:split_at].strip())
            remaining = remaining[split_at:].strip()
        if remaining:
            parts.append(remaining)
    return parts


async def synthesize_part(text: str, voice: str, rate: str, pitch: str, queue: asyncio.Queue) -> None:
    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                await queue.put(chunk["data"])
    except Exception as error:
        await queue.put(error)
    finally:
        await queue.put(None)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Stream Edge TTS MP3 to stdout and an E-drive cache file")
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", required=True)
    parser.add_argument("--pitch", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        raise ValueError("speech text is empty")
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        import msvcrt

        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    received = 0
    parts = speech_parts(text)
    queues = [asyncio.Queue() for _ in parts]
    tasks = [
        asyncio.create_task(synthesize_part(part, args.voice, args.rate, args.pitch, queue))
        for part, queue in zip(parts, queues)
    ]
    try:
        with output.open("wb") as cache_file:
            for queue in queues:
                while True:
                    data = await queue.get()
                    if data is None:
                        break
                    if isinstance(data, Exception):
                        raise data
                    cache_file.write(data)
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                    received += len(data)
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    if received < 1_000:
        raise RuntimeError("no usable audio was received")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
