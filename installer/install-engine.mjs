import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { downloadArtifact, rejectLinks, resolveInside, validateArtifact, verifyFile } from './download.mjs';

export function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !/^3\.13\.\d+$/.test(manifest.pythonVersion || '') || manifest.pythonPth !== 'python313._pth' || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw new Error('Unsupported installation manifest');
  const ids = new Set();
  const destinations = new Set();
  for (const artifact of manifest.artifacts) {
    validateArtifact(artifact);
    const id = artifact.id.toLowerCase();
    if (ids.has(id)) throw new Error('Duplicate artifact identifier');
    ids.add(id);
    const destination = artifact.destination.replaceAll('\\', '/').toLowerCase();
    if (artifact.kind !== 'wheel') {
      if (destinations.has(destination)) throw new Error('Duplicate artifact destination');
      destinations.add(destination);
    }
    if (artifact.kind === 'node' && destination !== 'runtime/node') throw new Error('Node must use the private runtime directory');
    if (artifact.kind === 'python' && destination !== 'runtime/python') throw new Error('Python must use the private runtime directory');
    if (artifact.kind === 'wheel' && !['runtime/python', 'runtime/python/lib/site-packages'].includes(destination)) throw new Error('Wheels must use the private Python directory');
  }
  for (const kind of ['node', 'python']) if (manifest.artifacts.filter(artifact => artifact.kind === kind).length !== 1) throw new Error(`Exactly one ${kind} runtime is required`);
  if (!manifest.artifacts.some(artifact => artifact.kind === 'model')) throw new Error('Model artifacts are required');
  return manifest;
}

export function pythonEnvironment(root, inherited = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inherited)) if (!key.toUpperCase().startsWith('PYTHON')) environment[key] = value;
  return { ...environment, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', PIP_NO_INDEX: '1', PHONEMIZER_ESPEAK_LIBRARY: path.join(root, 'runtime/python/Lib/site-packages/espeakng_loader/espeak-ng.dll'), EMILIA_INSTALL_ROOT: root };
}

export function runProcess(executable, args, { signal, cwd, env, label = 'Installation operation', onProgress, diagnosticFile } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { signal?.throwIfAborted(); child = spawn(executable, args, { cwd, env, signal, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
    let pending = '';
    let outputSize = 0;
    let diagnostics = '';
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    // Child output can contain arbitrary data; relay only the expected progress schema.
    child.stdout.on('data', chunk => {
      outputSize += chunk.length;
      if (outputSize > 1024 * 1024) { child.kill(); fail(new Error(`${label} emitted too much output`)); return; }
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress' && typeof event.phase === 'string' && typeof event.message === 'string' && Number.isFinite(event.current) && Number.isFinite(event.total)) onProgress?.({ type: 'progress', phase: event.phase.slice(0, 64), message: event.message.slice(0, 200), current: event.current, total: event.total });
        } catch { /* Ignore library banners and diagnostics. */ }
      }
    });
    child.stderr.on('data', chunk => { if (diagnosticFile && diagnostics.length < 16384) diagnostics += chunk.toString('utf8').slice(0, 16384 - diagnostics.length); });
    child.once('error', error => fail(signal?.aborted ? new Error('Installation cancelled') : new Error(`${label} could not start (${error.code || 'process error'})`)));
    child.once('close', async (code, terminatedBy) => {
      if (settled) return;
      settled = true;
      if (diagnosticFile && diagnostics) {
        const temporary = `${diagnosticFile}.${randomUUID()}.tmp`;
        try {
          await rejectLinks(diagnosticFile);
          await writeFile(temporary, diagnostics, { mode: 0o600, flag: 'wx' });
          await rename(temporary, diagnosticFile);
        } catch { /* Diagnostics never override the operation result. */ }
        finally { await rm(temporary, { force: true }).catch(() => {}); }
      }
      if (signal?.aborted) reject(new Error('Installation cancelled'));
      else if (code !== 0) reject(new Error(`${label} failed (exit ${code ?? terminatedBy ?? 'unknown'})`));
      else resolve();
    });
  });
}

