from __future__ import annotations

import os
import argparse
import gc
import json
import re
import sys
import time
from pathlib import Path

from kokoro_gpu_runtime import configure
GPU_REQUESTED = configure()
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from espeak_paths import espeak_runtime


DEMO_ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = DEMO_ROOT / "runtime" / "tts" / "kokoro"
MODEL_PATH = MODEL_ROOT / "kokoro-v1.0.onnx"
VOICE_ROOT = MODEL_ROOT / "voices"
VOICE_PACK_PATH = MODEL_ROOT / "voices-selected-v1.npz"
ESPEAK_ROOT = Path(os.environ["IELTS_ESPEAK_ROOT"]) if os.environ.get("IELTS_ESPEAK_ROOT") else None

PRESETS: dict[str, dict[str, float]] = {
    "heart": {"af_heart": 1.0},
    "bella": {"af_bella": 1.0},
    "soft": {"af_heart": 0.68, "af_bella": 0.20, "af_aoede": 0.12},
    "bright": {"af_heart": 0.52, "af_bella": 0.34, "af_sky": 0.14},
    "gentle": {"af_heart": 0.58, "af_aoede": 0.24, "bf_emma": 0.18},
    "higher_soft": {"af_heart": 0.56, "af_sky": 0.28, "af_aoede": 0.16},
    "extra_soft": {"af_heart": 0.72, "af_aoede": 0.20, "af_sky": 0.08},
    "lively_soft": {"af_heart": 0.50, "af_bella": 0.38, "af_nova": 0.12},
    "elf_crystal": {"af_heart": 0.50, "jf_alpha": 0.35, "af_sky": 0.15},
    "elf_ethereal": {"af_heart": 0.55, "jf_tebukuro": 0.25, "af_aoede": 0.20},
    "elf_sprite": {"af_heart": 0.45, "jf_alpha": 0.25, "af_bella": 0.20, "jf_nezumi": 0.10},
    "elf_bold": {"af_heart": 0.34, "jf_alpha": 0.50, "af_sky": 0.16},
    "elf_bolder": {"af_heart": 0.27, "jf_alpha": 0.48, "jf_tebukuro": 0.15, "af_bella": 0.10},
    "elf_extreme": {"af_heart": 0.20, "jf_alpha": 0.52, "jf_nezumi": 0.18, "af_sky": 0.10},
    "emilia_timbre_a": {"jf_alpha": 0.72, "af_heart": 0.20, "af_sky": 0.08},
    "emilia_timbre_b": {"jf_gongitsune": 0.55, "jf_alpha": 0.15, "af_heart": 0.20, "af_aoede": 0.10},
    "emilia_timbre_c": {"jf_nezumi": 0.45, "jf_alpha": 0.25, "af_heart": 0.20, "af_bella": 0.10},
}


def split_speech_chunks(text: str, max_chars: int = 110) -> list[str]:
    """Split before phonemization so one long reply cannot spike CUDA memory.

    Prefer sentence/clause boundaries. A final whitespace split is only used
    for an unusually long clause. Text order and punctuation are preserved.
    """
    normalized = " ".join(text.split())
    if len(normalized) <= max_chars:
        return [normalized] if normalized else []
    chunks: list[str] = []
    remaining = normalized
    while len(remaining) > max_chars:
        window = remaining[: max_chars + 1]
        candidates = [match.end() for match in re.finditer(r"[.!?;:,—–-]\s+", window)]
        split_at = max((position for position in candidates if position >= 45), default=0)
        if not split_at:
            split_at = window.rfind(" ")
        if split_at < 30:
            split_at = max_chars
        piece = remaining[:split_at].strip()
        if piece:
            chunks.append(piece)
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def allocator_failed(error: Exception) -> bool:
    message = str(error)
    return (
        "BFCArena::AllocateRawInternal" in message
        or ("Available memory of" in message and "smaller than requested bytes" in message)
    )


def split_near_middle(text: str) -> tuple[str, str]:
    middle = len(text) // 2
    spaces = [index for index, character in enumerate(text) if character == " "]
    split_at = min(spaces, key=lambda index: abs(index - middle)) if spaces else middle
    return text[:split_at].strip(), text[split_at:].strip()


