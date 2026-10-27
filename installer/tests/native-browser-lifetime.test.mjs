import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const windows = process.platform === 'win32';
const project = fileURLToPath(new URL('../..', import.meta.url));
let work, native, modelWorker;
const active = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout; let error;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch (value) { error = value; } await delay(80); }
  throw error || Error('Isolated native fixture did not reach the expected state');
}
const nativeTest = (name, fn) => test(name, { skip: !windows }, fn);

before(async () => {
  if (!windows) return;
  work = await mkdtemp(path.join(tmpdir(), 'emilia-native-browser-'));
  let source = await readFile(path.join(project, 'installer/native/Launcher.cs'), 'utf8');
  // Exercise the native launcher and its real Job Object. Only browser/UI
  // boundaries are replaced; no tray item, browser window or dialog is shown.
  assert.ok(source.includes('tray.Visible = true;'));
  source = source.replace('tray.Visible = true;', 'tray.Visible = false;');
  source = source.replaceAll('MessageBox.Show(', 'HeadlessBoundary.Dialog(');
  const browser = 'Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });';
  assert.ok(source.includes(browser));
  source = source.replace(browser, 'HeadlessBoundary.BrowserOpened(url);');
  const launcher = path.join(work, 'Launcher.Headless.cs'), entry = path.join(work, 'HeadlessBoundary.cs');
  await writeFile(launcher, source);
  await writeFile(entry, String.raw`
using System;using System.IO;using System.Security.Cryptography;using System.Text;using System.Threading;using System.Windows.Forms;using EmiliaInstaller;
class HeadlessBoundary {
 public static DialogResult Dialog(params object[] args){throw new InvalidOperationException("Unexpected native dialog: "+String.Join(" ",args));}
 public static void BrowserOpened(string url){File.WriteAllText(Environment.GetEnvironmentVariable("EMILIA_FIXTURE_BROWSER_FILE"),url);}
 [STAThread] static int Main(string[] args){
  try {
   if(args.Length==2&&args[0]=="--fixture-stop"){
    string key;using(var hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(args[1]).TrimEnd('\\').ToUpperInvariant()))).Replace("-","");
    using(var stop=EventWaitHandle.OpenExisting("Local\\EmiliaEnglishCoach-"+key+"-Stop"))stop.Set();return 0;
   }
   Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
   return LauncherProgram.Main(args);
  }catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}
 }
}
`);
  native = path.join(work, 'HeadlessLauncher.exe');
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(csc, ['/nologo', '/langversion:5', '/target:exe', '/main:HeadlessBoundary', `/out:${native}`,
    ...['System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map(value => `/r:${value}.dll`),
    path.join(project, 'installer/native/Common.cs'), launcher, entry], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const workerSource = path.join(work, 'MockModelWorker.cs');
  await writeFile(workerSource, String.raw`
using System;using System.Diagnostics;using System.IO;using System.Reflection;using System.Threading;
class MockModelWorker {
 static void Main(string[] args){
  if(args.Length>0&&args[0]=="--worker"){File.WriteAllText("worker-pid.txt",Process.GetCurrentProcess().Id.ToString());Thread.Sleep(Timeout.Infinite);return;}
  File.WriteAllText("intermediate-pid.txt",Process.GetCurrentProcess().Id.ToString());
  Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,"--worker"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=Environment.CurrentDirectory});
 }
}
`);
  modelWorker = path.join(work, 'MockModelWorker.exe');
  const workerCompiled = spawnSync(csc, ['/nologo', '/target:exe', `/out:${modelWorker}`, workerSource], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(workerCompiled.status, 0, workerCompiled.stdout + workerCompiled.stderr);
});

after(async () => {
  for (const fixture of active) await cleanup(fixture);
  if (work) { assert.equal(path.dirname(path.resolve(work)).toLowerCase(), path.resolve(tmpdir()).toLowerCase()); await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

async function launch(background = true) {
  const root = await mkdtemp(path.join(work, 'app-'));
  await mkdir(path.join(root, 'runtime/node'), { recursive: true }); await mkdir(path.join(root, 'runtime/python'));
  await copyFile(process.execPath, path.join(root, 'runtime/node/node.exe'));
  await copyFile(native, path.join(root, 'Emilia.exe'));
  await writeFile(path.join(root, 'runtime/python/python.exe'), 'Synthetic Python marker; never executed');
  await writeFile(path.join(root, '.emilia-install.json'), JSON.stringify({ product: 'EmiliaEnglishCoach', portable: false }));
  await writeFile(path.join(root, 'server.mjs'), `
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
writeFileSync('observed-env.json',JSON.stringify({startupGrace:process.env.EMILIA_BROWSER_STARTUP_GRACE_MS??null}));
spawn(${JSON.stringify(modelWorker)},['--intermediate'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
await import(${JSON.stringify(pathToFileURL(path.join(project, 'server.mjs')).href)});
`);
  const unrelatedRoot = path.join(root, 'unrelated'); await mkdir(unrelatedRoot);
  const unrelated = spawn(modelWorker, ['--worker'], { cwd: unrelatedRoot, windowsHide: true, stdio: 'ignore' });
  const fixture = { root, unrelated, leases: [], launcher: null, worker: null, state: null, stderr: '' }; active.add(fixture);
  const args = [...(background ? ['--background'] : []), '--data-dir', path.join(root, 'user-data')];
  fixture.launcher = spawn(path.join(root, 'Emilia.exe'), args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, EMILIA_BROWSER_STARTUP_GRACE_MS: '30000', EMILIA_FIXTURE_BROWSER_FILE: path.join(root, 'opened-browser.txt') } });
  fixture.launcher.stderr.on('data', chunk => fixture.stderr += chunk);
  fixture.launcher.stdout.resume();
  fixture.state = await until(async () => { if (fixture.launcher.exitCode !== null) throw Error(fixture.stderr); return JSON.parse(await readFile(path.join(root, 'runtime/launcher.json'), 'utf8')); });
  fixture.worker = await until(async () => Number(await readFile(path.join(root, 'worker-pid.txt'), 'utf8')));
  const intermediate = Number(await readFile(path.join(root, 'intermediate-pid.txt'), 'utf8'));
  await until(() => !alive(intermediate));
  assert.equal(alive(fixture.worker), true, 'owned worker must outlive its intermediate parent');
  return fixture;
}

async function cleanup(fixture) {
  for (const lease of fixture.leases) lease.close();
  if (fixture.launcher?.exitCode === null && fixture.launcher.signalCode === null) {
    const stopped = spawnSync(path.join(fixture.root, 'Emilia.exe'), ['--fixture-stop', fixture.root], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    if (stopped.status !== 0) fixture.launcher.kill();
    try { await until(() => fixture.launcher.exitCode !== null || fixture.launcher.signalCode !== null, 6000); } catch { fixture.launcher.kill(); }
  }
  if (fixture.unrelated.exitCode === null && fixture.unrelated.signalCode === null) { fixture.unrelated.kill(); await until(() => fixture.unrelated.exitCode !== null || fixture.unrelated.signalCode !== null); }
  if (fixture.worker && alive(fixture.worker)) { process.kill(fixture.worker); await until(() => !alive(fixture.worker)); }
  active.delete(fixture);
}

function connectPage(fixture) {
  return new Promise((resolve, reject) => {
    let established = false;
    const key = randomBytes(16).toString('base64');
    const request = http.request(new URL('/api/app/connection', fixture.state.url), { method: 'GET', headers: {
      Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
      Origin: new URL(fixture.state.url).origin, 'Sec-Fetch-Site': 'same-origin'
    } });
    request.on('response', response => { response.destroy(); reject(Error(`Page socket returned HTTP ${response.statusCode}`)); });
    request.on('upgrade', (response, socket, head) => {
      const accepted = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (response.statusCode !== 101 || response.headers['sec-websocket-accept'] !== accepted) { socket.destroy(); reject(Error('Invalid page WebSocket handshake')); return; }
      established = true; request.setTimeout(0); socket.setTimeout(0); socket.on('error', () => {});
      let pending = Buffer.alloc(0), closing = false;
      const masked = (opcode, payload) => {
        const mask = randomBytes(4), body = Buffer.from(payload);
        for (let index = 0; index < body.length; index++) body[index] ^= mask[index & 3];
        return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, body]);
      };
      const consume = chunk => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2) {
          const opcode = pending[0] & 15, length = pending[1] & 127;
          if (length > 125 || (pending[1] & 128)) { socket.destroy(); return; }
          if (pending.length < 2 + length) return;
          const payload = pending.subarray(2, 2 + length); pending = pending.subarray(2 + length);
          // Native browser networking answers control pings even when page JS is
          // idle. This headless wire client mirrors those masked pong replies.
          if (opcode === 9 && !closing) socket.write(masked(10, payload));
          else if (opcode === 8) { socket.end(); return; }
        }
      };
      socket.on('data', consume);
      const lease = { close(abrupt = false) {
        if (closing || socket.destroyed) return; closing = true;
        if (abrupt) socket.destroy(); else socket.end(masked(8, Buffer.from([3, 232])));
      } };
      fixture.leases.push(lease); if (head.length) consume(head); resolve(lease);
    });
    request.setTimeout(2000, () => { request.destroy(Error('Page WebSocket handshake timed out')); });
    request.on('error', error => { if (!established) reject(error); });
    request.end();
  });
}

nativeTest('native startup grace overrides inherited values for background and interactive launches', async () => {
  for (const [background, expected] of [[true, '0'], [false, '60000']]) {
    const fixture = await launch(background);
    try {
      const environment = JSON.parse(await readFile(path.join(fixture.root, 'observed-env.json'), 'utf8'));
      assert.equal(environment.startupGrace, expected);
      if (!background) await until(async () => (await readFile(path.join(fixture.root, 'opened-browser.txt'), 'utf8')) === fixture.state.url);
    } finally { await cleanup(fixture); }
  }
});

nativeTest('last page close exits native launcher and its orphan workers while another page or refresh keeps them alive', async () => {
  const fixture = await launch(true);
  try {
    const first = await connectPage(fixture), second = await connectPage(fixture);
    first.close(); await delay(5500);
    assert.equal(fixture.launcher.exitCode, null); assert.equal(alive(fixture.state.pid), true); assert.equal(alive(fixture.worker), true);
    second.close(); await delay(400);
    const replacement = await connectPage(fixture); await delay(5500);
    assert.equal(fixture.launcher.exitCode, null, 'setup-to-main navigation or refresh must cancel last-page shutdown');
    replacement.close(true); // Browser process/window close can drop TCP abruptly.
    await until(() => fixture.launcher.exitCode !== null, 10000);
    assert.equal(fixture.launcher.exitCode, 0, fixture.stderr);
    await until(() => !alive(fixture.state.pid) && !alive(fixture.worker));
    assert.equal(alive(fixture.unrelated.pid), true, 'an unrelated process using the same private Node executable must survive');
    await assert.rejects(access(path.join(fixture.root, 'runtime/launcher.json')));
  } finally { await cleanup(fixture); }
});