export async function materializeArtifact(root, artifact, cachedFile, extractor, { signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  validateArtifact(artifact);
  const destination = await resolveInside(root, artifact.destination);
  if (!await verifyFile(cachedFile, artifact)) throw new Error(`Cache checksum verification failed for ${artifact.id}`);
  onProgress({ type: 'progress', phase: 'extract', message: artifact.id, current: 0, total: 1 });
  if (artifact.kind === 'model') {
    if (!await verifyFile(destination, artifact)) {
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = await resolveInside(root, `${artifact.destination}.${randomUUID()}.installing`);
      try {
        await copyFile(cachedFile, temporary);
        if (!await verifyFile(temporary, artifact)) throw new Error(`Copied model checksum mismatch: ${artifact.id}`);
        signal?.throwIfAborted();
        await rejectLinks(destination);
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
    }
  } else {
    // The bootstrap's running Node executable is already extracted from the verified cache.
    const runningNode = artifact.kind === 'node' && path.resolve(process.execPath).toLowerCase() === path.join(destination, 'node.exe').toLowerCase();
    if (!runningNode) {
      await rejectLinks(extractor);
      await mkdir(destination, { recursive: true });
      const args = artifact.kind === 'wheel'
        ? ['--extract-wheel', cachedFile, await resolveInside(root, 'runtime/python')]
        : ['--extract', cachedFile, destination, ...(artifact.stripPrefix ? [artifact.stripPrefix] : [])];
      await runProcess(extractor, args, { signal, cwd: root, env: pythonEnvironment(root), label: `Extract ${artifact.id}` });
      await rejectLinks(destination);
    }
  }
  onProgress({ type: 'progress', phase: 'extract', message: artifact.id, current: 1, total: 1 });
}

export async function validateInstalledFiles(root, manifest, { signal, onProgress = () => {} } = {}) {
  const models = manifest.artifacts.filter(artifact => artifact.kind === 'model');
  for (let index = 0; index < models.length; index++) {
    signal?.throwIfAborted();
    const artifact = models[index];
    if (!await verifyFile(await resolveInside(root, artifact.destination), artifact)) throw new Error(`Installed model checksum mismatch: ${artifact.id}`);
    onProgress({ type: 'progress', phase: 'verify-models', message: artifact.id, current: index + 1, total: models.length });
  }
  for (const relative of ['runtime/node/node.exe', 'runtime/python/python.exe']) {
    const executable = await resolveInside(root, relative);
    const stat = await lstat(executable);
    if (!stat.isFile() || stat.size === 0) throw new Error('Installed runtime executable is missing');
  }
}

export async function resetPythonPackages(root) {
  const site = await resolveInside(root, 'runtime/python/Lib/site-packages');
  const inspect = async folder => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(folder, entry.name), stat = await lstat(file);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('Linked file or junction in private package tree');
      if (stat.isDirectory()) await inspect(file);
    }
  };
  await inspect(site);
  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });
}

