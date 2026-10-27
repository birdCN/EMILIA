import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const windows = process.platform === 'win32';
const project = fileURLToPath(new URL('../..', import.meta.url));
let work, harness;
const nativeTest = (name, fn) => test(name, { skip: !windows }, fn);

before(async () => {
  if (!windows) return;
  work = await mkdtemp(path.join(tmpdir(), 'emilia-native-branding-'));
  let setup = await readFile(path.join(project, 'installer/native/Setup.cs'), 'utf8');
  let launcher = await readFile(path.join(project, 'installer/native/Launcher.cs'), 'utf8');
  // Redirect special folders and registry/UI boundaries in compiled test copies.
  // Production shortcut creation, ownership checks and uninstall deletion remain real.
  const folders = source => source
    .replaceAll('Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)', 'BrandingHarness.Desktop')
    .replaceAll('Environment.GetFolderPath(Environment.SpecialFolder.Programs)', 'BrandingHarness.Programs');
  setup = folders(setup); launcher = folders(launcher);
  const registry = 'using(RegistryKey key=Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EmiliaEnglishCoach"))';
  assert.ok(setup.includes(registry));
  setup = setup.replace(registry, 'using(BrandingHarness.RegistryCapture key=BrandingHarness.CreateRegistryCapture())');
  const registryStart = launcher.indexOf('            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))');
  assert.ok(registryStart >= 0);
  const brace = launcher.indexOf('{', registryStart);
  let depth = 1, end = brace + 1;
  while (depth && end < launcher.length) { if (launcher[end] === '{') depth++; if (launcher[end] === '}') depth--; end++; }
  assert.equal(depth, 0);
  launcher = launcher.slice(0, registryStart) + launcher.slice(end);
  const finishStart = launcher.indexOf('            string self = Assembly.GetExecutingAssembly().Location;', registryStart);
  const finishEnd = launcher.indexOf('            return 0;', finishStart);
  assert.ok(finishStart > registryStart && finishEnd > finishStart);
  launcher = launcher.slice(0, finishStart) + launcher.slice(finishEnd);
  const setupCopy = path.join(work, 'Setup.Fixture.cs'), launcherCopy = path.join(work, 'Launcher.Fixture.cs');
  await writeFile(setupCopy, setup); await writeFile(launcherCopy, launcher);
  const entry = path.join(work, 'BrandingHarness.cs');
  await writeFile(entry, String.raw`
using System;using System.Collections.Generic;using System.IO;using System.Reflection;using System.Threading;using System.Web.Script.Serialization;using Microsoft.Win32;using EmiliaInstaller;
class BrandingHarness {
 public static string Desktop,Programs;
 public sealed class RegistryCapture:IDisposable {
  public readonly Dictionary<string,object> Values=new Dictionary<string,object>();
  public void SetValue(string name,object value){Values[name]=value;}
  public void SetValue(string name,object value,RegistryValueKind kind){Values[name]=value;}
  public void Dispose(){}
 }
 static RegistryCapture captured;
 public static RegistryCapture CreateRegistryCapture(){return captured=new RegistryCapture();}
 static object Invoke(Type type,string method,object instance,object[] args){return type.GetMethod(method,BindingFlags.NonPublic|(instance==null?BindingFlags.Static:BindingFlags.Instance)).Invoke(instance,args);}
 static Dictionary<string,object> ReadLink(string file) {
  Type type=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(type),link=null;
  try {link=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});var result=new Dictionary<string,object>();result["file"]=file;foreach(string name in new[]{"TargetPath","WorkingDirectory","IconLocation"})result[name]=link.GetType().InvokeMember(name,BindingFlags.GetProperty,null,link,null);return result;}
  finally{if(link!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}
 }
 static void MakeLink(string file,string target) {
  Directory.CreateDirectory(Path.GetDirectoryName(file));Type type=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(type),link=null;
  try{link=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});link.GetType().InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});link.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);}
  finally{if(link!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}
 }
 static int Main(string[] args) {
  Console.OutputEncoding=new System.Text.UTF8Encoding(false);string root=args[1];Desktop=args[2];Programs=args[3];
  try{
   object result=null;
   if(args[0]=="seed"){var links=new JavaScriptSerializer().Deserialize<List<Dictionary<string,string>>>(File.ReadAllText(args[4]));foreach(var link in links)MakeLink(link["file"],link["target"]);}
   else if(args[0]=="read"){var links=new List<Dictionary<string,object>>();foreach(string folder in new[]{Desktop,Programs})if(Directory.Exists(folder))foreach(string file in Directory.GetFiles(folder,"*.lnk",SearchOption.AllDirectories))links.Add(ReadLink(file));result=links;}
   else if(args[0]=="remove")Invoke(typeof(LauncherProgram),"RemoveInstallation",null,new object[]{root,-1});
   else {var installation=new Installation(new SetupOptions(),delegate(string message,int percent){},CancellationToken.None);typeof(Installation).GetField("root",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(installation,root);if(args[0]=="create")Invoke(typeof(Installation),"CreateShortcuts",installation,new object[0]);else if(args[0]=="registry"){Invoke(typeof(Installation),"RegisterUninstall",installation,new object[0]);result=captured.Values;}else throw new Exception("Unknown mode");}
   Console.WriteLine(new JavaScriptSerializer().Serialize(result));return 0;
  }catch(Exception error){if(error is TargetInvocationException)error=error.InnerException;Console.Error.WriteLine(error.GetType().Name+": "+error.Message);return 1;}
 }
}
`);
  harness = path.join(work, 'BrandingHarness.exe');
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(csc, ['/nologo', '/langversion:5', '/target:exe', '/main:BrandingHarness', `/out:${harness}`,
    ...['System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map(name => `/r:${name}.dll`),
    path.join(project, 'installer/native/Common.cs'), setupCopy, launcherCopy, entry], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(async () => { if (work) { assert.equal(path.dirname(path.resolve(work)).toLowerCase(), path.resolve(tmpdir()).toLowerCase()); await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });

async function fixture() {
  const base = await mkdtemp(path.join(work, 'case-'));
  const value = { root: path.join(base, 'app'), desktop: path.join(base, 'Desktop'), programs: path.join(base, 'Programs') };
  await Promise.all(Object.values(value).map(folder => mkdir(folder)));
  await writeFile(path.join(value.root, '.emilia-install.json'), JSON.stringify({ product: 'EmiliaEnglishCoach' }));
  await writeFile(path.join(value.root, 'Emilia.exe'), 'synthetic link target; never executed');
  return value;
}
function run(mode, fixture, extra) {
  return spawnSync(harness, [mode, fixture.root, fixture.desktop, fixture.programs, ...(extra ? [extra] : [])], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
}
async function seed(fixture, items) {
  const file = path.join(path.dirname(fixture.root), 'links.json'); await writeFile(file, JSON.stringify(items));
  const result = run('seed', fixture, file); assert.equal(result.status, 0, result.stderr);
}
function links(fixture) { const result = run('read', fixture); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
const owned = fixture => path.join(fixture.root, 'Emilia.exe');
const legacy = 'Emilia English Coach';

nativeTest('installation creates EMILIA desktop/menu links with explicit application icons and migrates owned legacy links', async () => {
  const value = await fixture();
  const oldDesktop = path.join(value.desktop, `${legacy}.lnk`), oldMenu = path.join(value.programs, legacy, `${legacy}.lnk`);
  await seed(value, [{ file: oldDesktop, target: owned(value) }, { file: oldMenu, target: owned(value) }]);
  const result = run('create', value); assert.equal(result.status, 0, result.stderr);
  const created = links(value);
  assert.deepEqual(created.map(item => item.file).sort(), [path.join(value.desktop, 'EMILIA.lnk'), path.join(value.programs, 'EMILIA/EMILIA.lnk')].sort());
  for (const link of created) { assert.equal(link.TargetPath, owned(value)); assert.equal(link.WorkingDirectory, value.root); assert.equal(link.IconLocation, `${path.join(value.root, 'public/assets/branding/emilia.ico')},0`); }
  await assert.rejects(access(path.join(value.programs, legacy)));
});

nativeTest('shortcut migration preserves foreign legacy links and nonempty legacy menu folders', async () => {
  const value = await fixture();
  const foreign = path.join(path.dirname(value.root), 'another-app.exe');
  const oldDesktop = path.join(value.desktop, `${legacy}.lnk`), oldMenu = path.join(value.programs, legacy, `${legacy}.lnk`), notes = path.join(value.programs, legacy, 'Notes.lnk');
  await seed(value, [{ file: oldDesktop, target: foreign }, { file: oldMenu, target: owned(value) }, { file: notes, target: foreign }]);
  const result = run('create', value); assert.equal(result.status, 0, result.stderr);
  const remaining = links(value);
  assert.equal(remaining.find(item => item.file === oldDesktop).TargetPath, foreign);
  assert.equal(remaining.find(item => item.file === notes).TargetPath, foreign);
  assert.equal(remaining.some(item => item.file === oldMenu), false);
});

nativeTest('a foreign EMILIA name collision is rejected before existing owned shortcuts are migrated', async () => {
  const value = await fixture(), foreign = path.join(path.dirname(value.root), 'another-app.exe');
  const oldDesktop = path.join(value.desktop, `${legacy}.lnk`), collision = path.join(value.programs, 'EMILIA/EMILIA.lnk');
  await seed(value, [{ file: oldDesktop, target: owned(value) }, { file: collision, target: foreign }]);
  const result = run('create', value); assert.equal(result.status, 1, result.stdout + result.stderr);
  const remaining = links(value);
  assert.equal(remaining.length, 2);
  assert.equal(remaining.find(item => item.file === collision).TargetPath, foreign);
  assert.equal(remaining.find(item => item.file === oldDesktop).TargetPath, owned(value));
});

nativeTest('uninstall removes owned current and legacy links while preserving foreign links', async () => {
  const value = await fixture(), foreign = path.join(path.dirname(value.root), 'another-app.exe');
  const notes = path.join(value.programs, legacy, 'Notes.lnk');
  await seed(value, [
    { file: path.join(value.desktop, 'EMILIA.lnk'), target: owned(value) }, { file: path.join(value.desktop, `${legacy}.lnk`), target: owned(value) },
    { file: path.join(value.programs, 'EMILIA/EMILIA.lnk'), target: owned(value) }, { file: path.join(value.programs, legacy, `${legacy}.lnk`), target: owned(value) },
    { file: notes, target: foreign }
  ]);
  const result = run('remove', value); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(links(value).map(item => ({ file: item.file, target: item.TargetPath })), [{ file: notes, target: foreign }]);
  await assert.rejects(access(path.join(value.programs, 'EMILIA')));
});

nativeTest('Apps metadata uses EMILIA while retaining the existing install target', async () => {
  const value = await fixture(), result = run('registry', value); assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.DisplayName, 'EMILIA');
  assert.equal(metadata.InstallLocation, value.root);
  assert.equal(metadata.DisplayIcon, owned(value));
  assert.equal(metadata.UninstallString, `"${owned(value)}" --uninstall`);
});

nativeTest('uninstall preserves unrelated current and legacy names in all shortcut locations', async () => {
  const value = await fixture(), foreign = path.join(path.dirname(value.root), 'another-app.exe');
  const items = [
    path.join(value.desktop, 'EMILIA.lnk'), path.join(value.desktop, `${legacy}.lnk`),
    path.join(value.programs, 'EMILIA/EMILIA.lnk'), path.join(value.programs, legacy, `${legacy}.lnk`)
  ].map(file => ({ file, target: foreign }));
  await seed(value, items);
  const result = run('remove', value); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(links(value).map(item => ({ file: item.file, target: item.TargetPath })).sort((a, b) => a.file.localeCompare(b.file)), items.sort((a, b) => a.file.localeCompare(b.file)));
});

function iconImages(ico) {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16, size = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    return ico.subarray(offset, offset + size);
  });
}
function peIconImages(pe) {
  const header = pe.readUInt32LE(0x3c), optional = header + 24, sections = optional + pe.readUInt16LE(header + 20);
  const sectionCount = pe.readUInt16LE(header + 6), directory = optional + (pe.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const rvaToOffset = rva => {
    for (let index = 0; index < sectionCount; index++) {
      const section = sections + index * 40, address = pe.readUInt32LE(section + 12), size = Math.max(pe.readUInt32LE(section + 8), pe.readUInt32LE(section + 16));
      if (rva >= address && rva < address + size) return pe.readUInt32LE(section + 20) + rva - address;
    }
    throw new Error('PE resource RVA outside sections');
  };
  const resourceRva = pe.readUInt32LE(directory + 16);
  if (!resourceRva) return [];
  const base = rvaToOffset(resourceRva), images = [];
  function walk(offset, type) {
    const directory = base + offset, count = pe.readUInt16LE(directory + 12) + pe.readUInt16LE(directory + 14);
    for (let index = 0; index < count; index++) {
      const entry = directory + 16 + index * 8, id = pe.readUInt32LE(entry), target = pe.readUInt32LE(entry + 4), resourceType = type ?? id;
      if (resourceType !== 3) continue;
      if (target & 0x80000000) walk(target & 0x7fffffff, resourceType);
      else { const data = base + target, start = rvaToOffset(pe.readUInt32LE(data)); images.push(pe.subarray(start, start + pe.readUInt32LE(data + 4))); }
    }
  }
  walk(0); return images;
}

nativeTest('the real build embeds every supplied icon frame in both native executables', async () => {
  const output = path.join(work, 'build-output'), build = path.join(work, 'build-work');
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'installer/build.ps1'), '-OutputDirectory', output, '-BuildDirectory', build], { env: environment, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const installer = (await readdir(output)).find(name => /^EMILIA-.*-Setup-x64\.exe$/.test(name));
  assert.ok(installer, 'installer filename must carry the visible application name');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const expected = iconImages(await readFile(path.join(project, 'public/assets/branding/emilia.ico'))).map(hash);
  for (const file of [path.join(output, installer), path.join(build, 'Emilia.exe')]) {
    const actual = new Set(peIconImages(await readFile(file)).map(hash));
    for (const frame of expected) assert.ok(actual.has(frame), `compiled application icon frame missing in ${file}`);
  }
});