def ensure_voice_pack() -> Path:
    official = MODEL_ROOT / "voices-v1.0.bin"
    if official.exists():
        return official
    voice_files = sorted(VOICE_ROOT.glob("*.bin"))
    if not voice_files:
        raise FileNotFoundError(f"No voice files found in {VOICE_ROOT}")
    newest_voice = max(path.stat().st_mtime for path in voice_files)
    if VOICE_PACK_PATH.exists() and VOICE_PACK_PATH.stat().st_mtime >= newest_voice:
        return VOICE_PACK_PATH
    voices: dict[str, np.ndarray] = {}
    for path in voice_files:
        voice = np.fromfile(path, dtype=np.float32)
        if voice.size % 256:
            raise ValueError(f"Invalid voice embedding: {path.name}")
        voices[path.stem] = voice.reshape(-1, 1, 256)
    np.savez(VOICE_PACK_PATH, **voices)
    return VOICE_PACK_PATH


def voice_style(kokoro: Kokoro, preset: str) -> np.ndarray:
    weights = PRESETS.get(preset)
    if not weights:
        raise ValueError(f"Unknown voice preset: {preset}")
    result: np.ndarray | None = None
    total = sum(weights.values())
    for name, weight in weights.items():
        contribution = kokoro.get_voice_style(name) * np.float32(weight / total)
        result = contribution if result is None else result + contribution
    if result is None:
        raise ValueError("Voice preset is empty")
    return result


def ensure_output_path(raw_path: str) -> Path:
    output = Path(raw_path).resolve()
    allowed_roots = [
        (DEMO_ROOT / "runtime").resolve(),
        (DEMO_ROOT / "public" / "assets" / "voice").resolve(),
    ]
    if not any(output.is_relative_to(root) for root in allowed_roots):
        raise ValueError("Output path is outside the project voice folders")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def synthesize(
    kokoro: Kokoro,
    text: str,
    output_path: str,
    preset: str = "soft",
    speed: float = 0.96,
    pitch_semitones: float = 0.0,
) -> dict[str, float | int | str]:
    normalized = " ".join(text.split())
    if not normalized or not any(character.isalpha() for character in normalized):
        raise ValueError("Speech text is empty")
    if len(normalized) > 800:
        raise ValueError("Speech text is too long")
    output = ensure_output_path(output_path)
    started = time.perf_counter()
    style = voice_style(kokoro, preset)
    bounded_speed = max(0.75, min(1.20, float(speed)))

    def create_piece(piece: str) -> list[tuple[np.ndarray, int, str]]:
        try:
            with espeak_runtime(ESPEAK_ROOT):
                samples, sample_rate = kokoro.create(
                    piece,
                    voice=style,
                    speed=bounded_speed,
                    lang="en-us",
                )
            return [(samples, sample_rate, piece)]
        except Exception as error:
            if not allocator_failed(error):
                raise
            # If an unusually dense chunk still peaks too high, bisect only
            # that chunk. This is bounded and does not repeat successful work.
            gc.collect()
            if len(piece) > 48:
                left, right = split_near_middle(piece)
                if left and right:
                    return create_piece(left) + create_piece(right)
            # Tiny chunks should fit after arena shrink; one final retry keeps
            # a transient allocation failure from dropping the spoken turn.
            with espeak_runtime(ESPEAK_ROOT):
                samples, sample_rate = kokoro.create(
                    piece,
                    voice=style,
                    speed=bounded_speed,
                    lang="en-us",
                )
            return [(samples, sample_rate, piece)]

    rendered: list[tuple[np.ndarray, int, str]] = []
    for chunk in split_speech_chunks(normalized):
        rendered.extend(create_piece(chunk))
    if not rendered:
        raise ValueError("Speech text produced no audio chunks")
    sample_rate = rendered[0][1]
    if any(rate != sample_rate for _, rate, _ in rendered):
        raise RuntimeError("Kokoro returned inconsistent sample rates")
    joined: list[np.ndarray] = []
    for index, (chunk_samples, _, chunk_text) in enumerate(rendered):
        joined.append(chunk_samples)
        if index < len(rendered) - 1:
            pause_seconds = 0.105 if re.search(r"[.!?][\"']?$", chunk_text) else 0.055
            joined.append(np.zeros(round(sample_rate * pause_seconds), dtype=chunk_samples.dtype))
    samples = np.concatenate(joined)
    synth_ms = (time.perf_counter() - started) * 1000
    pitch_semitones = max(-4.0, min(4.0, float(pitch_semitones)))
    output_sample_rate = round(sample_rate * (2 ** (pitch_semitones / 12)))
    sf.write(output, samples, output_sample_rate, subtype="PCM_16")
    duration_ms = len(samples) / output_sample_rate * 1000
    return {
        "output": str(output),
        "preset": preset,
        "sampleRate": int(output_sample_rate),
        "pitchSemitones": round(pitch_semitones, 2),
        "synthMs": round(synth_ms, 1),
        "durationMs": round(duration_ms, 1),
        "rtf": round(synth_ms / max(duration_ms, 1), 4),
        "chunkCount": len(rendered),
    }


