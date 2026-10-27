import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,readdir,access,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(process.platform!=='win32'){console.log('Native uninstall integration requires Windows');process.exit(0);}
if(process.env.EMILIA_TEST_NATIVE_DIALOGS!=='1'){
  console.log('SKIP: native uninstall dialogs require explicit EMILIA_TEST_NATIVE_DIALOGS=1');
  process.exit(0);
}
const project=fileURLToPath(new URL('../..',import.meta.url));
const work=await mkdtemp(path.join(tmpdir(),'emilia-uninstall-test-'));
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const helperRoots=new Set();
const compile=(output,sources,main,target='winexe')=>{
  const result=spawnSync(csc,['/nologo','/langversion:5',`/target:${target}`,`/main:${main}`,`/out:${output}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',...sources],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
};
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
try{
  const baseline=path.join(work,'Emilia-fixture.exe');
  compile(baseline,[path.join(project,'installer/native/Common.cs'),path.join(project,'installer/native/Launcher.cs')],'EmiliaInstaller.LauncherProgram');
  const automationSource=path.join(work,'OwnDialogHarness.cs');
  await writeFile(automationSource,String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class OwnDialogHarness
{
    delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr window, int item);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry
    {
        public uint dwSize, cntUsage, processId; public UIntPtr defaultHeapId;
        public uint moduleId, cntThreads, parentProcessId; public int basePriority; public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string executable;
    }
    static readonly Dictionary<int,Process> owned=new Dictionary<int,Process>();
    static readonly HashSet<string> handledDialogs=new HashSet<string>();
    static readonly HashSet<string> helperFiles=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static readonly HashSet<int> helperProcesses=new HashSet<int>();
    static readonly HashSet<string> windowInfo=new HashSet<string>();
    static int confirmations, completions, errors;

    static void DiscoverHelpers()
    {
        IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
        if(snapshot==new IntPtr(-1))return;
        try
        {
            ProcessEntry entry=new ProcessEntry();entry.dwSize=(uint)Marshal.SizeOf(typeof(ProcessEntry));
            if(!Process32First(snapshot,ref entry))return;
            do
            {
                int pid=(int)entry.processId;
                if(owned.ContainsKey(pid)||!owned.ContainsKey((int)entry.parentProcessId)||!String.Equals(entry.executable,"EmiliaRemove.exe",StringComparison.OrdinalIgnoreCase))continue;
                Process candidate=null;
                try
                {
                    candidate=Process.GetProcessById(pid);
                    string file=Path.GetFullPath(candidate.MainModule.FileName);
                    string folder=Path.GetDirectoryName(file);
                    if(!folder.StartsWith(Path.Combine(Path.GetTempPath(),"EmiliaEnglishCoach-uninstall-"),StringComparison.OrdinalIgnoreCase)){candidate.Dispose();continue;}
                    IntPtr handle=candidate.Handle; // Retain the actual process handle, not a reusable PID.
                    owned.Add(pid,candidate);helperFiles.Add(file);helperProcesses.Add(pid);
                }
                catch{if(candidate!=null)candidate.Dispose();}
            }while(Process32Next(snapshot,ref entry));
        }
        finally{CloseHandle(snapshot);}
    }

    static void AnswerOwnedDialogs()
    {
        EnumWindows(delegate(IntPtr window,IntPtr ignored)
        {
            uint pid;GetWindowThreadProcessId(window,out pid);
            if(!owned.ContainsKey((int)pid))return true;
            StringBuilder cls=new StringBuilder(100);GetClassName(window,cls,cls.Capacity);
            StringBuilder title=new StringBuilder(500);GetWindowText(window,title,title.Capacity);
            windowInfo.Add(pid.ToString()+":"+cls.ToString()+":"+title.ToString()+":yes="+(GetDlgItem(window,6)!=IntPtr.Zero).ToString()+":ok="+(GetDlgItem(window,1)!=IntPtr.Zero).ToString());
            if(cls.ToString()!="#32770")return true;
            string key=pid.ToString()+":"+window.ToInt64().ToString();
            if(GetDlgItem(window,6)!=IntPtr.Zero&&GetDlgItem(window,7)!=IntPtr.Zero)
            {
                if(handledDialogs.Add(key))confirmations++;
                PostMessage(window,0x0111,new IntPtr(6),IntPtr.Zero); // IDYES, this fixture process only.
            }
            else if(GetDlgItem(window,1)!=IntPtr.Zero || helperProcesses.Contains((int)pid))
            {
                // The helper has only OK dialogs. Post IDOK even before a hidden dialog's
                // button handle becomes visible, then require its real exit code to be zero.
                if(handledDialogs.Add(key))completions++;
                PostMessage(window,0x0111,new IntPtr(1),IntPtr.Zero); // IDOK; retry while a hidden dialog initializes.
            }
            return true;
        },IntPtr.Zero);
    }

    static bool AllExited(){foreach(Process process in owned.Values)if(!process.HasExited)return false;return true;}
    [STAThread] static int Main(string[] args)
    {
        Console.OutputEncoding=new UTF8Encoding(false);
        int result=1;string error=null;
        try
        {
            ProcessStartInfo start=new ProcessStartInfo(args[0],"--uninstall");
            start.UseShellExecute=false;start.CreateNoWindow=true;start.WindowStyle=ProcessWindowStyle.Hidden;start.WorkingDirectory=Path.GetDirectoryName(args[0]);
            Process original=Process.Start(start);owned.Add(original.Id,original);
            DateTime deadline=DateTime.UtcNow.AddSeconds(40);
            while(DateTime.UtcNow<deadline)
            {
                DiscoverHelpers();AnswerOwnedDialogs();
                if(completions==1&&AllExited())
                {
                    foreach(Process process in owned.Values)if(process.ExitCode!=0)errors++;
                    result=errors==0&&confirmations==1&&original.ExitCode==0?0:1;break;
                }
                if(errors>0&&AllExited())break;
                Thread.Sleep(20);
            }
            if(result!=0)error="The isolated uninstall did not complete successfully";
        }
        catch(Exception e){error=e.Message;}
        finally
        {
            DiscoverHelpers();
            foreach(Process process in owned.Values){try{if(!process.HasExited){process.Kill();process.WaitForExit(2000);}}catch{}process.Dispose();}
            Console.WriteLine(new JavaScriptSerializer().Serialize(new{confirmations=confirmations,completions=completions,errors=errors,error=error,helpers=new List<string>(helperFiles).ToArray(),windows=new List<string>(windowInfo).ToArray()}));
        }
        return result;
    }
}
`);
  const automation=path.join(work,'OwnDialogHarness.exe');
  compile(automation,[automationSource],'OwnDialogHarness','exe');
  const external=path.join(work,'external-user-data');
  await mkdir(external);
  await writeFile(path.join(external,'synthetic-profile.json'),'EXTERNAL SYNTHETIC USER DATA MUST REMAIN');
  const results=[];
  for(const scenario of ['ready','pending-only']){
    const install=path.join(work,scenario);
    await mkdir(path.join(install,'runtime/cache'),{recursive:true});
    await mkdir(path.join(install,'user-data/private'),{recursive:true});
    await copyFile(baseline,path.join(install,'Emilia.exe'));
    const marker=scenario==='ready'?'.emilia-install.json':'.emilia-installing.json';
    await writeFile(path.join(install,marker),JSON.stringify({product:'EmiliaEnglishCoach',portable:true,schemaVersion:1}));
    await writeFile(path.join(install,'server.mjs'),'// synthetic app fixture');
    await writeFile(path.join(install,'runtime/cache/synthetic-model.bin'),'SYNTHETIC MODEL DATA');
    await writeFile(path.join(install,'user-data/private/synthetic-settings.json'),'PORTABLE SYNTHETIC SETTINGS MUST REMAIN');
    const run=spawnSync(automation,[path.join(install,'Emilia.exe')],{encoding:'utf8',windowsHide:true,timeout:50000});
    let record;
    try{record=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));for(const helper of record.helpers||[])helperRoots.add(path.dirname(helper));}
    catch{assert.fail(`Native dialog automation returned invalid output: ${run.stdout} ${run.stderr}`);}
    if(run.status!==0)record.remaining=await readdir(install);
    assert.equal(run.status,0,JSON.stringify(record));
    assert.equal(record.confirmations,1,'uninstall must ask for confirmation');
    assert.equal(record.completions,1,'the temporary helper must show and close its completion dialog');
    assert.equal(record.errors,0);
    assert.equal(await exists(path.join(install,'Emilia.exe')),false);
    assert.equal(await exists(path.join(install,'server.mjs')),false);
    assert.equal(await exists(path.join(install,'runtime')),false);
    assert.equal(await exists(path.join(install,marker)),false);
    assert.deepEqual((await readdir(install)).sort(),['.emilia-user-data.json','user-data']);
    assert.equal(await readFile(path.join(install,'user-data/private/synthetic-settings.json'),'utf8'),'PORTABLE SYNTHETIC SETTINGS MUST REMAIN');
    assert.equal(await readFile(path.join(external,'synthetic-profile.json'),'utf8'),'EXTERNAL SYNTHETIC USER DATA MUST REMAIN');
    results.push(scenario);
  }
  console.log(JSON.stringify({ok:true,nativeUninstall:results,confirmed:true,portableAndExternalDataRetained:true,dialogsClosed:true}));
} finally{
  // Helpers are discovered only as children of the fixture launcher, and are gone before cleanup.
  for(const helperRoot of helperRoots){
    assert.equal(path.dirname(path.resolve(helperRoot)).toLowerCase(),path.resolve(tmpdir()).toLowerCase());
    assert.match(path.basename(helperRoot),/^EmiliaEnglishCoach-uninstall-[a-f0-9]{32}$/);
    assert.equal((await lstat(helperRoot)).isSymbolicLink(),false);
    await rm(helperRoot,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
  assert.ok(path.resolve(work).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
