"""Persistent, loopback-only Local ASR. No transcripts/audio are stored."""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from process_owner import start_owner_watchdog

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "runtime" / "asr" / "large-v3-turbo"
STATE_ROOT = ROOT / "runtime" / "asr"
MODEL_NAME = "large-v3-turbo"
VERSION = "turbo-local-v1"
PORT = int(os.environ.get("IELTS_ASR_PORT", "4431"))
URL = f"http://127.0.0.1:{PORT}"
TOKEN_PATH = STATE_ROOT / "worker-token.txt"
IDLE_TIMEOUT_SECONDS = max(600, int(os.environ.get("IELTS_LOCAL_MODEL_IDLE_MS", "1800000")) // 1000)


def status():
    # Never route local microphone requests through a configured system proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(URL + "/health", timeout=1) as response:
            result = json.load(response)
        return result if result.get("service") == VERSION else None
    except (OSError, ValueError):
        return None


def ensure_worker():
    current = status()
    if current and current.get("ready"):
        return current
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    # Cross-process lock: the existing Node service may launch several clients.
    import msvcrt
    with (STATE_ROOT / "worker-start.lock").open("a+b") as lock:
        deadline = time.monotonic() + 65
        while True:
            try:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("ASR is still loading; please retry shortly")
                time.sleep(.2)
        try:
            current = status()
            if current is None:
                if not (MODEL_ROOT / "model.bin").is_file():
                    raise RuntimeError("The local large-v3-turbo model is not installed")
                # python.exe in a venv is a launcher that starts another process.
                # Use the GUI-subsystem launcher for BOTH levels. DETACHED_PROCESS
                # must not be combined with CREATE_NO_WINDOW: Windows ignores the
                # latter in that combination and the child may open a new terminal.
                windowless_python = Path(sys.executable).with_name("pythonw.exe")
                if not windowless_python.is_file():
                    raise RuntimeError("Missing pythonw.exe; refusing to open a console window")
                startup = subprocess.STARTUPINFO()
                startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startup.wShowWindow = subprocess.SW_HIDE
                with (STATE_ROOT / "worker.log").open("ab") as log:
                    subprocess.Popen(
                        [str(windowless_python), str(Path(__file__).resolve()), "--serve"],
                        cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        startupinfo=startup, close_fds=True,
                    )
            while time.monotonic() < deadline:
                current = status()
                if current and current.get("ready"):
                    return current
                if current and current.get("error"):
                    raise RuntimeError(current["error"])
                time.sleep(.25)
            raise RuntimeError("GPU ASR startup timed out; see runtime/asr/worker.log")
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def transcribe_file(path):
    started = time.perf_counter()
    ensure_worker()
    token = TOKEN_PATH.read_text(encoding="ascii").strip()
    request = urllib.request.Request(
        URL + "/transcribe", data=Path(path).read_bytes(),
        headers={"Content-Type": "audio/wav", "Authorization": "Bearer " + token},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=75) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        result = json.load(error)
    result["processingMs"] = round((time.perf_counter() - started) * 1000)
    return result


def serve():
    start_owner_watchdog()
    # pythonw may have no Python stdio objects. Keep diagnostics in the existing
    # E-drive log, never allocate a console just to print status or errors.
    if sys.stdout is None:
        sys.stdout = (STATE_ROOT / "worker.log").open("a", encoding="utf-8", buffering=1)
    if sys.stderr is None:
        sys.stderr = sys.stdout
    import ctypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetConsoleWindow.restype = ctypes.c_void_p
    console_window = int(kernel32.GetConsoleWindow() or 0)
    # Register the isolated CUDA runtime before importing CTranslate2.
    cuda_root = Path(os.environ.get("IELTS_ASR_CUDA_ROOT",str(ROOT / "runtime" / "optional-gpu" / "asr-cuda"))) / "nvidia"
    dll_dirs = sorted({path.parent for path in cuda_root.rglob("*.dll")})
    dll_handles = [os.add_dll_directory(str(path)) for path in dll_dirs]
    os.environ["PATH"] = os.pathsep.join(map(str, dll_dirs)) + os.pathsep + os.environ.get("PATH", "")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HOME"] = str(ROOT / "runtime" / "cache" / "huggingface")
    os.environ["TEMP"] = os.environ["TMP"] = str(ROOT / "runtime" / "temp")
    state = {"ok": True, "ready": False, "service": VERSION,
             "model": MODEL_NAME, "device": os.environ.get("IELTS_ASR_DEVICE", "cpu"), "computeType": os.environ.get("IELTS_ASR_COMPUTE_TYPE", "int8"), "storage": str(STATE_ROOT),
             "pid": os.getpid(), "startedAt": time.time(),
             "executable": Path(sys.executable).name, "consoleWindow": console_window,
             "idleTimeoutSeconds": IDLE_TIMEOUT_SECONDS}
    model = None
    inference_lock = threading.Lock()
    last_activity = [time.monotonic()]
    token = os.urandom(32).hex()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # No request/audio/transcript logs.

        def reply(self, code, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            self.reply(200 if self.path == "/health" else 404,
                       state if self.path == "/health" else {"ok": False})

        def do_POST(self):
            if self.path != "/transcribe":
                return self.reply(404, {"ok": False})
            if self.headers.get("Authorization") != "Bearer " + token or self.headers.get("Origin"):
                return self.reply(403, {"ok": False, "error": "Unauthorized"})
            if not state["ready"]:
                return self.reply(503, {"ok": False, "error": state.get("error", "ASR is warming up")})
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 44 <= size <= 12 * 1024 * 1024:
                return self.reply(413, {"ok": False, "error": "Invalid audio size"})
            if not inference_lock.acquire(blocking=False):
                return self.reply(429, {"ok": False, "error": "ASR is busy; retry after the current recording"})
            last_activity[0] = time.monotonic()
            started = time.perf_counter()
            try:
                self.connection.settimeout(15)
                data = self.rfile.read(size)
                if len(data) != size or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
                    raise ValueError("Invalid WAV recording")
                segments, info = model.transcribe(
                    io.BytesIO(data), language="en", task="transcribe",
                    beam_size=5, temperature=0.0, condition_on_previous_text=False,
                    vad_filter=True, vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 350},
                    word_timestamps=True, hallucination_silence_threshold=2.0,
                )
                parts = list(segments)
                text = " ".join(part.text.strip() for part in parts if part.text.strip()).strip()
                uncertain = [word.word.strip() for part in parts for word in (part.words or [])
                             if word.word.strip() and word.probability < .55]
                self.reply(200, {"ok": bool(text), "text": text,
                    "error": None if text else "No clear English speech detected; nothing was sent",
                    "model": MODEL_NAME, "device": state["device"], "service": VERSION,
                    "duration": round(float(info.duration), 3), "language": info.language,
                    # Word posterior scores are not calibrated learner/ASR accuracy.
                    "asrConfidence": None, "uncertainWords": uncertain[:16],
                    "reviewRecommended": bool(uncertain),
                    "inferenceMs": round((time.perf_counter() - started) * 1000)})
            except Exception as error:
                self.reply(500, {"ok": False, "error": str(error)})
            finally:
                last_activity[0] = time.monotonic()
                inference_lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    TOKEN_PATH.write_text(token, encoding="ascii")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        from faster_whisper import WhisperModel
        import numpy as np
        started = time.perf_counter()
        model = WhisperModel(str(MODEL_ROOT), device=os.environ.get("IELTS_ASR_DEVICE", "cpu"), compute_type=os.environ.get("IELTS_ASR_COMPUTE_TYPE", "int8"),
                             local_files_only=True, num_workers=1)
        # Warm VAD, beam search and word alignment too, using only the existing
        # synthetic greeting. Nothing is played or taken from learner recordings.
        fixture = ROOT / "public/assets/voice/emilia-kokoro-a/0e5cbfbb07ba62f4dd1475af.wav"
        warm_audio = str(fixture) if fixture.exists() else np.zeros(16000, dtype=np.float32)
        segments, _ = model.transcribe(warm_audio, language="en", beam_size=5,
                                      word_timestamps=True, vad_filter=fixture.exists())
        list(segments)
        state.update(ready=True, loadMs=round((time.perf_counter() - started) * 1000))
        print(json.dumps(state), flush=True)
    except Exception as error:
        state.update(ok=False, error=str(error))
        print(json.dumps(state), flush=True)
    while True:
        time.sleep(30)
        if state.get("ready") and not inference_lock.locked() \
                and time.monotonic() - last_activity[0] >= IDLE_TIMEOUT_SECONDS:
            state.update(ready=False, idleShutdown=True)
            server.shutdown()
            server.server_close()
            TOKEN_PATH.unlink(missing_ok=True)
            return


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("audio", nargs="?")
    args = parser.parse_args()
    if args.serve:
        serve()
    else:
        try:
            result = ensure_worker() if args.prepare else transcribe_file(args.audio)
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(0 if result.get("ok") else 2)
        except Exception as error:
            print(json.dumps({"ok": False, "error": str(error)}))
            sys.exit(1)
