"""Standard-library ownership tests; no model imports, GUI or external APIs."""
from __future__ import annotations

import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


TOOLS = Path(__file__).resolve().parents[2] / "tools"
WORKER = r'''
import json,sys,time
sys.path.insert(0,sys.argv[1])
try:
    from process_owner import start_owner_watchdog
except ModuleNotFoundError as error:
    if error.name != "process_owner": raise
    # The previous worker had no owner watchdog. Exercise that legacy behavior
    # until the new production module exists, so RED is an ownership assertion.
    def start_owner_watchdog(**kwargs): return None
watchdog=start_owner_watchdog(interval=.04,timeout=.08,failures=2)
print(json.dumps({"ready":True,"watchdog":watchdog is not None}),flush=True)
while True: time.sleep(60)
'''


class Owner:
    def __init__(self, token=None, statuses=None, redirect=None):
        self.token = token or str(uuid.uuid4())
        self.statuses = list(statuses or [])
        self.redirect = redirect
        self.requests = 0
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                owner.requests += 1
                valid = self.path == "/api/internal/asr-owner" and self.headers.get("X-Emilia-ASR-Owner") == owner.token
                code = owner.statuses.pop(0) if owner.statuses else 200 if valid else 403
                if owner.redirect:
                    self.send_response(302)
                    self.send_header("Location", owner.redirect)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                body = json.dumps({"ok": code == 200}).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_port
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.02), daemon=True)
        self.thread.start()

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=1)
            self.server = None


class ProcessOwnerTests(unittest.TestCase):
    def owner(self, **kwargs):
        value = Owner(**kwargs)
        self.addCleanup(value.close)
        return value

    def worker(self, owner=None, token=None, proxy=None):
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        for name in ("EMILIA_ASR_OWNER_TOKEN", "EMILIA_ASR_OWNER_PORT"):
            environment.pop(name, None)
        if owner:
            environment.update(EMILIA_ASR_OWNER_TOKEN=token or owner.token, EMILIA_ASR_OWNER_PORT=str(owner.port))
        if proxy:
            environment.update(HTTP_PROXY=proxy, HTTPS_PROXY=proxy, NO_PROXY="")
        child = subprocess.Popen([sys.executable, "-u", "-c", WORKER, str(TOOLS)], env=environment,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

        def cleanup():
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=2)
            child.stdout.close()
            child.stderr.close()

        self.addCleanup(cleanup)
        ready = child.stdout.readline()
        self.assertTrue(ready, "synthetic worker must start without model imports")
        return child, json.loads(ready)

    def exits_on_its_own(self, child):
        try:
            self.assertEqual(child.wait(timeout=2), 0)
        except subprocess.TimeoutExpired:
            self.fail("ASR worker remained alive after losing its authenticated owner")

    def test_owner_loss_stops_only_owned_worker_and_unrelated_sibling_survives(self):
        owner = self.owner()
        child, _ = self.worker(owner)
        unrelated, _ = self.worker()
        time.sleep(.18)
        self.assertIsNone(child.poll())
        owner.close()
        self.exits_on_its_own(child)
        self.assertIsNone(unrelated.poll())

    def test_different_owner_token_stops_worker_even_when_port_has_a_live_server(self):
        child, _ = self.worker(self.owner(), token=str(uuid.uuid4()))
        self.exits_on_its_own(child)

    def test_missing_owner_environment_keeps_legacy_worker_alive(self):
        child, ready = self.worker()
        self.assertFalse(ready["watchdog"])
        time.sleep(.18)
        self.assertIsNone(child.poll())

    def test_successful_sample_resets_consecutive_failures(self):
        owner = self.owner(statuses=[503, 200, 503, 503])
        child, _ = self.worker(owner)
        self.exits_on_its_own(child)
        self.assertEqual(owner.requests, 4)

    def test_owner_probes_bypass_configured_proxy(self):
        owner, proxy = self.owner(), self.owner()
        child, _ = self.worker(owner, proxy=f"http://127.0.0.1:{proxy.port}")
        time.sleep(.25)
        self.assertIsNone(child.poll())
        self.assertGreaterEqual(owner.requests, 2)
        self.assertEqual(proxy.requests, 0)
        owner.close()
        self.exits_on_its_own(child)

    def test_redirect_cannot_forward_private_owner_header(self):
        destination = self.owner()
        owner = self.owner(redirect=f"http://127.0.0.1:{destination.port}/api/internal/asr-owner")
        child, _ = self.worker(owner)
        self.exits_on_its_own(child)
        self.assertEqual(destination.requests, 0)

    def test_actual_asr_serve_starts_owner_watchdog_before_native_or_model_initialization(self):
        original_path = list(sys.path)
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), original_path))
        sys.path.insert(0, str(TOOLS))
        specification = importlib.util.spec_from_file_location("asr_owner_startup_fixture", TOOLS / "asr_turbo_service.py")
        service = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(service)
        started = []

        class StopBeforeNative(Exception):
            pass

        def native_boundary(*_args, **_kwargs):
            self.assertEqual(started, [True], "watchdog must start before native/model initialization")
            raise StopBeforeNative()

        with patch.object(service, "start_owner_watchdog", side_effect=lambda: started.append(True)), \
                patch("ctypes.WinDLL", side_effect=native_boundary, create=True):
            with self.assertRaises(StopBeforeNative):
                service.serve()


if __name__ == "__main__":
    unittest.main()
