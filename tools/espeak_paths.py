"""Keep narrow-path eSpeak data access compatible with Unicode Windows installs."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import threading


_lock = threading.RLock()


@contextmanager
def espeak_runtime(root: Path | None = None):
    """Supply Kokoro config and scope all native phonemization to its data root.

    The bundled Windows DLL accepts narrow paths. Phonemizer resolves its data
    directory to an absolute path before initializing that DLL, so passing a
    relative Kokoro config alone still fails for Chinese installation paths.
    Adapt that one constructor boundary while this dedicated TTS operation runs;
    no installed dependency, short filename, resource copy or OS setting changes.
    """
    import espeakng_loader
    from kokoro_onnx import EspeakConfig

    if root is None:
        data = Path(espeakng_loader.get_data_path()).resolve()
        library = Path(espeakng_loader.get_library_path()).resolve()
    else:
        root = Path(root).resolve()
        data, library = root / "espeak-ng-data", root / "espeak-ng.dll"
    if not data.is_dir() or not library.is_file():
        raise FileNotFoundError("The private eSpeak library or data directory is missing")
    config = EspeakConfig(lib_path=str(library), data_path=str(data))
    if os.name != "nt" or str(data).isascii():
        yield config
        return

    import phonemizer.backend.espeak.wrapper as wrapper

    # CWD is process-wide. TTS has a dedicated process and all its eSpeak calls
    # enter this context; serialize nested/threaded callers and always restore it.
    with _lock:
        previous_cwd = Path.cwd()
        original_api = wrapper.EspeakAPI

        def initialize(library_path, data_path):
            if data_path is not None and Path(data_path).resolve() == data:
                data_path = data.name  # ASCII "espeak-ng-data", even without 8.3 names.
            return original_api(library_path, data_path)

        try:
            os.chdir(data.parent)
            wrapper.EspeakAPI = initialize
            yield config
        finally:
            wrapper.EspeakAPI = original_api
            os.chdir(previous_cwd)
