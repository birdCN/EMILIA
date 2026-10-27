import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const project = fileURLToPath(new URL('../..', import.meta.url));
const bytes = Buffer.from('verified private bootstrap bytes');
const slowBytes = Buffer.alloc(32, 65);
const steadyBytes = Buffer.alloc(16 * 1024, 66);
let work, exe, server, proxy, certificate, endpoint, proxyEndpoint, proxyMode = 'tunnel', proxyConnections = 0;
const sockets = new Set();
const intervals = new Set();
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

before(async () => {
  if (!windows) return;
  work = await mkdtemp(path.join(tmpdir(), 'emilia-bootstrap-network-'));
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const generator = path.join(work, 'CertificateFixture.cs');
  await writeFile(generator, String.raw`
using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
class CertificateFixture {
 static void Main(string[] args) {
  using (RSA key = new RSACng(2048)) {
   var request = new CertificateRequest("CN=bootstrap.invalid",key,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
   var names = new SubjectAlternativeNameBuilder(); names.AddDnsName("bootstrap.invalid"); names.AddIpAddress(IPAddress.Loopback);
   request.CertificateExtensions.Add(names.Build());
   using (var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1),DateTimeOffset.UtcNow.AddHours(1))) {
    File.WriteAllBytes(Path.Combine(args[0],"cert.pfx"),cert.Export(X509ContentType.Pfx,"temporary-bootstrap-fixture"));
    File.WriteAllBytes(Path.Combine(args[0],"cert.der"),cert.Export(X509ContentType.Cert));
   }
  }
 }
}
`);
  const generatorExe = path.join(work, 'CertificateFixture.exe');
  const compiledGenerator = spawnSync(csc, ['/nologo', '/target:exe', '/r:System.Security.dll', `/out:${generatorExe}`, generator], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(compiledGenerator.status, 0, compiledGenerator.stdout + compiledGenerator.stderr);
  const generated = spawnSync(generatorExe, [work], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  certificate = path.join(work, 'cert.der');
  server = https.createServer({ pfx: await readFile(path.join(work, 'cert.pfx')), passphrase: 'temporary-bootstrap-fixture' }, (req, res) => {
    req.on('error', () => {}); res.on('error', () => {});
    if (req.url === '/stall-headers') return;
    const body = req.url === '/trickle' ? slowBytes : req.url === '/steady-large' ? steadyBytes : req.url === '/wrong-hash' ? Buffer.alloc(bytes.length) : bytes;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, Connection: 'close' });
    if (req.url === '/stall-body') { res.flushHeaders(); return; }
    if (req.url === '/trickle' || req.url === '/steady-large') {
      let index = 0;
      const chunkSize = req.url === '/steady-large' ? 2048 : 1;
      const timer = setInterval(() => { if (index < body.length) { const end = Math.min(index + chunkSize, body.length); res.write(body.subarray(index, end)); index = end; } else { clearInterval(timer); intervals.delete(timer); res.end(); } }, req.url === '/steady-large' ? 50 : 80);
      intervals.add(timer);
      res.on('close', () => { clearInterval(timer); intervals.delete(timer); });
    } else res.end(body);
  });
  server.on('tlsClientError', () => {});
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  await listen(server); endpoint = `https://127.0.0.1:${server.address().port}`;
  proxy = http.createServer();
  proxy.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (req, client, head) => {
    proxyConnections++;
    if (proxyMode === 'reject') { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
    if (proxyMode === 'stall') return;
    const upstream = net.connect(server.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  });
  await listen(proxy); proxyEndpoint = `http://127.0.0.1:${proxy.address().port}`;
  const harness = path.join(work, 'BootstrapHarness.cs');
  await writeFile(harness, String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using EmiliaInstaller;
class BootstrapHarness {
 static int Main(string[] args) {
  Console.OutputEncoding = new System.Text.UTF8Encoding(false);
  ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
  string expectedCertificate = Convert.ToBase64String(File.ReadAllBytes(args[0]));
  // Only this isolated test process trusts its generated certificate. Production
  // Setup.cs uses ordinary Windows certificate validation without modification.
  ServicePointManager.ServerCertificateValidationCallback = delegate(object sender,System.Security.Cryptography.X509Certificates.X509Certificate cert,System.Security.Cryptography.X509Certificates.X509Chain chain,System.Net.Security.SslPolicyErrors errors) {
   return Convert.ToBase64String(cert.GetRawCertData()) == expectedCertificate;
  };
  var configuredProxy = new WebProxy(args[1]);
  WebRequest.DefaultWebProxy = configuredProxy;
  var routes = new List<bool>();
  Func<Uri,bool,HttpWebRequest> factory = delegate(Uri uri,bool direct) {
   routes.Add(direct);
   Uri destination = direct ? new Uri(args[2] + uri.AbsolutePath) : uri;
   var request = (HttpWebRequest)WebRequest.Create(destination);
   request.Proxy = direct ? null : configuredProxy;
   return request;
  };
  var options = new SetupOptions(); options.Cache = args[3];
  var token = new CancellationTokenSource();
  if (Int32.Parse(args[8]) > 0) token.CancelAfter(Int32.Parse(args[8]));
  var ctor = typeof(Installation).GetConstructor(BindingFlags.Instance | BindingFlags.NonPublic,null,new Type[] { typeof(SetupOptions),typeof(Action<string,int>),typeof(CancellationToken),typeof(Func<Uri,bool,HttpWebRequest>),typeof(int),typeof(int),typeof(int) },null);
  Action<string,int> progress = delegate(string message,int percent) {};
  Installation installation = ctor == null ? new Installation(options,progress,token.Token) : (Installation)ctor.Invoke(new object[] { options,progress,token.Token,factory,Int32.Parse(args[5]),Int32.Parse(args[6]),Int32.Parse(args[7]) });
  var item = new Dictionary<string,object> { {"id","fixture"},{"url","https://bootstrap.invalid"+args[4]},{"size",Int64.Parse(args[9])},{"sha256",args[10]} };
  var result = new Dictionary<string,object>(); var timer = Stopwatch.StartNew(); int exit = 0;
  try { result["file"] = typeof(Installation).GetMethod("Download",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(installation,new object[] { item }); }
  catch (Exception error) { if (error is TargetInvocationException) error=error.InnerException; result["error"]=error.GetType().Name; result["message"]=error.Message; result["cancelled"]=error is OperationCanceledException; exit=error is OperationCanceledException?2:1; }
  result["elapsedMs"]=timer.ElapsedMilliseconds; result["routes"]=routes.ToArray(); Console.WriteLine(new JavaScriptSerializer().Serialize(result));
  token.Dispose(); return exit;
 }
}
`);
  exe = path.join(work, 'BootstrapHarness.exe');
  const compiled = spawnSync(csc, ['/nologo', '/langversion:5', '/target:exe', '/main:BootstrapHarness', `/out:${exe}`,
    ...['System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map(name => `/r:${name}.dll`),
    path.join(project, 'installer/native/Common.cs'), path.join(project, 'installer/native/Setup.cs'), harness], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

after(async () => {
  for (const timer of intervals) clearInterval(timer);
  for (const socket of sockets) socket.destroy();
  await Promise.all([server, proxy].filter(Boolean).map(value => new Promise(resolve => value.close(resolve))));
  if (work) { assert.equal(path.dirname(path.resolve(work)).toLowerCase(), path.resolve(tmpdir()).toLowerCase()); await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

const nativeTest = (name, fn) => test(name, { skip: !windows }, fn);
async function download({ route = 'tunnel', resource = '/ok', data = bytes, connect = 250, idle = 250, total = 1000, cancel = 0 } = {}) {
  proxyMode = route;
  const cache = await mkdtemp(path.join(work, 'cache-'));
  const args = [certificate, proxyEndpoint, endpoint, cache, resource, String(connect), String(idle), String(total), String(cancel), String(data.length), createHash('sha256').update(data).digest('hex')];
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    const timeout = setTimeout(() => child.kill(), 5000);
    child.once('error', reject);
    child.once('exit', (status, signal) => { clearTimeout(timeout); resolve({ status, signal, stdout, stderr }); });
  });
  let output;
  try { output = JSON.parse(result.stdout.trim()); } catch { output = { output: result.stdout, errorOutput: result.stderr }; }
  return { ...result, output, elapsedMs: Date.now() - started, cache };
}

nativeTest('a failed system proxy falls back to direct and installs only verified bytes', async () => {
  const result = await download({ route: 'reject' });
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal(await readFile(path.join(result.cache, 'fixture.blob'), 'utf8'), bytes.toString());
  assert.deepEqual(result.output.routes, [false, true]);
});

nativeTest('a working system proxy is used without a direct connection', async () => {
  const previous = proxyConnections;
  const result = await download();
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal(proxyConnections - previous, 1);
  assert.equal(result.output.routes.includes(true), false);
});

nativeTest('a stalled proxy is bounded and direct fallback can complete', async () => {
  const result = await download({ route: 'stall', connect: 120 });
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.ok(result.elapsedMs < 2000, JSON.stringify(result));
  assert.deepEqual(result.output.routes, [false, true]);
});

nativeTest('a trickling body cannot exceed the total attempt deadline', async () => {
  const result = await download({ resource: '/trickle', data: slowBytes, total: 250 });
  assert.equal(result.status, 1, JSON.stringify(result));
  assert.ok(result.elapsedMs < 2500, JSON.stringify(result));
  await assert.rejects(access(path.join(result.cache, 'fixture.blob')));
});

nativeTest('a steadily progressing larger file has enough size-based time beyond the base deadline', async () => {
  const result = await download({ resource: '/steady-large', data: steadyBytes, total: 250 });
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.deepEqual(await readFile(path.join(result.cache, 'fixture.blob')), steadyBytes);
  assert.deepEqual(result.output.routes, [false]);
});

nativeTest('headers followed by a stalled body hit the idle deadline and release partial files', async () => {
  const result = await download({ resource: '/stall-body', connect: 1500, idle: 80, total: 3000 });
  assert.equal(result.status, 1, JSON.stringify(result));
  assert.ok(result.elapsedMs < 2000, JSON.stringify(result));
  assert.deepEqual(await readdir(result.cache), []);
});

nativeTest('cancelling stalled response headers exits promptly without starting direct fallback', async () => {
  const result = await download({ resource: '/stall-headers', connect: 2000, cancel: 120 });
  assert.equal(result.status, 2, JSON.stringify(result));
  assert.equal(result.output.cancelled, true);
  assert.equal(result.output.routes.includes(true), false);
  assert.ok(result.elapsedMs < 1500, JSON.stringify(result));
  await assert.rejects(access(path.join(result.cache, 'fixture.blob')));
});

nativeTest('checksum failure cannot be promoted or treated as a proxy failure', async () => {
  const result = await download({ resource: '/wrong-hash' });
  assert.equal(result.status, 1, JSON.stringify(result));
  assert.equal(result.output.routes.includes(true), false);
  await assert.rejects(access(path.join(result.cache, 'fixture.blob')));
});
