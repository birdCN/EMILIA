"""Stop only this private worker when its authenticated Node owner disappears."""
from __future__ import annotations

import json
import os
import threading
import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the private owner header to another endpoint.


def owner_is_alive(port: int, token: str, *, timeout: float = 1.0) -> bool:
    """Probe only loopback, without system/environment proxies or redirects."""
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/internal/asr-owner",
        headers={"X-Emilia-ASR-Owner": token},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                return False
            body = response.read(1025)
        if len(body) > 1024:
            return False
        payload = json.loads(body)
        return isinstance(payload, dict) and payload.get("ok") is True
    except (OSError, ValueError):
        return False


def start_owner_watchdog(*, environment=None, interval: float = 1.0,
                         timeout: float = 1.0, failures: int = 2,
                         probe=None, exit_process=None):
    """Watch an explicit owner; legacy/manual workers with no owner stay unowned.

    The returned event can stop the watcher. An owner token is kept in memory
    only and is never logged or written to a file. No other process is killed.
    """
    environment = os.environ if environment is None else environment
    token = environment.get("EMILIA_ASR_OWNER_TOKEN")
    raw_port = environment.get("EMILIA_ASR_OWNER_PORT")
    if not token or not raw_port:
        return None
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        raise ValueError("Invalid private process-owner port") from None
    if not 1 <= port <= 65535 or interval <= 0 or timeout <= 0 or not isinstance(failures, int) or failures < 1:
        raise ValueError("Invalid private process-owner policy")
    check = probe if probe is not None else lambda: owner_is_alive(port, token, timeout=timeout)
    terminate = os._exit if exit_process is None else exit_process
    stopped = threading.Event()

    def watch():
        consecutive = 0
        while not stopped.wait(interval):
            try:
                alive = check()
            except Exception:
                alive = False
            consecutive = 0 if alive else consecutive + 1
            if consecutive >= failures:
                if not stopped.is_set():
                    terminate(0)
                return

    threading.Thread(target=watch, name="emilia-asr-owner", daemon=True).start()
    return stopped
