import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateManifest, pythonEnvironment, materializeArtifact, runProcess, validateInstalledFiles, resetPythonPackages } from '../install-engine.mjs';

const data = Buffer.from('verified local model');
const artifact = { id: 'python', kind: 'python', url: 'https://www.python.org/python.zip', destination: 'runtime/python', sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
const manifest = { schemaVersion: 1, pythonVersion: '3.13.12', pythonPth: 'python313._pth', artifacts: [{ ...artifact, id: 'node', kind: 'node', destination: 'runtime/node' }, artifact, { ...artifact, id: 'model', kind: 'model', destination: 'runtime/models/example.bin' }] };
async function directory(t) { const root = await mkdtemp(path.join(tmpdir(), 'emilia-engine-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('manifest rejects duplicate IDs and destinations before installation', () => {
  assert.equal(validateManifest(manifest), manifest);
  for (const changed of [{ artifacts: [...manifest.artifacts, artifact] }, { artifacts: [...manifest.artifacts, { ...artifact, id: 'other' }] }, { pythonVersion: '3.12.5' }, { pythonPth: '../escape' }, { schemaVersion: 2 }, { artifacts: manifest.artifacts.filter(item => item.kind !== 'python') }]) assert.throws(() => validateManifest({ ...manifest, ...changed }));
});
test('Python environment ignores ambient Python paths and user packages', () => {
  const environment = pythonEnvironment('C:\\Emilia', { PATH: 'inherited', PYTHONHOME: 'host', PYTHONPATH: 'secret', PYTHONUSERBASE: 'host', PYTHONSTARTUP: 'host', OTHER: 'keep' });
  assert.equal(environment.PYTHONHOME, undefined);
  assert.equal(environment.PYTHONPATH, undefined);
  assert.equal(environment.PYTHONUSERBASE, undefined);
  assert.equal(environment.PYTHONSTARTUP, undefined);
  assert.equal(environment.PYTHONNOUSERSITE, '1');
  assert.equal(environment.OTHER, 'keep');
});

test('repair removes obsolete private packages without touching models or user files', async t => {
  const root = await directory(t);
  const site = path.join(root, 'runtime/python/Lib/site-packages');
  await mkdir(path.join(site, 'obsolete-19.dist-info'), { recursive: true });
  await writeFile(path.join(site, 'obsolete-19.dist-info/METADATA'), 'stale');
  await mkdir(path.join(root, 'runtime/models'), { recursive: true });
  await writeFile(path.join(root, 'runtime/models/keep'), 'keep');
  await resetPythonPackages(root);
  await assert.rejects(access(path.join(site, 'obsolete-19.dist-info')));
  await access(site);
  assert.equal(await readFile(path.join(root, 'runtime/models/keep'), 'utf8'), 'keep');
});

test('repair refuses a linked package tree before removing any files', async t => {
  const root = await directory(t), site = path.join(root, 'runtime/python/Lib/site-packages'), outside = path.join(root, 'outside');
  await mkdir(site, { recursive: true }); await mkdir(outside);
  await writeFile(path.join(site, 'retain'), 'retained'); await writeFile(path.join(outside, 'victim'), 'safe');
  await symlink(outside, path.join(site, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resetPythonPackages(root), /link|junction/i);
  assert.equal(await readFile(path.join(site, 'retain'), 'utf8'), 'retained');
  assert.equal(await readFile(path.join(outside, 'victim'), 'utf8'), 'safe');
});
test('verified model is installed into its private destination and can be repaired', async t => {
  const root = await directory(t);
  const cache = path.join(root, 'source.blob'); await writeFile(cache, data);
  const model = { ...artifact, kind: 'model', destination: 'runtime/models/example.bin' };
  await materializeArtifact(root, model, cache, 'unused');
  const target = path.join(root, 'runtime/models/example.bin');
  assert.deepEqual(await readFile(target), data);
  await writeFile(target, Buffer.alloc(data.length));
  await materializeArtifact(root, model, cache, 'unused');
  assert.deepEqual(await readFile(target), data);
});
test('corrupt model cache is rejected before writing a destination', async t => {
  const root = await directory(t);
  const cache = path.join(root, 'bad.blob'); await writeFile(cache, Buffer.alloc(data.length));
  const model = { ...artifact, kind: 'model', destination: 'runtime/models/example.bin' };
  await assert.rejects(materializeArtifact(root, model, cache, 'unused'), /checksum|verification/i);
  await assert.rejects(access(path.join(root, model.destination)));
});
test('installation refuses junction destinations', async t => {
  const root = await directory(t); const outside = path.join(root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(root, 'runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  const cache = path.join(root, 'source.blob'); await writeFile(cache, data);
  await assert.rejects(materializeArtifact(root, { ...artifact, kind: 'model', destination: 'runtime/model.bin' }, cache, 'unused'), /link|junction/i);
  await assert.rejects(access(path.join(outside, 'model.bin')));
});
test('native process failures report only safe labels, never child output', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("secret-token"); process.exit(7)'], { label: 'Python check' }), error => error.message.includes('7') && !error.message.includes('secret-token'));
});
test('cancelled child process exits promptly', async () => {
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { signal: controller.signal, label: 'fixture' });
  controller.abort();
  await assert.rejects(promise, /abort|cancel/i);
});
test('final file validation rejects a corrupted installed model', async t => {
  const root = await directory(t);
  await mkdir(path.join(root, 'runtime/node'), { recursive: true });
  await mkdir(path.join(root, 'runtime/python'), { recursive: true });
  await mkdir(path.join(root, 'runtime/models'), { recursive: true });
  await writeFile(path.join(root, 'runtime/node/node.exe'), 'node');
  await writeFile(path.join(root, 'runtime/python/python.exe'), 'python');
  await writeFile(path.join(root, 'runtime/models/example.bin'), Buffer.alloc(data.length));
  await assert.rejects(validateInstalledFiles(root, manifest), /model|checksum/i);
  await assert.rejects(access(path.join(root, '.emilia-install.json')));
});