def load_engine() -> tuple[Kokoro, float]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model: {MODEL_PATH}")
    voice_pack = ensure_voice_pack()
    started = time.perf_counter()
    if GPU_REQUESTED:
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.log_severity_level = 3
        providers = [('CUDAExecutionProvider', {
            'cudnn_conv_algo_search': 'HEURISTIC', 'cudnn_conv_use_max_workspace': '0',
            'gpu_mem_limit': str(2 * 1024**3), 'arena_extend_strategy': 'kSameAsRequested',
            'use_tf32': '0'
        }), 'CPUExecutionProvider']
        session = ort.InferenceSession(str(MODEL_PATH), sess_options=options, providers=providers)
        original_run = session.run

        def run_with_arena_shrink(output_names, input_feed, run_options=None):
            # Keep model weights/session resident, but return completely idle
            # CUDA arena regions after each inference. This prevents varying
            # sentence shapes from exhausting the 2 GiB arena through cached
            # regions and fragmentation during a long conversation.
            active_options = run_options if run_options is not None else ort.RunOptions()
            active_options.add_run_config_entry(
                "memory.enable_memory_arena_shrinkage", "gpu:0"
            )
            return original_run(output_names, input_feed, active_options)

        session.run = run_with_arena_shrink
        with espeak_runtime(ESPEAK_ROOT) as espeak:
            engine = Kokoro.from_session(session, str(voice_pack), espeak_config=espeak)
    else:
        with espeak_runtime(ESPEAK_ROOT) as espeak:
            engine = Kokoro(str(MODEL_PATH), str(voice_pack), espeak_config=espeak)
    return engine, (time.perf_counter() - started) * 1000


def run_worker() -> int:
    # Node writes JSONL as UTF-8. Windows otherwise opens redirected stdin with
    # the active ANSI code page, which corrupts Chinese characters in E-drive paths.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    engine, load_ms = load_engine()
    warm_started = time.perf_counter()
    with espeak_runtime(ESPEAK_ROOT):
        engine.create("Hi! Good to see you. How has your day been so far?",
                      voice=voice_style(engine, "emilia_timbre_a"), speed=.91, lang="en-us")
    load_ms += (time.perf_counter() - warm_started) * 1000
    print(json.dumps({
        "type": "ready",
        "loadMs": round(load_ms, 1),
        "presets": sorted(PRESETS),
        "model": str(MODEL_PATH),
        "providers": engine.sess.get_providers(),
    }), flush=True)
    for line in sys.stdin:
        request: dict = {}
        try:
            request = json.loads(line)
            if request.get("op") == "stop":
                return 0
            if request.get("op") != "synthesize":
                raise ValueError("Unknown worker operation")
            result = synthesize(
                engine,
                str(request.get("text") or ""),
                str(request.get("output") or ""),
                str(request.get("preset") or "soft"),
                float(request.get("speed") or 0.96),
                float(request.get("pitchSemitones") or 0.0),
            )
            print(json.dumps({"type": "result", "id": request.get("id"), **result}), flush=True)
        except Exception as error:
            print(json.dumps({
                "type": "error",
                "id": request.get("id") if isinstance(request, dict) else None,
                "error": str(error),
            }), flush=True)
    return 0


def run_once(args: argparse.Namespace) -> int:
    engine, load_ms = load_engine()
    result = synthesize(engine, args.text, args.output, args.preset, args.speed, args.pitch_semitones)
    print(json.dumps({"loadMs": round(load_ms, 1), **result}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Persistent offline Kokoro TTS worker")
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--text")
    parser.add_argument("--output")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="soft")
    parser.add_argument("--speed", type=float, default=0.96)
    parser.add_argument("--pitch-semitones", type=float, default=0.0)
    args = parser.parse_args()
    if args.worker:
        return run_worker()
    if not args.text or not args.output:
        parser.error("--text and --output are required outside worker mode")
    return run_once(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"type": "fatal", "error": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
