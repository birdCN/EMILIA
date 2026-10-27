import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(process.platform!=='win32'){console.log('Launcher integration requires Windows');process.exit(0);}
const project=fileURLToPath(new URL('../..',import.meta.url));
const root=await mkdtemp(path.join(tmpdir(),'emilia-launcher-test-'));
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
let launcher,unrelated,fixtureWorkerPid;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const compile=(output,files,extra=[])=>{
  const result=spawnSync(csc,['/nologo','/langversion:5','/target:winexe',`/out:${output}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',...extra,...files],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
};
const waitFor=async(fn)=>{let error;for(let i=0;i<150;i++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await new Promise(r=>setTimeout(r,100));}throw error||new Error('Launcher timed out');};
try{
  const source=path.join(project,'installer/native/Launcher.cs');
  assert.ok((await readFile(source,'utf8')).includes('LauncherProgram'),'native launcher implementation must exist');
  const stub=path.join(root,'NativeStub.cs');
  await writeFile(stub,String.raw`using System;using System.IO;using System.Collections.Generic;using System.Web.Script.Serialization;
namespace EmiliaInstaller { public static class Native {
 public const string ProductId="EmiliaEnglishCoach";
 public const string RetainedDataMarker=".emilia-user-data.json";
 public static string Quote(string v){return "\""+v.Replace("\"","\\\"")+"\"";}
 public static Dictionary<string,object> ReadJson(string p){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(p));}
 public static void WriteJson(string p,object v){Directory.CreateDirectory(Path.GetDirectoryName(p));File.WriteAllText(p,new JavaScriptSerializer().Serialize(v));}
 public static string ValidateInstallRoot(string p,bool allowNew){p=Path.GetFullPath(p);if(!File.Exists(Path.Combine(p,".emilia-install.json")))throw new Exception("missing marker");return p;}
}}`);
  const exe=path.join(root,'Emilia.exe');
  let common=path.join(project,'installer/native/Common.cs');
  try{await access(common);}catch{common=stub;}
  compile(exe,[common,source],['/main:EmiliaInstaller.LauncherProgram']);
  await mkdir(path.join(root,'runtime/node'),{recursive:true});
  await mkdir(path.join(root,'runtime/python'),{recursive:true});
  const fakeSource=path.join(root,'FakeNode.cs');
  await writeFile(fakeSource,String.raw`using System;using System.IO;using System.Net;using System.Net.Sockets;using System.Text;using System.Threading;using System.Web.Script.Serialization;using System.Collections.Generic;using System.Diagnostics;using System.Reflection;
class FakeNode {
static void Spawn(string argument){Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,argument){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=Environment.CurrentDirectory});}
static void Main(string[] args){
if(args.Length>0&&args[0]=="--worker"){File.WriteAllText(Path.Combine(Environment.CurrentDirectory,"worker-pid.txt"),Process.GetCurrentProcess().Id.ToString());Thread.Sleep(Timeout.Infinite);return;}
if(args.Length>0&&args[0]=="--intermediate"){File.WriteAllText(Path.Combine(Environment.CurrentDirectory,"intermediate-pid.txt"),Process.GetCurrentProcess().Id.ToString());Spawn("--worker");return;}
Thread.Sleep(250);Spawn("--intermediate");
var env=new Dictionary<string,string>();foreach(string k in new[]{"IELTS_PYTHON_PATH","IELTS_LEARNER_DATA_ROOT","IELTS_MODEL_CONFIG_PATH","IELTS_DEMO_PORT","IELTS_SKIP_WARMUP","IELTS_ASR_PORT","IELTS_ASR_DEVICE","IELTS_ASR_COMPUTE_TYPE","IELTS_TTS_GPU","PYTHONNOUSERSITE","PYTHONPATH","PYTHONHOME","HF_HOME","TEMP","EMILIA_INSTANCE_ID"})env[k]=Environment.GetEnvironmentVariable(k);File.WriteAllText(Path.Combine(Environment.CurrentDirectory,"child-env.json"),new JavaScriptSerializer().Serialize(env));var listener=new TcpListener(IPAddress.Loopback,int.Parse(env["IELTS_DEMO_PORT"]));listener.Start();while(true){using(var client=listener.AcceptTcpClient()){var stream=client.GetStream();var buffer=new byte[8192];stream.Read(buffer,0,buffer.Length);var body=Encoding.UTF8.GetBytes("{\"ok\":true,\"instanceId\":\""+env["EMILIA_INSTANCE_ID"]+"\"}");var header=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+body.Length+"\r\n\r\n");stream.Write(header,0,header.Length);stream.Write(body,0,body.Length);}}}}
`);
  compile(path.join(root,'runtime/node/node.exe'),[fakeSource]);
  await writeFile(path.join(root,'runtime/python/python.exe'),'synthetic Python path; never executed');
  await writeFile(path.join(root,'server.mjs'),'// synthetic server; native stub handles test HTTP');
  await writeFile(path.join(root,'.emilia-install.json'),JSON.stringify({product:'EmiliaEnglishCoach',portable:false}));
  const unrelatedRoot=path.join(root,'unrelated-fixture');
  await mkdir(unrelatedRoot);
  unrelated=spawn(path.join(root,'runtime/node/node.exe'),['--worker'],{cwd:unrelatedRoot,windowsHide:true,stdio:'ignore'});
  await waitFor(async()=>Number(await readFile(path.join(unrelatedRoot,'worker-pid.txt'),'utf8'))===unrelated.pid);
  const guardSource=path.join(root,'CheckDataRoot.cs');
  await writeFile(guardSource,String.raw`using System;using System.IO;using System.Reflection;class CheckDataRoot{static int Main(string[] a){var type=Assembly.LoadFile(a[0]).GetType("EmiliaInstaller.LauncherProgram");var method=type.GetMethod("SelectDataRoot",BindingFlags.NonPublic|BindingFlags.Static);try{method.Invoke(null,new object[]{a[1],Path.Combine(a[1],"unsafe-data")});return 1;}catch(TargetInvocationException e){if(!e.InnerException.Message.Contains("user-data"))return 2;}return Directory.Exists(Path.Combine(a[1],"unsafe-data"))?3:0;}}`);
  const guard=path.join(root,'CheckDataRoot.exe');compile(guard,[guardSource]);
  assert.equal(spawnSync(guard,[exe,root],{windowsHide:true}).status,0,'custom data inside disposable install folders must be rejected');
  const userData=path.join(root,'user-data');
  launcher=spawn(exe,['--background','--data-dir',userData],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PYTHONPATH:'must-be-cleared',PYTHONHOME:'must-be-cleared',IELTS_LEARNER_DATA_ROOT:'must-be-overridden',IELTS_MODEL_CONFIG_PATH:'must-be-overridden'}});
  const state=await waitFor(async()=>JSON.parse(await readFile(path.join(root,'runtime/launcher.json'),'utf8')));
  fixtureWorkerPid=await waitFor(async()=>Number(await readFile(path.join(root,'worker-pid.txt'),'utf8')));
  const intermediatePid=Number(await readFile(path.join(root,'intermediate-pid.txt'),'utf8'));
  await waitFor(()=>!alive(intermediatePid));
  assert.equal(alive(fixtureWorkerPid),true,'fixture worker must remain alive after its intermediate parent exits');
  assert.equal(new URL(state.url).hostname,'127.0.0.1');
  const health=await (await fetch(state.url+'api/health')).json();
  assert.equal(health.instanceId,state.instanceId);
  const env=JSON.parse(await readFile(path.join(root,'child-env.json'),'utf8'));
  assert.equal(path.resolve(env.IELTS_PYTHON_PATH),path.join(root,'runtime/python/python.exe'));
  assert.equal(path.resolve(env.IELTS_LEARNER_DATA_ROOT),path.join(userData,'learner'));
  assert.equal(path.resolve(env.IELTS_MODEL_CONFIG_PATH),path.join(userData,'private/model-settings.json'));
  assert.equal(env.PYTHONNOUSERSITE,'1');assert.ok(!env.PYTHONPATH);assert.ok(!env.PYTHONHOME);
  assert.equal(env.IELTS_TTS_GPU,'0');assert.equal(env.IELTS_ASR_DEVICE,'cpu');assert.equal(env.IELTS_ASR_COMPUTE_TYPE,'int8');assert.equal(env.IELTS_SKIP_WARMUP,'1');
  assert.notEqual(env.IELTS_ASR_PORT,env.IELTS_DEMO_PORT);
  assert.notEqual(env.IELTS_ASR_PORT,'4431');
  const second=spawn(exe,['--background','--data-dir',userData],{cwd:root,windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{second.once('exit',code=>code===0?resolve():reject(new Error('Duplicate launcher failed')));setTimeout(()=>reject(new Error('Duplicate launcher did not exit')),10000).unref();});
  assert.equal(JSON.parse(await readFile(path.join(root,'runtime/launcher.json'),'utf8')).pid,state.pid);
  // Signal the same install-specific stop event used by native uninstall; the launcher owns the child PID.
  const stopSource=path.join(root,'Stop.cs');
  await writeFile(stopSource,String.raw`using System;using System.IO;using System.Security.Cryptography;using System.Text;using System.Threading;class Stop {static void Main(string[] a){string key;using(var hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(a[0]).TrimEnd((char)92).ToUpperInvariant()))).Replace("-","");using(var ev=EventWaitHandle.OpenExisting("Local\\EmiliaEnglishCoach-"+key+"-Stop"))ev.Set();}}`);
  const stopExe=path.join(root,'Stop.exe');compile(stopExe,[stopSource]);
  assert.equal(spawnSync(stopExe,[root],{windowsHide:true}).status,0);
  await waitFor(()=>launcher.exitCode!==null);
  assert.throws(()=>process.kill(state.pid,0),'owned backend must stop with the tray launcher');
  await waitFor(()=>!alive(fixtureWorkerPid));
  assert.equal(alive(unrelated.pid),true,'closing the owned job must not kill another instance of the same executable');
  // Repeat with abrupt launcher termination: kill-on-close must work without ExitThreadCore.
  await rm(path.join(root,'worker-pid.txt'));
  await rm(path.join(root,'intermediate-pid.txt'));
  launcher=spawn(exe,['--background','--data-dir',userData],{cwd:root,windowsHide:true,stdio:'ignore'});
  const restarted=await waitFor(async()=>JSON.parse(await readFile(path.join(root,'runtime/launcher.json'),'utf8')));
  fixtureWorkerPid=await waitFor(async()=>Number(await readFile(path.join(root,'worker-pid.txt'),'utf8')));
  const exitedParent=Number(await readFile(path.join(root,'intermediate-pid.txt'),'utf8'));
  await waitFor(()=>!alive(exitedParent));
  assert.equal(alive(fixtureWorkerPid),true);
  process.kill(launcher.pid);
  await waitFor(()=>launcher.exitCode!==null);
  await waitFor(()=>!alive(restarted.pid)&&!alive(fixtureWorkerPid));
  assert.equal(alive(unrelated.pid),true,'abrupt launcher termination must leave unrelated processes alive');
  console.log('PASS: native bundled runtime, isolated profile, verified health, duplicate launch, orphaned descendants stopped on normal exit and forced launcher termination, unrelated process retained');
} finally{
  if(launcher&&launcher.exitCode===null){spawnSync(path.join(process.env.WINDIR,'System32/taskkill.exe'),['/PID',String(launcher.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>launcher.once('exit',r));}
  // This PID belongs to the fixture worker created above; the installed launcher never reads PID files to kill processes.
  if(fixtureWorkerPid&&alive(fixtureWorkerPid))process.kill(fixtureWorkerPid);
  if(unrelated&&unrelated.exitCode===null){unrelated.kill();await new Promise(r=>unrelated.once('exit',r));}
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