// This runs only in the downloaded embedded Python, with offline flags and isolated imports.
const PYTHON_VALIDATION = String.raw`
import sys, os, json, pathlib, importlib, ctypes, struct, gc
root = pathlib.Path(sys.argv[1]).resolve()
def progress(message, current, total=16):
    print(json.dumps(dict(type="progress", phase="validate", message=message, current=current, total=total)), flush=True)
def require(condition, message):
    if not condition: raise RuntimeError(message)
require(sys.version_info[:2] == (3, 13), "Python version mismatch")
require(pathlib.Path(sys.prefix).resolve() == root / "runtime" / "python", "Python is not private")
require(not any("site-packages" in item.lower() and not pathlib.Path(item).resolve().is_relative_to(root / "runtime" / "python") for item in sys.path), "External Python packages detected")
modules = ["numpy", "soundfile", "onnxruntime", "kokoro_onnx", "faster_whisper", "tokenizers", "requests", "huggingface_hub", "espeakng_loader", "edge_tts", "ctranslate2", "av"]
for index, name in enumerate(modules):
    progress("Checking Python dependency: " + name, index)
    importlib.import_module(name)
for name in ["kokoro_gpu_runtime", "transcribe_local", "kokoro_local_tts", "rag_embedding_worker", "espeak_paths", "process_owner"]:
    module = importlib.import_module(name)
    require(pathlib.Path(module.__file__).resolve().is_relative_to(root / "tools"), "Application Python module is not private")
progress("Checking native Windows dependencies", 12)
if os.name == "nt":
    ctypes.WinDLL(str(root / "runtime/python/python313.dll"))
    import ssl, sqlite3, numpy, onnxruntime, ctranslate2
    require(ctypes.sizeof(ctypes.c_void_p) == 8, "Windows x64 runtime required")
    native = [pathlib.Path(sys.executable), root / "runtime/python/python313.dll"]
    native.extend((root / "runtime/python/Lib/site-packages").rglob("*.pyd"))
    for binary in native:
        with binary.open("rb") as stream:
            require(stream.read(2) == b"MZ", "Invalid native binary")
            stream.seek(0x3c); position = struct.unpack("<I", stream.read(4))[0]
            stream.seek(position); require(stream.read(4) == b"PE\x00\x00", "Invalid PE binary")
            require(struct.unpack("<H", stream.read(2))[0] == 0x8664, "Non-x64 native dependency")
import numpy as np
import onnxruntime as ort
import io, wave
from faster_whisper.audio import decode_audio
recording = io.BytesIO()
with wave.open(recording, "wb") as stream:
    stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(16000)
    stream.writeframes(np.zeros(16000, dtype=np.int16).tobytes())
recording.seek(0)
require(decode_audio(recording).size == 16000, "WAV decoding is incompatible with ASR")
from tokenizers import Tokenizer
progress("Checking E5 tokenizer and ONNX inference", 13)
rag = root / "runtime/rag/models/multilingual-e5-small-int8"
tokenizer = Tokenizer.from_file(str(rag / "tokenizer.json"))
encoded = tokenizer.encode("query: Hello Emilia")
options = ort.SessionOptions(); options.intra_op_num_threads = 2; options.inter_op_num_threads = 1
session = ort.InferenceSession(str(rag / "onnx/model_int8.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
inputs = {"input_ids": np.array([encoded.ids], dtype=np.int64), "attention_mask": np.array([encoded.attention_mask], dtype=np.int64), "token_type_ids": np.array([encoded.type_ids], dtype=np.int64)}
outputs = session.run(None, {item.name: inputs[item.name] for item in session.get_inputs()})
require(bool(outputs) and outputs[0].size > 0 and np.isfinite(outputs[0]).all(), "Invalid E5 inference result")
del session, outputs; gc.collect()
progress("Checking Kokoro voices and ONNX inference", 14)
tts = root / "runtime/tts/kokoro"
for voice in ["jf_alpha", "af_heart", "af_sky"]:
    voice_data = np.fromfile(str(tts / "voices" / (voice + ".bin")), dtype=np.float32)
    require(voice_data.size >= 4 * 256 and voice_data.size % 256 == 0 and np.isfinite(voice_data).all(), "Invalid Kokoro voice")
import espeakng_loader
ctypes.CDLL(espeakng_loader.get_library_path())
from kokoro_onnx.tokenizer import Tokenizer as KokoroTokenizer
from espeak_paths import espeak_runtime
with espeak_runtime() as espeak_config:
    phonemizer = KokoroTokenizer(espeak_config)
    tokens = phonemizer.tokenize(phonemizer.phonemize("Hello Emilia.", "en-us"))
require(len(tokens) > 0, "Kokoro phonemizer returned no tokens")
style = np.fromfile(str(tts / "voices/af_heart.bin"), dtype=np.float32).reshape(-1, 1, 256)[len(tokens) - 1]
session = ort.InferenceSession(str(tts / "kokoro-v1.0.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
inputs = {"tokens": np.array([[0, *tokens, 0]], dtype=np.int64), "input_ids": np.array([[0, *tokens, 0]], dtype=np.int64), "style": style, "speed": np.array([1.0], dtype=np.float32)}
outputs = session.run(None, {item.name: inputs[item.name] for item in session.get_inputs()})
require(bool(outputs) and outputs[0].size > 0 and np.isfinite(outputs[0]).all(), "Invalid Kokoro inference result")
del session, outputs; gc.collect()
progress("Checking Whisper models and native CPU runtime", 15)
import ctranslate2
from faster_whisper import WhisperModel
for name in ["large-v3-turbo", "base.en"]:
    model = root / "runtime/asr" / name
    require(ctranslate2.contains_model(str(model)), "Invalid Whisper model directory")
    for filename in ["config.json", "tokenizer.json"]:
        with (model / filename).open(encoding="utf-8") as stream: json.load(stream)
    progress("Checking Whisper CPU inference: " + name, 15)
    whisper = WhisperModel(str(model), device="cpu", compute_type="int8", cpu_threads=2, num_workers=1, local_files_only=True)
    segments, info = whisper.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1, vad_filter=False, without_timestamps=True)
    list(segments)
    del whisper; gc.collect()
progress("Private runtime and local models validated", 16)
`;

