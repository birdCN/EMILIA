import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const project = fileURLToPath(new URL('../..', import.meta.url));
let work, harness;

before(async () => {
  if (!windows) return;
  work = await mkdtemp(path.join(tmpdir(), 'emilia-data-paths-'));
  let source = await readFile(path.join(project, 'installer/native/Launcher.cs'), 'utf8');
  // Keep path selection and actual uninstall file removal intact. Replace only
  // external boundaries so this harness cannot affect real profiles, registry,
  // shortcuts, reboot deletion, or display any application UI.
  const localData = 'Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)';
  assert.equal(source.split(localData).length, 2);
  source = source.replace(localData, 'AuditHarness.LocalApplicationData');
  const registryStart = source.indexOf('            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))');
  const filesStart = source.indexOf('            foreach (string entry in Directory.EnumerateFileSystemEntries(root))', registryStart);
  assert.ok(registryStart >= 0 && filesStart > registryStart, 'uninstall external boundaries must be identifiable');
  source = source.slice(0, registryStart) + source.slice(filesStart);
  const finishStart = source.indexOf('            string self = Assembly.GetExecutingAssembly().Location;', registryStart);
  const finishEnd = source.indexOf('            return 0;', finishStart);
  assert.ok(finishStart > registryStart && finishEnd > finishStart);
  source = source.slice(0, finishStart) + source.slice(finishEnd);
  const launcher = path.join(work, 'Launcher.Safe.cs');
  const entry = path.join(work, 'AuditHarness.cs');
  await writeFile(launcher, source);
  await writeFile(entry, String.raw`
using System;
using System.IO;
using System.Reflection;
using EmiliaInstaller;
public class AuditHarness {
 public static string LocalApplicationData;
 static int Main(string[] args) {
  Console.OutputEncoding = new System.Text.UTF8Encoding(false);
  LocalApplicationData = args[1];
  try {
   if (args[0] == "select") {
    var method = typeof(LauncherProgram).GetMethod("SelectDataRoot", BindingFlags.NonPublic | BindingFlags.Static);
    Console.WriteLine((string)method.Invoke(null, new object[] { args[2], args.Length > 3 ? args[3] : null }));
   } else if (args[0] == "remove") {
    var method = typeof(LauncherProgram).GetMethod("RemoveInstallation", BindingFlags.NonPublic | BindingFlags.Static);
    method.Invoke(null, new object[] { args[2], -1 });
   } else if (args[0] == "validate") Console.WriteLine(Native.ValidateInstallRoot(args[2], true));
   else throw new Exception("Unknown fixture command");
   return 0;
  } catch (Exception error) {
   if (error is TargetInvocationException) error = error.InnerException;
   Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
   return 1;
  }
 }
}
`);
  harness = path.join(work, 'AuditHarness.exe');
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(csc, ['/nologo', '/langversion:5', '/target:exe', '/main:AuditHarness', `/out:${harness}`,
    ...['System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map(name => `/r:${name}.dll`),
    path.join(project, 'installer/native/Common.cs'), launcher, entry], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

after(async () => {
  if (work) {
    assert.equal(path.dirname(path.resolve(work)).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
    await rm(work, { recursive: true, force: true });
  }
});

const nativeTest = (name, fn) => test(name, { skip: !windows }, fn);
async function fixture() { return mkdtemp(path.join(work, 'case-')); }
async function installed(root, portable = false) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, '.emilia-install.json'), JSON.stringify({ product: 'EmiliaEnglishCoach', portable }));
}
function run(mode, localData, root, data) {
  return spawnSync(harness, [mode, localData, root, ...(data === undefined ? [] : [data])], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}

nativeTest('an ancestor data override cannot place learner or private data in disposable install files', async () => {
  const base = await fixture();
  for (const child of ['learner', 'private']) {
    const data = path.join(base, child), root = path.join(data, child);
    await installed(root);
    const result = run('select', base, root, data);
    assert.equal(result.status, 1, `${child} overlap must be rejected before data creation: ${result.stdout} ${result.stderr}`);
    await assert.rejects(access(path.join(data, child === 'learner' ? 'private' : 'learner')));
  }
});

nativeTest('default profile children cannot contain a custom installation directory', async () => {
  const localData = await fixture();
  for (const child of ['learner', 'private']) {
    const root = path.join(localData, 'EmiliaEnglishCoach/UserData', child, 'Emilia');
    await installed(root);
    const result = run('select', localData, root);
    assert.equal(result.status, 1, `default ${child} folder overlaps custom installation: ${result.stdout} ${result.stderr}`);
  }
});

nativeTest('external profiles and the reserved portable user-data subtree remain usable', async () => {
  const base = await fixture(), root = path.join(base, 'app'), external = path.join(base, 'profile');
  await installed(root);
  for (const data of [external, path.join(root, 'user-data') + path.sep]) {
    const result = run('select', base, root, data);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await access(path.join(data, 'learner')); await access(path.join(data, 'private'));
  }
  await installed(root, true);
  const portable = run('select', base, root);
  assert.equal(portable.status, 0, portable.stdout + portable.stderr);
  assert.equal(path.resolve(portable.stdout.trim()), path.join(root, 'user-data'));
});

nativeTest('profile child junctions are rejected before another profile child is created', async () => {
  const base = await fixture();
  for (const child of ['learner', 'private']) {
    const root = path.join(base, child, 'app'), data = path.join(base, child, 'data'), outside = path.join(base, child, 'outside');
    await installed(root); await mkdir(data); await mkdir(outside);
    await symlink(outside, path.join(data, child), 'junction');
    const result = run('select', base, root, data);
    assert.equal(result.status, 1, `junction in ${child} must be rejected: ${result.stdout} ${result.stderr}`);
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(access(path.join(data, child === 'learner' ? 'private' : 'learner')));
    await rm(path.join(data, child));
  }
});

nativeTest('portable uninstall preserves records and product ownership for same-directory reinstall', async () => {
  const base = await fixture(), root = path.join(base, 'app');
  await installed(root, true);
  await mkdir(path.join(root, 'user-data/learner'), { recursive: true });
  await writeFile(path.join(root, 'user-data/learner/synthetic.json'), 'synthetic retained profile');
  await mkdir(path.join(root, 'runtime')); await writeFile(path.join(root, 'runtime/model.bin'), 'synthetic model');
  await writeFile(path.join(root, 'server.mjs'), '// synthetic app');
  const removed = run('remove', base, root);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.equal(await readFile(path.join(root, 'user-data/learner/synthetic.json'), 'utf8'), 'synthetic retained profile');
  await assert.rejects(access(path.join(root, 'runtime')));
  await assert.rejects(access(path.join(root, 'server.mjs')));
  const ready = run('validate', base, root);
  assert.equal(ready.status, 0, `retained product data must allow reinstall: ${ready.stdout} ${ready.stderr}`);
});

nativeTest('uninstall without retained portable data still removes the entire install directory', async () => {
  const base = await fixture(), root = path.join(base, 'app');
  await installed(root);
  await writeFile(path.join(root, 'server.mjs'), '// synthetic app');
  const result = run('remove', base, root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assert.rejects(access(root));
});

nativeTest('unrelated nonempty and unowned data-only folders remain invalid installation roots', async () => {
  const base = await fixture();
  for (const child of ['notes', 'user-data']) {
    const root = path.join(base, child); await mkdir(path.join(root, child), { recursive: true });
    await writeFile(path.join(root, child, 'synthetic.txt'), 'unowned data');
    const result = run('validate', base, root);
    assert.equal(result.status, 1, 'a folder name alone must not establish product ownership');
    assert.equal(await readFile(path.join(root, child, 'synthetic.txt'), 'utf8'), 'unowned data');
  }
});

nativeTest('retained-data markers cannot authorize foreign products or unrelated root contents', async () => {
  const base = await fixture();
  for (const scenario of ['foreign-product', 'missing-data', 'extra-file', 'linked-data']) {
    const root = path.join(base, scenario); await mkdir(root);
    await writeFile(path.join(root, '.emilia-user-data.json'), JSON.stringify({ product: scenario === 'foreign-product' ? 'AnotherProduct' : 'EmiliaEnglishCoach', schemaVersion: 1 }));
    if (scenario !== 'missing-data' && scenario !== 'linked-data') await mkdir(path.join(root, 'user-data'));
    if (scenario === 'extra-file') await writeFile(path.join(root, 'unrelated.txt'), 'must remain untouched');
    if (scenario === 'linked-data') {
      const outside = path.join(base, 'outside'); await mkdir(outside);
      await symlink(outside, path.join(root, 'user-data'), 'junction');
    }
    const result = run('validate', base, root);
    assert.equal(result.status, 1, `${scenario} must not authorize reuse of a nonempty directory`);
    if (scenario === 'extra-file') assert.equal(await readFile(path.join(root, 'unrelated.txt'), 'utf8'), 'must remain untouched');
    if (scenario === 'linked-data') await rm(path.join(root, 'user-data'));
  }
});
