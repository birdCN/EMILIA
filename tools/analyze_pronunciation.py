"""Local read-aloud analysis for the V1 pronunciation sampler.

This deliberately reports acoustic/prosodic evidence and reference agreement,
not a native-accent similarity score. Audio and transcript are transient.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import wave
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE = ROOT / "runtime" / "asr"


def load_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as stream:
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        sample_rate = stream.getframerate()
        frames = stream.readframes(stream.getnframes())
    if sample_width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(frames, dtype="<f4").astype(np.float32)
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if sample_rate != 16000:
        positions = np.linspace(0, len(audio) - 1, round(len(audio) * 16000 / sample_rate))
        audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)
        sample_rate = 16000
    return audio, sample_rate


def words(text: str) -> list[str]:
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def reference_agreement(reference: list[str], heard: list[str]) -> tuple[float, list[str]]:
    matcher = SequenceMatcher(a=reference, b=heard, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    missing: list[str] = []
    for operation, a1, a2, _b1, _b2 in matcher.get_opcodes():
        if operation in {"delete", "replace"}:
            missing.extend(reference[a1:a2])
    return matched / max(1, len(reference)), missing[:12]


def frame_rms(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
    frame = max(1, int(sample_rate * 0.025))
    hop = max(1, int(sample_rate * 0.010))
    if len(audio) < frame:
        return np.array([float(np.sqrt(np.mean(audio * audio) + 1e-12))]), hop / sample_rate
    count = 1 + (len(audio) - frame) // hop
    values = np.empty(count, dtype=np.float32)
    window = np.hanning(frame).astype(np.float32)
    for index in range(count):
        chunk = audio[index * hop:index * hop + frame] * window
        values[index] = np.sqrt(np.mean(chunk * chunk) + 1e-12)
    return values, hop / sample_rate


def pause_metrics(rms: np.ndarray, hop_seconds: float) -> tuple[np.ndarray, float, int]:
    noise_floor = float(np.percentile(rms, 18))
    upper = float(np.percentile(rms, 92))
    threshold = max(noise_floor * 2.4, upper * 0.085, 0.0014)
    voiced = rms > threshold
    active = np.flatnonzero(voiced)
    if active.size:
        voiced = voiced[active[0]:active[-1] + 1]
    silence = ~voiced
    long_pause_frames = max(1, round(0.32 / hop_seconds))
    count = 0
    run = 0
    for value in silence:
        run = run + 1 if value else 0
        if run == long_pause_frames:
            count += 1
    return voiced, float(silence.mean()) if silence.size else 0.0, count


def pitch_track(audio: np.ndarray, sample_rate: int, rms: np.ndarray) -> np.ndarray:
    frame = int(sample_rate * 0.04)
    hop = int(sample_rate * 0.03)
    min_lag = max(1, sample_rate // 350)
    max_lag = sample_rate // 70
    energy_gate = max(float(np.percentile(rms, 55)), 0.002)
    pitches: list[float] = []
    window = np.hanning(frame).astype(np.float32)
    for start in range(0, max(0, len(audio) - frame), hop):
        chunk = audio[start:start + frame]
        if float(np.sqrt(np.mean(chunk * chunk) + 1e-12)) < energy_gate:
            continue
        chunk = (chunk - chunk.mean()) * window
        correlation = np.correlate(chunk, chunk, mode="full")[frame - 1:]
        if correlation[0] <= 1e-6:
            continue
        region = correlation[min_lag:max_lag + 1]
        lag = int(np.argmax(region)) + min_lag
        strength = float(correlation[lag] / correlation[0])
        if strength >= 0.28:
            pitches.append(sample_rate / lag)
    return np.asarray(pitches, dtype=np.float32)


def score_near(value: float, low: float, high: float, width: float) -> float:
    if low <= value <= high:
        return 100.0
    distance = low - value if value < low else value - high
    return max(25.0, 100.0 - distance / width * 55.0)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--passage-id", default="read-aloud-v1")
    args = parser.parse_args()
    started = time.perf_counter()
    audio, sample_rate = load_wav(Path(args.audio).resolve())
    duration = len(audio) / sample_rate
    if duration < 12:
        raise ValueError("录音不足 12 秒，无法形成有效的长文本发音样本")

    model = WhisperModel(
        str(MODEL_CACHE / "base.en"),
        device="cpu",
        compute_type="int8",
        download_root=str(MODEL_CACHE),
        local_files_only=True,
        cpu_threads=max(2, min(8, os.cpu_count() or 4)),
        num_workers=1,
    )
    segments, _info = model.transcribe(
        str(Path(args.audio).resolve()),
        language="en",
        beam_size=3,
        best_of=3,
        temperature=0.0,
        condition_on_previous_text=False,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        initial_prompt=args.reference[:800],
    )
    transcript = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    reference_words = words(args.reference)
    heard_words = words(transcript)
    coverage, missed = reference_agreement(reference_words, heard_words)

    rms, hop_seconds = frame_rms(audio, sample_rate)
    voiced, pause_ratio, long_pauses = pause_metrics(rms, hop_seconds)
    active_seconds = max(1.0, voiced.size * hop_seconds)
    words_per_minute = len(heard_words) / active_seconds * 60.0
    pitches = pitch_track(audio, sample_rate, rms)
    if pitches.size >= 8:
        low_pitch, high_pitch = np.percentile(pitches, [10, 90])
        intonation_range = float(12 * math.log2(max(high_pitch, 1) / max(low_pitch, 1)))
        median_pitch = float(np.median(pitches))
    else:
        intonation_range = 0.0
        median_pitch = 0.0

    clipping_ratio = float(np.mean(np.abs(audio) >= 0.985))
    clarity_score = 100 * (0.78 * coverage + 0.22 * min(1.0, len(heard_words) / max(1, len(reference_words))))
    clarity_score -= min(18, clipping_ratio * 700)
    pacing_score = score_near(words_per_minute, 105, 165, 70)
    pause_score = score_near(pause_ratio, 0.08, 0.28, 0.35)
    pitch_score = score_near(intonation_range, 2.5, 10.5, 9)
    rhythm_score = 0.62 * pause_score + 0.38 * pitch_score

    suggestions: list[str] = []
    if coverage < 0.82:
        suggestions.append("先提高逐词清晰度；重点复读报告中未稳定识别的词，不要先追求更快语速。")
    if words_per_minute < 95:
        suggestions.append("语速偏慢；把意群内的词连起来读，停顿尽量放在逗号或完整意思之后。")
    elif words_per_minute > 180:
        suggestions.append("语速偏快；在重读词前略微放慢，避免弱读音节被吞掉。")
    if pause_ratio > 0.32 or long_pauses > 12:
        suggestions.append("长停顿较多；先用斜线标出意群，再以一个意群为单位连续朗读。")
    if intonation_range < 2.5:
        suggestions.append("音高变化较小；尝试突出每个意群的关键词，并在非最终意群保留轻微上扬。")
    if not suggestions:
        suggestions.append("本次清晰度、节奏与语速较均衡；下一次换一篇文本复测稳定性。")

    result = {
        "ok": True,
        "passageId": args.passage_id,
        "durationSeconds": round(duration, 2),
        "referenceWords": len(reference_words),
        "recognisedWords": len(heard_words),
        "wordCoverage": round(coverage, 4),
        "wordsPerMinute": round(words_per_minute, 1),
        "pauseRatio": round(pause_ratio, 4),
        "longPauseCount": long_pauses,
        "medianPitchHz": round(median_pitch, 1),
        "intonationRangeSemitones": round(intonation_range, 2),
        "clippingRatio": round(clipping_ratio, 5),
        "clarityScore": round(max(0, min(100, clarity_score))),
        "pacingScore": round(max(0, min(100, pacing_score))),
        "rhythmScore": round(max(0, min(100, rhythm_score))),
        "missedWords": missed,
        "transcriptPreview": transcript[:900],
        "suggestionsZh": suggestions[:4],
        "boundaryZh": "这是朗读中的可懂度、节奏和文本一致性诊断，不等同于官方雅思发音分，也不评价口音像不像母语者。",
        "processingMs": round((time.perf_counter() - started) * 1000),
        "model": "faster-whisper-base.en+local-acoustics-v1",
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=os.sys.stderr)
        raise SystemExit(1)
