"""Maintainer-only resolver for the Windows x64 online installer.

Uses official release/PyPI/Hugging Face metadata, downloads all binary wheels,
and verifies their SHA-256 before creating artifacts.json. No target-machine
Python, pip, global installation, API credentials or model service is needed.
Run with Python 3.11+ and --cache outside the distributable source directory.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None

PYTHON_VERSION = "3.13.17"
# Published by python.org/downloads/release/python-31317/ (2026-10-21).
PYTHON_SHA256 = "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38"
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx"
KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/expanded_assets/model-files-v1.1"
KOKORO_HF_REPO = "kanirudh/kokoro-82m-onnx"
KOKORO_HF_REVISION = "be37f7d55632acf0b6b4a17eb4cf673c06dcebed"


def fetch(url: str) -> bytes:
    if requests is not None:
        for attempt in range(3):
            try:
                response = requests.get(url, timeout=(20, 180), headers={"User-Agent": "EmiliaInstallerArtifactResolver/1"})
                response.raise_for_status()
                return response.content
            except requests.RequestException:
                if attempt == 2:
                    raise
    request = urllib.request.Request(url, headers={"User-Agent": "EmiliaInstallerArtifactResolver/1"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(url: str, path: Path, expected: str | None = None) -> tuple[int, str]:
    if path.exists() and (expected is None or sha256(path) == expected):
        return path.stat().st_size, sha256(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    if requests is not None:
        with requests.get(url, stream=True, timeout=(20, 180), headers={"User-Agent": "EmiliaInstallerArtifactResolver/1"}) as response:
            response.raise_for_status()
            with partial.open("wb") as target:
                for chunk in response.iter_content(1024 * 1024):
                    if chunk:
                        target.write(chunk)
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "EmiliaInstallerArtifactResolver/1"})
        with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as target:
            shutil.copyfileobj(response, target, 1024 * 1024)
    actual = sha256(partial)
    if expected and actual != expected:
        partial.unlink()
        raise ValueError(f"SHA-256 mismatch: {url}")
    partial.replace(path)
    return path.stat().st_size, actual


def artifact(ident: str, kind: str, url: str, digest: str, size: int, destination: str, **extra) -> dict:
    assert re.fullmatch(r"[a-z0-9-]+", ident)
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert size > 0
    return dict(id=ident, kind=kind, url=url, sha256=digest, size=size, destination=destination, **extra)


def vc_runtime(cache: Path, blobs: Path) -> dict:
    """Resolve Microsoft's redistributable and require its valid MS signature."""
    metadata_path = cache / "vc-runtime.json"
    path = blobs / "vc-runtime.blob"
    if metadata_path.exists():
        info = json.loads(metadata_path.read_text(encoding="utf-8"))
        download(info["url"], path, info["sha256"])
    else:
        source = "https://aka.ms/vc14/vc_redist.x64.exe"
        with urllib.request.urlopen(source, timeout=180) as response:
            url = response.geturl()
            with path.open("wb") as target:
                shutil.copyfileobj(response, target, 1024 * 1024)
        info = dict(url=url, sha256=sha256(path), size=path.stat().st_size, sourceUrl=source)
        metadata_path.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    quoted_path = str(path).replace("'", "''")
    command = "$s=Get-AuthenticodeSignature -LiteralPath '" + quoted_path + "'; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Invalid Microsoft VC runtime signature' }; Write-Output $s.SignerCertificate.Subject"
    subprocess.run([shutil.which("pwsh.exe") or "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], check=True)
    return artifact("vc-runtime", "model", info["url"], info["sha256"], info["size"], "runtime/support/VC_redist.x64.exe")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="Build cache; installer blobs are in cache/blobs")
    parser.add_argument("--python", default=sys.executable, help="Existing build Python with pip; never installed or modified")
    parser.add_argument("--skip-wheel-download", action="store_true", help="Use an already-resolved cache/wheels directory")
    parser.add_argument("--download-models", action="store_true", help="Also populate the approximately 2.3 GB model cache")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("artifacts.json"))
    args = parser.parse_args()
    cache = args.cache.resolve()
    blobs = cache / "blobs"
    blobs.mkdir(parents=True, exist_ok=True)
    wheels = cache / "wheels"
    wheels.mkdir(exist_ok=True)
    project = Path(__file__).resolve().parent.parent
    if not args.skip_wheel_download:
        subprocess.run([args.python, "-m", "pip", "download", "--only-binary=:all:", "--platform", "win_amd64", "--python-version", "313", "--implementation", "cp", "--abi", "cp313", "--dest", str(wheels), "--requirement", str(project / "requirements.txt"), "--disable-pip-version-check"], check=True)

    artifacts = [vc_runtime(cache, blobs)]
    shasums_url = "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"
    sums = fetch(shasums_url).decode("utf-8")
    (cache / "node-SHASUMS256.txt").write_text(sums, encoding="utf-8")
    digest, filename = next(line.split() for line in sums.splitlines() if line.endswith("-win-x64.zip"))
    node_version = filename.split("-")[1]
    ident = "node-" + node_version[1:].replace(".", "-") + "-win-x64"
    url = f"https://nodejs.org/dist/{node_version}/{filename}"
    size, _ = download(url, blobs / (ident + ".blob"), digest)
    artifacts.append(artifact(ident, "node", url, digest, size, "runtime/node", stripPrefix=filename[:-4]))

    ident = "python-" + PYTHON_VERSION.replace(".", "-") + "-embed-amd64"
    url = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
    size, digest = download(url, blobs / (ident + ".blob"), PYTHON_SHA256)
    artifacts.append(artifact(ident, "python", url, digest, size, "runtime/python"))

    def wheel_entry(path: Path) -> dict:
        package, version = path.name.split("-")[:2]
        metadata_path = cache / "pypi" / f"{package}-{version}.json"
        if not metadata_path.exists():
            metadata_path.parent.mkdir(exist_ok=True)
            metadata_path.write_bytes(fetch(f"https://pypi.org/pypi/{package}/{version}/json"))
        metadata = json.loads(metadata_path.read_bytes())
        info = next(item for item in metadata["urls"] if item["filename"] == path.name)
        digest = info["digests"]["sha256"]
        if sha256(path) != digest or path.stat().st_size != info["size"]:
            raise ValueError(f"Wheel did not match PyPI metadata: {path.name}")
        ident = "wheel-" + re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")
        shutil.copyfile(path, blobs / (ident + ".blob"))
        return artifact(ident, "wheel", info["url"], digest, info["size"], "runtime/python/Lib/site-packages")

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        artifacts.extend(pool.map(wheel_entry, sorted(wheels.glob("*.whl"))))

    # The release HTML exposes GitHub's SHA-256 asset digest even when the
    # unauthenticated API is rate limited. Require the exact named asset's digest.
    html = fetch(KOKORO_RELEASE).decode("utf-8")
    match = re.search(r'href="[^"]*/kokoro-v1\.0\.onnx"(?P<asset>.*?)(?=<li|$)', html, re.S)
    if not match:
        raise ValueError("Kokoro asset not present in official release HTML")
    match_digest = re.search(r"sha256:([0-9a-f]{64})", match.group("asset"))
    if not match_digest:
        raise ValueError("Kokoro official SHA-256 is unavailable; do not silently trust a mirror")
    digest = match_digest.group(1)
    if requests is not None:
        response = requests.head(KOKORO_URL, allow_redirects=True, timeout=(20, 180))
        response.raise_for_status()
        size = int(response.headers["Content-Length"])
    else:
        with urllib.request.urlopen(urllib.request.Request(KOKORO_URL, method="HEAD"), timeout=180) as response:
            size = int(response.headers["Content-Length"])
    # Optional community mirror: its pinned LFS hash and exact size must match
    # GitHub's published asset digest. Never accept a merely compatible export.
    mirror_metadata = json.loads(fetch(f"https://huggingface.co/api/models/{KOKORO_HF_REPO}/revision/{KOKORO_HF_REVISION}?blobs=true"))
    mirror_file = next(item for item in mirror_metadata["siblings"] if item["rfilename"] == "kokoro-v1.0.onnx")
    if mirror_metadata["sha"] != KOKORO_HF_REVISION or mirror_file.get("lfs", {}).get("sha256") != digest or mirror_file.get("size") != size:
        raise ValueError("Pinned Kokoro community mirror is not byte-identical to the official GitHub asset")
    mirror_url = f"https://huggingface.co/{KOKORO_HF_REPO}/resolve/{KOKORO_HF_REVISION}/kokoro-v1.0.onnx"
    artifacts.append(artifact("model-kokoro-v1-0", "model", KOKORO_URL, digest, size, "runtime/tts/kokoro/kokoro-v1.0.onnx", urls=[KOKORO_URL, mirror_url, mirror_url.replace("https://huggingface.co/", "https://hf-mirror.com/")]))

    repositories = [
        ("onnx-community/Kokoro-82M-v1.0-ONNX", "runtime/tts/kokoro", {"voices/jf_alpha.bin", "voices/af_heart.bin", "voices/af_sky.bin", "README.md"}),
        ("dropbox-dash/faster-whisper-large-v3-turbo", "runtime/asr/large-v3-turbo", {"config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "README.md"}),
        # The base.en repository supplies vocabulary.txt, not vocabulary.json.
        ("Systran/faster-whisper-base.en", "runtime/asr/base.en", {"config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.txt", "README.md"}),
        ("Xenova/multilingual-e5-small", "runtime/rag/models/multilingual-e5-small-int8", {"tokenizer.json", "tokenizer_config.json", "config.json", "onnx/model_int8.onnx", "README.md"}),
    ]
    revisions = {KOKORO_HF_REPO: KOKORO_HF_REVISION}
    for repo, destination, wanted in repositories:
        metadata = json.loads(fetch(f"https://huggingface.co/api/models/{repo}?blobs=true"))
        revision = metadata["sha"]
        revisions[repo] = revision
        files = [item for item in metadata["siblings"] if item["rfilename"] in wanted or item["rfilename"].startswith("LICENSE")]
        for info in files:
            filename = info["rfilename"]
            url = f"https://huggingface.co/{repo}/resolve/{revision}/{urllib.parse.quote(filename)}"
            ident = "model-" + re.sub(r"[^a-z0-9]+", "-", repo.lower() + "-" + filename.lower()).strip("-")
            if info.get("lfs"):
                digest, size = info["lfs"]["sha256"], info["lfs"]["size"]
            else:
                path = blobs / (ident + ".blob")
                if path.exists():
                    content = path.read_bytes()
                    git_hash = hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()
                    if git_hash != info["blobId"]:
                        path.unlink()
                size, digest = download(url, path)
                if size != info["size"]:
                    raise ValueError(f"HF file size mismatch: {repo}/{filename}")
                content = path.read_bytes()
                if hashlib.sha1(b"blob " + str(size).encode("ascii") + b"\0" + content).hexdigest() != info["blobId"]:
                    raise ValueError(f"HF Git blob identity mismatch: {repo}/{filename}")
            artifacts.append(artifact(ident, "model", url, digest, size, destination + "/" + filename, urls=[url, url.replace("https://huggingface.co/", "https://hf-mirror.com/")]))

    if args.download_models:
        for item in artifacts:
            if item["kind"] == "model":
                size, _ = download(item["url"], blobs / (item["id"] + ".blob"), item["sha256"])
                if size != item["size"]:
                    raise ValueError(f"Model size mismatch: {item['id']}")
    output = dict(schemaVersion=1, pythonVersion=PYTHON_VERSION, pythonPth="python313._pth", artifacts=artifacts,
                  provenance=dict(resolvedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), nodeShasums=shasums_url, pythonRelease="https://www.python.org/downloads/release/python-31317/", kokoroRelease=KOKORO_RELEASE, huggingFaceRevisions=revisions))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Resolved {len(artifacts)} artifacts ({sum(a['size'] for a in artifacts):,} download bytes): {args.output}")


if __name__ == "__main__":
    main()
