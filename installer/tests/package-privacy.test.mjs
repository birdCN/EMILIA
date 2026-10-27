import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../..', import.meta.url));
const privateFixtures = [
  'private/model-settings.json', 'tools/private/synthetic-settings.json',
  'public/assets/voice/recording.wav', 'public/assets/voice/answer.mp3', 'public/assets/voice/cache-index.json',
  'recording.wav', 'recording.mp3', 'learning.sqlite', 'learning.sqlite-wal', 'learning.sqlite-shm',
  'archive.db', 'archive.db-journal', 'account.key', 'account.pem', 'account.pfx', 'account.p12',
  '.env', '.env.local', 'runtime/synthetic.json', 'user-data/profile.json', 'work/synthetic.json',
  '.cache/synthetic.json', 'tools/__pycache__/synthetic.pyc', '.emilia-install.json', '.emilia-user-data.json'
];
const avatars = [
  'public/assets/emilia-performance-v4.runtime.html', 'public/assets/emilia-performance-v4.js', 'public/assets/emilia-face-library.js',
  'public/assets/room/emilia-bedroom-v1.webp',
  ...['neutral-v3', 'neutral-ear-v22', 'neutral-clean-v4', 'encourage-v3', 'empathy-v3', 'delighted-v3', 'curious-v3', 'celebrate-v3', 'blink-v3'].map(name => `public/assets/avatar-v3/${name}.png`)
];

test('the real installer payload excludes synthetic private checkout data while preserving public runtime assets', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'emilia-package-privacy-'));
  try {
    const source = path.join(fixture, 'source'), build = path.join(fixture, 'build'), output = path.join(fixture, 'output');
    // Copy release source only. Never copy real checkout caches/private data into
    // this test: every deliberately private input below is synthetic text.
    const excludedDirectories = new Set(['runtime', 'work', 'dist', 'node_modules', '.venv', '.git', 'user-data', 'private', '__pycache__', '.cache']);
    await cp(project, source, { recursive: true, filter: async file => {
      const relative = path.relative(project, file).replaceAll('\\', '/');
      if (!relative) return true;
      if (relative.split('/').some(part => excludedDirectories.has(part))) return false;
      if (relative.startsWith('public/assets/voice/')) return false;
      const name = path.basename(file);
      if (name.startsWith('.env') && name !== '.env.example') return false;
      if (/\.(?:wav|mp3|sqlite[^/]*|db(?:[-.].*)?|key|pem|pfx|p12|exe|zip|blob|part|log|py[cod])$/i.test(name)) return false;
      return !(await lstat(file)).isSymbolicLink();
    } });
    for (const relative of privateFixtures) {
      const target = path.join(source, relative); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'SYNTHETIC PRIVATE PACKAGE-EXCLUSION FIXTURE; no credentials, recordings or key material.');
    }
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'psmodulepath') delete environment[key];
    const built = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(source, 'installer/build.ps1'), '-OutputDirectory', output, '-BuildDirectory', build], { env: environment, windowsHide: true, encoding: 'utf8', timeout: 90000 });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const setup = (await readdir(output)).find(name => /^EMILIA-.*-Setup-x64\.exe$/.test(name));
    assert.ok(setup, 'the real build must produce the native installer');
    const inspectorSource = path.join(fixture, 'ReadPayload.cs'), inspector = path.join(fixture, 'ReadPayload.exe');
    await writeFile(inspectorSource, String.raw`
using System;using System.Collections.Generic;using System.IO;using System.IO.Compression;using System.Reflection;using System.Web.Script.Serialization;
class ReadPayload {
 static void Main(string[] args) {
  var assembly=Assembly.LoadFile(Path.GetFullPath(args[0]));
  using(Stream stream=assembly.GetManifestResourceStream("app.zip")) {
   if(stream==null)throw new Exception("Missing application payload");
   using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
    var entries=new List<string>();foreach(var entry in zip.Entries)entries.Add(entry.FullName);
    Console.WriteLine(new JavaScriptSerializer().Serialize(entries));
   }
  }
 }
}
`);
    const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compiled = spawnSync(csc, ['/nologo', '/target:exe', '/r:System.IO.Compression.dll', '/r:System.Web.Extensions.dll', `/out:${inspector}`, inspectorSource], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const inspected = spawnSync(inspector, [path.join(output, setup)], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
    const entries = new Set(JSON.parse(inspected.stdout));
    const leaked = privateFixtures.filter(file => entries.has(file));
    assert.deepEqual(leaked, [], `private fixture paths embedded in app.zip: ${leaked.join(', ')}`);
    assert.equal([...entries].some(file => /(^|\/)(?:private|\.cache)\//i.test(file) || file.startsWith('public/assets/voice/')), false);
    const required = ['.env.example', 'package.json', 'package-lock.json', 'server.mjs', 'installer/artifacts.json',
      'tools/process_owner.py', 'tools/asr_turbo_service.py', 'tools/espeak_paths.py', 'public/index.html', 'public/setup.html',
      'public/app-lifecycle.js', 'public/assets/branding/emilia.ico', 'public/assets/branding/emilia-icon.png', 'Emilia.exe', ...avatars];
    for (const file of required) assert.ok(entries.has(file), `required public code or asset missing: ${file}`);
    assert.equal(avatars.length, 13);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
    await rm(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