export async function validateInstallation(root, manifest, { signal, onProgress = () => {} } = {}) {
  validateManifest(manifest);
  await validateInstalledFiles(root, manifest, { signal, onProgress });
  const environment = pythonEnvironment(root);
  await runProcess(await resolveInside(root, 'runtime/node/node.exe'), ['-e', 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'], { cwd: root, env: environment, signal, label: 'Node runtime validation' });
  const diagnosticFile = await resolveInside(root, 'runtime/installation-validation.log');
  await rm(diagnosticFile, { force: true });
  await runProcess(await resolveInside(root, 'runtime/python/python.exe'), ['-I', '-c', PYTHON_VALIDATION, root], { cwd: root, env: environment, signal, onProgress, diagnosticFile, label: 'Python dependency and model validation (runtime/installation-validation.log)' });
}

export async function install({ root, manifestPath, extractor, cacheDir, signal, onProgress = () => {} }) {
  root = path.resolve(root);
  await rejectLinks(root);
  await mkdir(root, { recursive: true });
  await rejectLinks(manifestPath);
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const marker = await resolveInside(root, '.emilia-install.json');
  // Never leave an old success marker during an incomplete repair or upgrade.
  await rm(marker, { force: true });
  cacheDir = cacheDir ? path.resolve(cacheDir) : await resolveInside(root, 'runtime/download-cache');
  await rejectLinks(cacheDir);
  const order = { node: 0, python: 1, wheel: 2, model: 3 };
  const artifacts = [...manifest.artifacts].sort((left, right) => order[left.kind] - order[right.kind]);
  let packagesReset = false;
  for (let index = 0; index < artifacts.length; index++) {
    signal?.throwIfAborted();
    const artifact = artifacts[index];
    const cachedFile = await downloadArtifact(artifact, { cacheDir, signal, onProgress });
    if (artifact.kind === 'wheel' && !packagesReset) {
      // Install a consistent wheel set: upgrades must not retain incompatible modules or old dist-info.
      await resetPythonPackages(root); packagesReset = true;
    }
    await materializeArtifact(root, artifact, cachedFile, extractor, { signal, onProgress });
    onProgress({ type: 'progress', phase: 'install', message: artifact.id, current: index + 1, total: artifacts.length });
  }
  const site = await resolveInside(root, 'runtime/python/Lib/site-packages');
  await mkdir(site, { recursive: true });
  const pth = await resolveInside(root, `runtime/python/${manifest.pythonPth}`);
  const pthTemporary = await resolveInside(root, `runtime/python/${manifest.pythonPth}.${randomUUID()}.tmp`);
  try {
    await writeFile(pthTemporary, 'python313.zip\n.\nLib/site-packages\n../../tools\nimport site\n', { encoding: 'utf8', mode: 0o600 });
    await rejectLinks(pth);
    await rename(pthTemporary, pth);
  } finally { await rm(pthTemporary, { force: true }); }
  await validateInstallation(root, manifest, { signal, onProgress });
  signal?.throwIfAborted();
  const temporary = await resolveInside(root, `.emilia-install.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ product: 'EmiliaEnglishCoach', version: '1.3.4', schemaVersion: 1, installedAt: new Date().toISOString(), pythonVersion: manifest.pythonVersion, artifacts: manifest.artifacts.map(({ id, sha256 }) => ({ id, sha256 })) }, null, 2) + '\n', { mode: 0o600 });
    signal?.throwIfAborted();
    await rejectLinks(marker);
    await rename(temporary, marker);
  } finally { await rm(temporary, { force: true }); }
  onProgress({ type: 'progress', phase: 'complete', message: 'Emilia English Coach is ready', current: 1, total: 1 });
}

async function main() {
  const options = {};
  const names = { '--root': 'root', '--manifest': 'manifestPath', '--extractor': 'extractor', '--cache': 'cacheDir' };
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = names[process.argv[index]];
    if (!key || !process.argv[index + 1] || options[key]) throw new Error('Expected --root ROOT --manifest PATH --extractor EXE [--cache PATH]');
    options[key] = process.argv[index + 1];
  }
  if (!options.root || !options.manifestPath || !options.extractor) throw new Error('Expected --root ROOT --manifest PATH --extractor EXE [--cache PATH]');
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Installation cancelled'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let lastDownload = '', lastDownloadAt = 0;
  const publish = event => {
    if (event.phase === 'download') {
      const now = Date.now();
      if (event.message === lastDownload && event.current !== event.total && now - lastDownloadAt < 250) return;
      lastDownload = event.message; lastDownloadAt = now;
    }
    process.stdout.write(JSON.stringify(event) + '\n');
  };
  try { await install({ ...options, signal: controller.signal, onProgress: publish }); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Only internally constructed messages are written; neither subprocess output nor URLs.
    const message = error.name === 'AbortError' ? 'Installation cancelled' : error.message;
    process.stdout.write(JSON.stringify({ type: 'error', phase: 'install', message }) + '\n');
    process.exitCode = /cancel|abort/i.test(message) ? 130 : 1;
  });
}
