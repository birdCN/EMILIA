import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function relativeParts(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f:<>"|?*]/.test(value) || /^[\\/]/.test(value)) throw new Error('Unsafe relative destination');
  const parts = value.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw new Error('Unsafe relative destination');
  return parts;
}

export function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid download URL'); }
  if (url.username || url.password || url.hash) throw new Error('Download URL contains credentials or fragment');
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Downloads require HTTPS');
  return url;
}

export function validateArtifact(artifact) {
  if (!artifact || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(artifact.id || '') || artifact.id.endsWith('.')) throw new Error('Unsafe artifact identifier');
  relativeParts(`${artifact.id}.blob`);
  if (!['node', 'python', 'wheel', 'model'].includes(artifact.kind)) throw new Error('Unsupported artifact kind');
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 || '')) throw new Error('A SHA-256 checksum is required');
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error('Artifact size must be positive');
  relativeParts(artifact.destination);
  if (artifact.stripPrefix !== undefined) relativeParts(artifact.stripPrefix.replace(/\/$/, ''));
  validateUrl(artifact.url);
  if (artifact.urls !== undefined && (!Array.isArray(artifact.urls) || artifact.urls.length > 8)) throw new Error('Invalid fallback URLs');
  for (const url of artifact.urls || []) validateUrl(url);
  return artifact;
}

export async function rejectLinks(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error('Symbolic link or junction in installation path');
      if (stat.isFile() && stat.nlink > 1) throw new Error('Hard link in installation path');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export async function resolveInside(root, relative) {
  const parts = relativeParts(relative);
  await rejectLinks(root);
  const target = path.resolve(root, ...parts);
  const remainder = path.relative(path.resolve(root), target);
  if (!remainder || remainder.startsWith('..') || path.isAbsolute(remainder)) throw new Error('Destination escapes installation root');
  await rejectLinks(target);
  return target;
}

export async function verifyFile(filename, artifact) {
  await rejectLinks(filename);
  let stat;
  try { stat = await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || stat.size !== artifact.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex').toLowerCase() === artifact.sha256.toLowerCase();
}

function cancelled(signal) { signal?.throwIfAborted(); }

async function request(urlValue, offset, signal, timeoutMs, redirects = 0) {
  cancelled(signal);
  const url = validateUrl(urlValue);
  const response = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, { signal, headers: { 'User-Agent': 'EmiliaEnglishCoach-Setup/1.3.4', 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-` } : {}) } }, resolve);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Download connection timed out')));
    req.once('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.destroy();
    if (redirects >= 8 || !response.headers.location) throw new Error('Too many download redirects');
    const next = validateUrl(new URL(response.headers.location, url).href);
    if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('Insecure download redirect');
    return request(next.href, offset, signal, timeoutMs, redirects + 1);
  }
  return response;
}

export async function downloadArtifact(artifact, { cacheDir, signal, onProgress = () => {}, attempts = 3, retryDelayMs = 500, timeoutMs = 45000 } = {}) {
  validateArtifact(artifact);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('Invalid retry count');
  await rejectLinks(cacheDir);
  await mkdir(cacheDir, { recursive: true });
  const target = await resolveInside(cacheDir, `${artifact.id}.blob`);
  const partial = await resolveInside(cacheDir, `${artifact.id}.blob.part`);
  const report = current => onProgress({ type: 'progress', phase: 'download', message: artifact.id, current, total: artifact.size });
  if (await verifyFile(target, artifact)) { report(artifact.size); return target; }
  await rm(target, { force: true });
  const urls = [...new Set([artifact.url, ...(artifact.urls || [])])];
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    cancelled(signal);
    let response;
    let handle;
    try {
      await rejectLinks(partial);
      let offset = 0;
      try { const stat = await lstat(partial); if (!stat.isFile()) throw new Error('Partial download is not a file'); offset = stat.size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (offset >= artifact.size) {
        if (offset === artifact.size && await verifyFile(partial, artifact)) { await rename(partial, target); report(artifact.size); return target; }
        await rm(partial, { force: true }); offset = 0;
      }
      response = await request(urls[attempt % urls.length], offset, signal, timeoutMs);
      if (![200, 206].includes(response.statusCode)) throw new Error(`Download returned HTTP ${response.statusCode}`);
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('Unexpected download encoding');
      if (response.statusCode === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
        if (!match || Number(match[1]) !== offset || Number(match[2]) !== artifact.size - 1 || Number(match[3]) !== artifact.size) throw new Error('Invalid download Content-Range');
      } else offset = 0;
      const headerLength = response.headers['content-length'];
      if (headerLength !== undefined && (!/^\d+$/.test(headerLength) || Number(headerLength) !== artifact.size - offset)) throw new Error('Download Content-Length differs from manifest size');
      await rejectLinks(partial);
      handle = await open(partial, offset ? 'a' : 'w', 0o600);
      report(offset);
      let received = offset;
      for await (const chunk of response) {
        cancelled(signal);
        if (received + chunk.length > artifact.size) throw new Error('Download exceeds manifest size');
        let written = 0;
        while (written < chunk.length) written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten;
        received += chunk.length;
        report(received);
      }
      await handle.close(); handle = undefined;
      cancelled(signal);
      if (received !== artifact.size) throw new Error('Download length differs from manifest size');
      if (!await verifyFile(partial, artifact)) { await rm(partial, { force: true }); throw new Error('Download checksum mismatch'); }
      await rejectLinks(target);
      await rename(partial, target);
      return target;
    } catch (error) {
      lastError = error;
      if (signal?.aborted || error.name === 'AbortError') throw error;
      // Do not retain data for a semantically invalid response. Network failures can resume.
      if (/range|encoding|size|length|checksum/i.test(error.message)) await rm(partial, { force: true });
    } finally {
      response?.destroy();
      await handle?.close();
    }
    if (attempt + 1 < attempts) await delay(Math.min(retryDelayMs * 2 ** attempt, 5000), undefined, { signal });
  }
  throw new Error(`Unable to download ${artifact.id}: ${lastError?.message || 'unknown failure'}`);
}
