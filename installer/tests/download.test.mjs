import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, link, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadArtifact, resolveInside, validateArtifact } from '../download.mjs';

const payload = Buffer.from('An independently verified fixture download.');
const digest = createHash('sha256').update(payload).digest('hex');
async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(tmpdir(), 'emilia-download-'));
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { directory, artifact: { id: 'fixture', kind: 'model', destination: 'runtime/model.bin', url: `http://127.0.0.1:${server.address().port}/fixture`, sha256: digest, size: payload.length } };
}
function good(_request, response) { response.writeHead(200, { 'Content-Length': payload.length }); response.end(payload); }

test('verified download is cached and a second call performs no request', async t => {
  let requests = 0;
  const { directory, artifact } = await fixture(t, (request, response) => { requests++; good(request, response); });
  const events = [];
  const target = await downloadArtifact(artifact, { cacheDir: directory, onProgress: event => events.push(event) });
  assert.deepEqual(await readFile(target), payload);
  assert.equal(target, path.join(directory, 'fixture.blob'));
  await downloadArtifact(artifact, { cacheDir: directory });
  assert.equal(requests, 1);
  assert.ok(events.some(event => event.current === payload.length && event.total === payload.length));
});
test('transient HTTP failure is retried with bounded attempts', async t => {
  let requests = 0;
  const { directory, artifact } = await fixture(t, (request, response) => { if (++requests === 1) { response.writeHead(503); response.end(); } else good(request, response); });
  assert.deepEqual(await readFile(await downloadArtifact(artifact, { cacheDir: directory, retryDelayMs: 1 })), payload);
  assert.equal(requests, 2);
});

test('an unavailable primary uses a fallback with the same pinned bytes', async t => {
  const requests=[];
  const {directory,artifact}=await fixture(t,(request,response)=>{
    requests.push(request.url);
    if(request.url==='/fixture'){response.writeHead(503);response.end();}
    else good(request,response);
  });
  artifact.urls=[artifact.url.replace('/fixture','/mirror')];
  assert.deepEqual(await readFile(await downloadArtifact(artifact,{cacheDir:directory,attempts:2,retryDelayMs:1})),payload);
  assert.deepEqual(requests,['/fixture','/mirror']);
});

