import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, link, symlink, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('native extractor preserves root boundaries, links and wheel layout', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'emilia-native-extract-'));
  const project = fileURLToPath(new URL('../..', import.meta.url));
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const execute = (file, args) => spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const references = ['System.IO.Compression', 'System.IO.Compression.FileSystem', 'System.Web.Extensions', 'System.Windows.Forms', 'System.Drawing'].map(name => `/r:${name}.dll`);
  try {
    const helper = path.join(root, 'Setup.exe');
    let result = execute(csc, ['/nologo', '/langversion:5', '/target:winexe', `/out:${helper}`, ...references, path.join(project, 'installer/native/Common.cs'), path.join(project, 'installer/native/Setup.cs')]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const makerSource = path.join(root, 'MakeZip.cs');
    await writeFile(makerSource, String.raw`using System;using System.IO;using System.IO.Compression;using System.Web.Script.Serialization;using System.Collections.Generic;
class MakeZip{static void Main(string[] args){var entries=new JavaScriptSerializer().Deserialize<List<Dictionary<string,string>>>(File.ReadAllText(args[0]));using(var zip=ZipFile.Open(args[1],ZipArchiveMode.Create)){foreach(var item in entries){var entry=zip.CreateEntry(item["name"]);using(var writer=new StreamWriter(entry.Open()))writer.Write(item["text"]);}}}}
`);
    const maker = path.join(root, 'MakeZip.exe');
    result = execute(csc, ['/nologo', '/target:exe', `/out:${maker}`, ...references, makerSource]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    let sequence = 0;
    const zip = async entries => {
      const json = path.join(root, `${++sequence}.json`), archive = path.join(root, `${sequence}.zip`);
      await writeFile(json, JSON.stringify(entries));
      assert.equal(execute(maker, [json, archive]).status, 0);
      return archive;
    };
    const dest = path.join(root, 'new install with spaces');
    const normal = await zip([{ name: 'upstream/bin/hello.txt', text: 'hello' }]);
    assert.equal(execute(helper, ['--extract', normal, dest, 'upstream']).status, 0);
    assert.equal(await readFile(path.join(dest, 'bin/hello.txt'), 'utf8'), 'hello');
    const attack = await zip([{ name: '../escaped.txt', text: 'bad' }]);
    assert.notEqual(execute(helper, ['--extract', attack, dest]).status, 0);
    await assert.rejects(access(path.join(root, 'escaped.txt')));
    const duplicate = await zip([{ name: 'same', text: 'a' }, { name: 'SAME', text: 'b' }]);
    assert.notEqual(execute(helper, ['--extract', duplicate, dest]).status, 0);
    const wheel = await zip([{ name: 'pkg/__init__.py', text: 'ok' }, { name: 'pkg.data/purelib/other.py', text: 'data' }, { name: 'pkg.data/data/NOTICE', text: 'notice' }]);
    const python = path.join(root, 'private python');
    assert.equal(execute(helper, ['--extract-wheel', wheel, python]).status, 0);
    assert.equal(await readFile(path.join(python, 'Lib/site-packages/pkg/__init__.py'), 'utf8'), 'ok');
    assert.equal(await readFile(path.join(python, 'Lib/site-packages/other.py'), 'utf8'), 'data');
    assert.equal(await readFile(path.join(python, 'NOTICE'), 'utf8'), 'notice');
    const outside = path.join(root, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(dest, 'redirect'), 'junction');
    const redirected = await zip([{ name: 'redirect/victim.txt', text: 'bad' }]);
    assert.notEqual(execute(helper, ['--extract', redirected, dest]).status, 0);
    await assert.rejects(access(path.join(outside, 'victim.txt')));
    const victim = path.join(outside, 'original.txt'); await writeFile(victim, 'untouched');
    await link(victim, path.join(dest, 'hard.txt'));
    const replacement = await zip([{ name: 'hard.txt', text: 'replacement' }]);
    assert.equal(execute(helper, ['--extract', replacement, dest]).status, 0);
    assert.equal(await readFile(victim, 'utf8'), 'untouched');
    assert.equal(await readFile(path.join(dest, 'hard.txt'), 'utf8'), 'replacement');
    const unrelated = path.join(root, 'unrelated'); await mkdir(unrelated); await writeFile(path.join(unrelated, 'keep.txt'), 'keep');
    assert.notEqual(execute(helper, ['--quiet', '--dir', unrelated, '--no-launch']).status, 0);
    assert.equal(await readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(access(path.join(unrelated, '.emilia-installing.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
