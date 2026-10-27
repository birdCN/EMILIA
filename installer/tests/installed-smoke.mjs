// Opt-in integration against an installed copy; always uses a new synthetic profile.
// Usage: node installer/tests/installed-smoke.mjs PATH_TO_INSTALL
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Provide an installed Emilia directory.');
assert.equal(JSON.parse(await readFile(path.join(root, '.emilia-install.json'))).product, 'EmiliaEnglishCoach');
const stateFile = path.join(root, 'runtime/launcher.json');
await assert.rejects(access(stateFile), 'Exit this installed copy from its tray before testing.');
const profile = await mkdtemp(path.join(tmpdir(), 'emilia-installed-test-'));
const system = process.env.SystemRoot || process.env.WINDIR;
const env = { ...process.env, PATH: `${system}\System32;${system}`, PYTHONHOME: 'Z:\absent-python', PYTHONPATH: 'Z:\absent-packages', NODE_PATH: 'Z:\absent-node' };
let launcher, browser, lifecycleController, lifecycleReader, ownedInstance, calls = 0;
const waitFor = async fn => {
  let error;
  for (let i = 0; i < 600; i++) { try { const value = await fn(); if (value) return value; } catch (e) { error = e; } await new Promise(r => setTimeout(r, 100)); }
  throw error || Error('Installed app did not become ready.');
};
const sample = (schema, key = '') => {
  if (schema.enum) return schema.enum.includes('ok') ? 'ok' : schema.enum[0];
  if (schema.type === 'object') return Object.fromEntries((schema.required || Object.keys(schema.properties || {})).map(k => [k, sample(schema.properties[k], k)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (['number', 'integer'].includes(schema.type)) return schema.minimum || 0;
  if (key === 'en') return 'A little practice makes speaking feel easier.';
  if (/zh/i.test(key)) return '我们可以慢慢练习。';
  if (key === 'topicSignature') return `fixture-${calls}`;
  return schema.minLength ? 'fixture'.padEnd(schema.minLength, 'x') : '';
};
const provider = createServer(async (req, res) => {
  calls++;
  let input = ''; for await (const chunk of req) input += chunk;
  const body = JSON.parse(input);
  const systemPrompt = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const schemaStart = systemPrompt.lastIndexOf('Schema: ');
  const output = schemaStart >= 0 ? JSON.stringify(sample(JSON.parse(systemPrompt.slice(schemaStart + 8)))) : 'A little practice makes speaking feel easier.';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => provider.listen(0, '127.0.0.1', r));
try {
  launcher = spawn(path.join(root, 'Emilia.exe'), ['--background', '--data-dir', profile], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  const state = await waitFor(async () => JSON.parse(await readFile(stateFile)));
  ownedInstance = state.instanceId;
  const origin = state.url.replace(/\/$/, '');
  const health = await (await fetch(origin + '/api/health')).json();
  assert.equal(health.instanceId, state.instanceId);
  assert.match(await (await fetch(origin)).text(), /id="setupForm"/);
  const headers = { 'Content-Type': 'application/json', 'X-Emilia-Settings': '1' };
  const settings = await (await fetch(origin + '/api/model/settings', { headers })).json();
  assert.equal(settings.hasKey, false); assert.equal(settings.setupRequired, true); assert.equal(calls, 0);
  const payload = { revision: settings.revision, mode: 'api', provider: 'custom', protocol: 'openai', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'synthetic-model', apiKey: 'synthetic-installed-test-key', disableThinking: true };
  if (process.env.EMILIA_PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.EMILIA_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, ...(process.env.EMILIA_BROWSER_EXECUTABLE ? { executablePath: process.env.EMILIA_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const outside = [];
    await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); outside.push(route.request().url()); return route.abort(); });
    await page.goto(origin);
    await page.locator('#provider').selectOption('custom'); await page.locator('#nextStep').click();
    await page.locator('#baseUrl').fill(payload.baseUrl); await page.locator('#model').fill(payload.model); await page.locator('#apiKey').fill(payload.apiKey);
    await page.locator('#saveSettings').click(); await page.locator('#setupDone:not([hidden])').waitFor();
    assert.equal(await page.locator('#apiKey').inputValue(), ''); assert.equal(calls, 0); assert.deepEqual(outside, []);
  } else {
    // API-only QA still holds a real page lease until cleanup, so it exercises
    // the production lifetime policy without ending the app during TTS/ASR.
    lifecycleController = new AbortController();
    const connection = await fetch(origin + '/api/app/connection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emilia-Lifecycle': '1' }, body: '{}', signal: lifecycleController.signal });
    assert.equal(connection.status, 200);
    lifecycleReader = connection.body.getReader();
    assert.equal((await fetch(origin + '/api/model/settings', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 200);
  }
  const saved = await readFile(path.join(profile, 'private/model-settings.json'), 'utf8');
  assert.ok(!saved.includes(payload.apiKey)); assert.ok(JSON.parse(saved).encryptedKey);
  assert.match(await (await fetch(origin)).text(), /class="app-shell"/);
  const voice = await (await fetch(origin + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello Emilia. I would like to practice my English today.' }), signal: AbortSignal.timeout(120000) })).json();
  assert.equal(voice.ok, true, JSON.stringify(voice)); assert.ok(voice.url);
  const audio = Buffer.from(await (await fetch(origin + voice.url)).arrayBuffer());
  assert.equal(audio.subarray(0, 4).toString(), 'RIFF'); assert.ok(audio.length > 10000);
  const asr = await (await fetch(origin + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio, signal: AbortSignal.timeout(120000) })).json();
  assert.equal(asr.ok, true, JSON.stringify(asr)); assert.match(asr.text, /[A-Za-z]/);
  const chat = await (await fetch(origin + '/api/codex/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ text: 'Can we practice English?', mode: 'casual', sessionId: 'installed-fixture', translation: false, sentenceVoice: true, progressiveVoice: true }), signal: AbortSignal.timeout(120000) })).text();
  const events = chat.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(!events.some(e => e.type === 'error'), chat);
  const complete = events.find(e => e.type === 'complete');
  assert.equal(complete?.ok, true, chat); assert.match(complete.reply.en, /practice/i);
  assert.ok(events.some(e => e.type === 'speech'));
  const report = { ok: true, restrictedPath: true, privateRuntimes: true, freshGuide: true, encryptedFakeKey: true, actualTtsBytes: audio.length, actualAsrText: asr.text, mockConversation: true, providerCalls: calls, paidProviderCalls: 0, browser: !!process.env.EMILIA_PLAYWRIGHT_MODULE };
  console.log(JSON.stringify(report));
  if (process.env.EMILIA_SMOKE_REPORT) await writeFile(process.env.EMILIA_SMOKE_REPORT, JSON.stringify(report, null, 2));
} catch (error) {
  console.error('Installed smoke failure:', error);
  throw error;
} finally {
  if (browser) await browser.close();
  lifecycleController?.abort();
  if (lifecycleReader) await lifecycleReader.cancel().catch(() => {});
  if (launcher && launcher.exitCode === null) {
    const key = createHash('sha256').update(root.replace(/\\$/, '').toUpperCase()).digest('hex').toUpperCase();
    const ps = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const stop = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `$event=[Threading.EventWaitHandle]::OpenExisting('Local\\EmiliaEnglishCoach-${key}-Stop');$event.Set()|Out-Null;$event.Dispose()`], { windowsHide: true, env });
    if (stop.status !== 0) console.error('Fixture stop signal:', stop.stderr?.toString());
    for (let i = 0; i < 100 && launcher.exitCode === null; i++) await new Promise(r => setTimeout(r, 100));
    if (launcher.exitCode === null) { launcher.kill(); await waitFor(() => launcher.exitCode !== null); }
  }
  try { if (JSON.parse(await readFile(stateFile)).instanceId === ownedInstance) await rm(stateFile); } catch {}
  await new Promise(r => provider.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