test('fallback bytes with the wrong hash are never accepted as a cached artifact', async t => {
  const {directory,artifact}=await fixture(t,(request,response)=>{
    if(request.url==='/fixture'){response.writeHead(503);response.end();}
    else response.end(Buffer.alloc(payload.length));
  });
  artifact.urls=[artifact.url.replace('/fixture','/mirror')];
  await assert.rejects(downloadArtifact(artifact,{cacheDir:directory,attempts:2,retryDelayMs:1}),/checksum/i);
  await assert.rejects(access(path.join(directory,'fixture.blob')));
  await assert.rejects(access(path.join(directory,'fixture.blob.part')));
});
test('partial download resumes only with matching Content-Range', async t => {
  let range;
  const { directory, artifact } = await fixture(t, (request, response) => {
    range = request.headers.range;
    response.writeHead(206, { 'Content-Length': payload.length - 8, 'Content-Range': `bytes 8-${payload.length - 1}/${payload.length}` }); response.end(payload.subarray(8));
  });
  await writeFile(path.join(directory, 'fixture.blob.part'), payload.subarray(0, 8));
  assert.deepEqual(await readFile(await downloadArtifact(artifact, { cacheDir: directory })), payload);
  assert.equal(range, 'bytes=8-');
});
test('server ignoring Range restarts the partial instead of appending', async t => {
  const { directory, artifact } = await fixture(t, good);
  await writeFile(path.join(directory, 'fixture.blob.part'), payload.subarray(0, 8));
  assert.deepEqual(await readFile(await downloadArtifact(artifact, { cacheDir: directory })), payload);
});
test('bad Content-Range is rejected and never promoted to cache', async t => {
  const { directory, artifact } = await fixture(t, (_request, response) => { response.writeHead(206, { 'Content-Range': `bytes 0-${payload.length - 1}/${payload.length}`, 'Content-Length': payload.length }); response.end(payload); });
  await writeFile(path.join(directory, 'fixture.blob.part'), payload.subarray(0, 8));
  await assert.rejects(downloadArtifact(artifact, { cacheDir: directory, attempts: 1 }), /range/i);
  await assert.rejects(access(path.join(directory, 'fixture.blob')));
});
test('corrupted existing cache is discarded and downloaded again', async t => {
  const { directory, artifact } = await fixture(t, good);
  await writeFile(path.join(directory, 'fixture.blob'), Buffer.alloc(payload.length));
  assert.deepEqual(await readFile(await downloadArtifact(artifact, { cacheDir: directory })), payload);
});
test('checksum failures exhaust retries without retaining corrupt files', async t => {
  let requests = 0;
  const { directory, artifact } = await fixture(t, (_request, response) => { requests++; response.end(Buffer.alloc(payload.length)); });
  await assert.rejects(downloadArtifact(artifact, { cacheDir: directory, attempts: 2, retryDelayMs: 1 }), /checksum/i);
  assert.equal(requests, 2);
  await assert.rejects(access(path.join(directory, 'fixture.blob')));
  await assert.rejects(access(path.join(directory, 'fixture.blob.part')));
});
test('oversized downloads are rejected before promotion', async t => {
  const { directory, artifact } = await fixture(t, (_request, response) => response.end(Buffer.concat([payload, payload])));
  await assert.rejects(downloadArtifact(artifact, { cacheDir: directory, attempts: 1 }), /size|length/i);
  await assert.rejects(access(path.join(directory, 'fixture.blob')));
});
test('cancelled transfer preserves partial bytes for the next attempt', async t => {
  const { directory, artifact } = await fixture(t, (_request, response) => { response.writeHead(200, { 'Content-Length': payload.length }); response.write(payload.subarray(0, 8)); });
  const controller = new AbortController();
  await assert.rejects(downloadArtifact(artifact, { cacheDir: directory, signal: controller.signal, onProgress: event => { if (event.current >= 8) controller.abort(); } }), /abort|cancel/i);
  assert.deepEqual(await readFile(path.join(directory, 'fixture.blob.part')), payload.subarray(0, 8));
});
test('manifest artifacts reject unsafe identifiers, URLs, and missing hashes', () => {
  const base = { id: 'safe', kind: 'model', destination: 'runtime/a.bin', url: 'https://example.org/a', sha256: digest, size: 42 };
  for (const changed of [{ id: '../bad' }, { id: 'con' }, { url: 'http://example.org/a' }, { url: 'https://secret@example.org/a' }, { sha256: '' }, { size: -1 }, { destination: '../outside' }, { destination: 'C:\\outside' }, { destination: 'runtime/a:stream' }, { destination: 'runtime/a?b' }, { destination: 'runtime/CONIN$' }]) assert.throws(() => validateArtifact({ ...base, ...changed }));
});
test('resolved destinations reject Windows and POSIX traversal', async t => {
  const { directory } = await fixture(t, good);
  for (const unsafe of ['../outside', '..\\outside', '/outside', 'C:\\outside', '\\\\host\\share', 'runtime/../../outside', 'runtime/NUL', 'runtime/file.']) await assert.rejects(resolveInside(directory, unsafe));
  assert.equal(await resolveInside(directory, 'runtime/model.bin'), path.join(directory, 'runtime', 'model.bin'));
});
test('symlink or junction ancestors cannot redirect installed files', async t => {
  const { directory } = await fixture(t, good);
  const outside = path.join(directory, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(directory, 'runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveInside(directory, 'runtime/model.bin'), /link|junction/i);
});
test('hard-linked partial downloads cannot overwrite another file', async t => {
  const { directory, artifact } = await fixture(t, good);
  const original = path.join(directory, 'outside.txt'); await writeFile(original, 'untouched');
  await link(original, path.join(directory, 'fixture.blob.part'));
  await assert.rejects(downloadArtifact(artifact, { cacheDir: directory, attempts: 1 }), /link/i);
  assert.equal(await readFile(original, 'utf8'), 'untouched');
});
