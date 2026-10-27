using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace EmiliaInstaller {
 public static class SetupProgram {
  public const string DisplayName="EMILIA";
  [STAThread] public static int Main(string[] args){
   try{
    if(args.Length>=3&&args[0]=="--extract"){Native.ExtractZip(args[1],args[2],args.Length>3?args[3]:null);return 0;}
    if(args.Length==3&&args[0]=="--extract-wheel"){Native.ExtractWheel(args[1],args[2]);return 0;}
    SetupOptions options=SetupOptions.Parse(args);
    if(options.Quiet){new Installation(options,delegate(string message,int percent){Console.WriteLine(message);},CancellationToken.None).Run();return 0;}
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new SetupWindow(options));return 0;
   }catch(Exception error){
    try{File.WriteAllText(Path.Combine(Path.GetTempPath(),"Emilia-setup-error.txt"),error.ToString(),Encoding.UTF8);}catch{}
    if(Array.IndexOf(args,"--quiet")<0&&Array.IndexOf(args,"--extract")<0&&Array.IndexOf(args,"--extract-wheel")<0)MessageBox.Show(error.Message,DisplayName+" 安装",MessageBoxButtons.OK,MessageBoxIcon.Error);
    return 1;
   }
  }
 }
 public sealed class SetupOptions {
  public string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","EmiliaEnglishCoach");
  public string Cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EmiliaEnglishCoach","DownloadCache");
  public bool Quiet,Portable,NoLaunch;
  public static SetupOptions Parse(string[] args){SetupOptions o=new SetupOptions();for(int i=0;i<args.Length;i++){
   switch(args[i]){case "--quiet":o.Quiet=true;break;case "--portable":o.Portable=true;break;case "--no-launch":o.NoLaunch=true;break;
    case "--dir":if(++i>=args.Length)throw new ArgumentException("缺少安装目录。");o.Root=args[i];break;
    case "--cache":if(++i>=args.Length)throw new ArgumentException("缺少缓存目录。");o.Cache=args[i];break;
    default:throw new ArgumentException("无法识别安装参数。");}
  }return o;}
 }
 public sealed class Installation {
  readonly SetupOptions options;readonly Action<string,int> update;readonly CancellationToken cancellation;string root;string log;
  readonly Func<Uri,bool,HttpWebRequest> downloadRequest;readonly int connectTimeoutMs,idleTimeoutMs,attemptTimeoutMs;
  public Installation(SetupOptions options,Action<string,int> update,CancellationToken cancellation):this(options,update,cancellation,CreateDownloadRequest,15000,30000,300000){}
  internal Installation(SetupOptions options,Action<string,int> update,CancellationToken cancellation,Func<Uri,bool,HttpWebRequest> downloadRequest,int connectTimeoutMs,int idleTimeoutMs,int attemptTimeoutMs){
   if(downloadRequest==null||connectTimeoutMs<=0||idleTimeoutMs<=0||attemptTimeoutMs<=0)throw new ArgumentException("下载策略无效。");
   this.options=options;this.update=update;this.cancellation=cancellation;this.downloadRequest=downloadRequest;this.connectTimeoutMs=connectTimeoutMs;this.idleTimeoutMs=idleTimeoutMs;this.attemptTimeoutMs=attemptTimeoutMs;
  }
  void Report(string message,int percent){cancellation.ThrowIfCancellationRequested();update(message,percent);if(log!=null)File.AppendAllText(log,DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine,Encoding.UTF8);}
  static void Resource(string name,string target){using(Stream stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){
   if(stream==null)throw new IOException("安装文件缺失："+name);using(MemoryStream memory=new MemoryStream()){stream.CopyTo(memory);Native.AtomicWrite(target,memory.ToArray());}
  }}
  public void Run(){using(Mutex gate=new Mutex(false,@"Local\EmiliaEnglishCoach-Setup")){
   bool acquired=false;try{try{acquired=gate.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new IOException("另一个 EMILIA 安装程序正在运行，请等待其完成。");RunLocked();}finally{if(acquired)gate.ReleaseMutex();}
  }}
  void RunLocked(){
   ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
   root=Native.ValidateInstallRoot(options.Root,true);CheckNotRunning(root);options.Cache=Path.GetFullPath(options.Cache);Native.CheckAncestors(options.Cache);
   Directory.CreateDirectory(root);Directory.CreateDirectory(options.Cache);
   // A ready marker is removed by the engine; the pending marker keeps retries recognizable.
   Native.WriteJson(Path.Combine(root,".emilia-installing.json"),new {product=Native.ProductId,version="1.3.4"});
   log=Path.Combine(root,"installation.log");Native.CheckAncestors(log);
   string payload=Path.Combine(options.Cache,"app-"+Guid.NewGuid().ToString("N")+".zip");
   try{Report("正在安装 EMILIA…",2);Resource("app.zip",payload);Native.ExtractZip(payload,root,null);}finally{if(File.Exists(payload))File.Delete(payload);}
   string manifestFile=Path.Combine(root,"installer","artifacts.json");Resource("artifacts.json",manifestFile);
   string helper=Path.Combine(root,"EmiliaSetup.exe");string source=Assembly.GetExecutingAssembly().Location;
   if(!source.Equals(helper,StringComparison.OrdinalIgnoreCase)){Native.CheckAncestors(helper);Native.AtomicWrite(helper,File.ReadAllBytes(source));}
   Dictionary<string,object> manifest=Native.ReadJson(manifestFile);ArrayList artifacts=(ArrayList)manifest["artifacts"];
   Dictionary<string,object> node=null,vc=null;foreach(Dictionary<string,object> item in artifacts){if(Convert.ToString(item["kind"])=="node")node=item;if(Convert.ToString(item["id"])=="vc-runtime")vc=item;}
   if(node==null||vc==null)throw new IOException("运行环境清单不完整。");
   Report("正在准备 Windows 运行库…",4);string vcBlob=Download(vc);string vcFile=Path.Combine(root,"runtime","support","VC_redist.x64.exe");Directory.CreateDirectory(Path.GetDirectoryName(vcFile));Native.AtomicWrite(vcFile,File.ReadAllBytes(vcBlob));
   if(Native.Hash(vcFile)!=Convert.ToString(vc["sha256"]))throw new IOException("Microsoft 运行库校验未通过。");EnsureVc(vcFile);
   Report("正在准备应用运行环境…",6);string nodeZip=Download(node);
   Native.ExtractZip(nodeZip,Path.Combine(root,"runtime","node"),Convert.ToString(node["stripPrefix"]));
   string nodeExe=Path.Combine(root,"runtime","node","node.exe");
   ProcessStartInfo start=new ProcessStartInfo(nodeExe,Native.Quote(Path.Combine(root,"installer","install-engine.mjs"))+" --root "+Native.Quote(root)+" --manifest "+Native.Quote(manifestFile)+" --extractor "+Native.Quote(helper)+" --cache "+Native.Quote(options.Cache));
   start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
   start.StandardOutputEncoding=Encoding.UTF8;start.StandardErrorEncoding=Encoding.UTF8;
   start.EnvironmentVariables.Remove("NODE_OPTIONS");start.EnvironmentVariables.Remove("NODE_PATH");
   StringBuilder diagnostic=new StringBuilder();
   using(Process process=new Process()){
    process.StartInfo=start;process.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data==null)return;try{
     Dictionary<string,object> evt=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(e.Data);string type=Convert.ToString(evt["type"]);
     string message=Convert.ToString(evt["message"]);if(type=="error"){lock(diagnostic){diagnostic.AppendLine(message);}return;}
     if(type=="progress"){string phase=Convert.ToString(evt["phase"]);double current=Convert.ToDouble(evt["current"]),total=Convert.ToDouble(evt["total"]);
      int percent=phase=="install"?10+(int)(75*current/Math.Max(1,total)):phase=="validate"?90+(int)(8*current/Math.Max(1,total)):phase=="complete"?99:-1;
      string label=phase=="download"?"正在下载：":phase=="validate"?"正在检查本地模型：":phase=="extract"?"正在安装：":"";
      if(phase=="download")message+="  "+(current/1048576).ToString("F1")+" / "+(total/1048576).ToString("F1")+" MB";
      if(!cancellation.IsCancellationRequested)Report(label+message,percent);
     }
    }catch(OperationCanceledException){}catch(Exception){}};
    process.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)lock(diagnostic){if(diagnostic.Length<16000)diagnostic.AppendLine(e.Data);}};
    process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine();
    while(!process.WaitForExit(200)){if(cancellation.IsCancellationRequested){KillTree(process);throw new OperationCanceledException();}}
    process.WaitForExit();if(process.ExitCode!=0){string detail;lock(diagnostic){detail=diagnostic.ToString();}throw new IOException("安装未完成，可以重新运行安装程序继续。\n"+detail);}
   }
   Dictionary<string,object> marker=Native.ReadJson(Path.Combine(root,".emilia-install.json"));if(Convert.ToString(marker["product"])!=Native.ProductId)throw new IOException("安装验证未完成。");
   marker["portable"]=options.Portable;Native.WriteJson(Path.Combine(root,".emilia-install.json"),marker);
   if(!options.Portable){Report("正在创建启动入口…",99);CreateShortcuts();RegisterUninstall();}
   File.Delete(Path.Combine(root,".emilia-installing.json"));Report("安装完成",100);
   if(!options.NoLaunch)Process.Start(new ProcessStartInfo(Path.Combine(root,"Emilia.exe")){WorkingDirectory=root,UseShellExecute=true});
  }
  static void KillTree(Process process){try{ProcessStartInfo kill=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"taskkill.exe"),"/PID "+process.Id+" /T /F");kill.UseShellExecute=false;kill.CreateNoWindow=true;using(Process child=Process.Start(kill))child.WaitForExit(10000);}catch{try{process.Kill();}catch{}}}
  static void CheckNotRunning(string root){
   string key;using(var hash=System.Security.Cryptography.SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-","");
   try{using(Mutex running=Mutex.OpenExisting(@"Local\EmiliaEnglishCoach-"+key)){bool acquired=false;try{try{acquired=running.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new IOException("EMILIA 正在运行。请先从系统托盘退出，再重新安装或修复。");}finally{if(acquired)running.ReleaseMutex();}}}catch(WaitHandleCannotBeOpenedException){}
  }
  static HttpWebRequest CreateDownloadRequest(Uri uri,bool direct){HttpWebRequest request=(HttpWebRequest)WebRequest.Create(uri);if(direct)request.Proxy=null;return request;}
  static void AbortDownload(HttpWebRequest request){ThreadPool.QueueUserWorkItem(delegate(object ignored){try{request.Abort();}catch{}});}
  T DownloadOperation<T>(Func<T> action,HttpWebRequest request,Stopwatch elapsed,int phaseTimeoutMs,int attemptBudgetMs){
   cancellation.ThrowIfCancellationRequested();
   int remaining=(int)Math.Max(0,attemptBudgetMs-elapsed.ElapsedMilliseconds);
   if(remaining==0)throw new WebException("运行环境下载超过时限。",WebExceptionStatus.Timeout);
   Task<T> operation=Task.Factory.StartNew(action,CancellationToken.None,TaskCreationOptions.DenyChildAttach,TaskScheduler.Default);
   bool completed=false;
   try{
    if(!operation.Wait(Math.Min(phaseTimeoutMs,remaining),cancellation))throw new WebException("运行环境下载连接或读取超时。",WebExceptionStatus.Timeout);
    completed=true;return operation.Result;
   }catch(AggregateException error){if(error.InnerExceptions.Count==1)throw error.InnerExceptions[0];throw;}
   finally{if(!completed){
    // Framework proxy discovery can ignore HttpWebRequest.Timeout. The caller's
    // deadline does not wait for that operation or for Abort to return.
    AbortDownload(request);
    operation.ContinueWith(delegate(Task<T> late){
     if(late.Status==TaskStatus.RanToCompletion){IDisposable resource=late.Result as IDisposable;if(resource!=null)try{resource.Dispose();}catch{}}
     else if(late.IsFaulted){AggregateException observed=late.Exception;}
    },CancellationToken.None,TaskContinuationOptions.ExecuteSynchronously,TaskScheduler.Default);
   }}
  }
  static bool TransportFailure(Exception error){
   WebException network=error as WebException;if(network==null)return false;
   if(network.Status!=WebExceptionStatus.ProtocolError)return true;
   HttpWebResponse response=network.Response as HttpWebResponse;
   return response!=null&&response.StatusCode==HttpStatusCode.ProxyAuthenticationRequired;
  }
  string Download(Dictionary<string,object> item){
   string id=Convert.ToString(item["id"]),hash=Convert.ToString(item["sha256"]);long size=Convert.ToInt64(item["size"]);
   // Keep slow but progressing bootstrap transfers viable at 32 KiB/s, while
   // retaining an absolute two-hour ceiling as well as connection/idle limits.
   int attemptBudgetMs=(int)Math.Min(7200000.0,attemptTimeoutMs+Math.Ceiling(size*1000.0/32768));
   if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-zA-Z0-9._-]+$"))throw new IOException("下载标识无效。");
   string file=Path.Combine(options.Cache,id+".blob");Native.CheckAncestors(file);
   if(File.Exists(file)&&new FileInfo(file).Length==size&&Native.Hash(file)==hash)return file;
   List<string> urls=new List<string>();urls.Add(Convert.ToString(item["url"]));object extra;if(item.TryGetValue("urls",out extra))foreach(object url in (ArrayList)extra)if(!urls.Contains(Convert.ToString(url)))urls.Add(Convert.ToString(url));
   Exception last=null;
   for(int attempt=0;attempt<3;attempt++)foreach(string url in urls)for(int route=0;route<2;route++){
    cancellation.ThrowIfCancellationRequested();Uri uri=new Uri(url);if(uri.Scheme!="https")throw new IOException("下载地址必须为 HTTPS。");string temporary=file+".native-part";Native.CheckAncestors(temporary);
    try{
     bool direct=route==1;HttpWebRequest request=downloadRequest(uri,direct);request.Timeout=connectTimeoutMs;request.ReadWriteTimeout=idleTimeoutMs;request.UserAgent="EmiliaSetup/1.3";
     Stopwatch elapsed=Stopwatch.StartNew();
     Report((direct?"正在尝试直接下载：":"正在下载运行环境：")+id,-1);
     using(cancellation.Register(delegate{AbortDownload(request);}))using(WebResponse response=DownloadOperation(delegate{return request.GetResponse();},request,elapsed,connectTimeoutMs,attemptBudgetMs))using(Stream input=response.GetResponseStream())using(FileStream output=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None)){
      byte[] buffer=new byte[262144];long received=0,lastProgress=0;int length;
      while((length=DownloadOperation(delegate{try{return input.Read(buffer,0,buffer.Length);}catch(IOException error){throw new WebException("运行环境下载中断。",error,WebExceptionStatus.ReceiveFailure,null);}},request,elapsed,idleTimeoutMs,attemptBudgetMs))>0){
       cancellation.ThrowIfCancellationRequested();received+=length;if(received>size)throw new InvalidDataException("下载文件大小不符。");output.Write(buffer,0,length);
       if(received==size||elapsed.ElapsedMilliseconds-lastProgress>=500){Report("正在下载运行环境："+id+"  "+(received/1048576.0).ToString("F1")+" / "+(size/1048576.0).ToString("F1")+" MB",-1);lastProgress=elapsed.ElapsedMilliseconds;}
      }
     }
     cancellation.ThrowIfCancellationRequested();
     if(new FileInfo(temporary).Length!=size||Native.Hash(temporary)!=hash)throw new InvalidDataException("下载文件校验未通过。");
     if(File.Exists(file))File.Delete(file);File.Move(temporary,file);return file;
    }catch(Exception error){
     if(cancellation.IsCancellationRequested)throw new OperationCanceledException();last=error;
     bool fallback=route==0&&TransportFailure(error);WebException network=error as WebException;if(network!=null&&network.Response!=null)network.Response.Dispose();
     if(!fallback)break;
    }finally{if(File.Exists(temporary))File.Delete(temporary);}
   }
   throw new IOException("无法下载运行环境，请检查网络后重试："+id,last);
  }
  static bool HasVc(){
   try{string system=Environment.GetFolderPath(Environment.SpecialFolder.System);foreach(string name in new string[]{"msvcp140.dll","msvcp140_1.dll"}){string file=Path.Combine(system,name);if(!File.Exists(file)||new Version(FileVersionInfo.GetVersionInfo(file).FileMajorPart,FileVersionInfo.GetVersionInfo(file).FileMinorPart)<new Version(14,40))return false;}return true;}catch{return false;}
  }
  void EnsureVc(string file){if(HasVc())return;if(options.Quiet)throw new IOException("需要 Microsoft Visual C++ 运行库。请以图形界面运行安装程序完成安装。");
   Report("请在 Windows 提示中允许安装 Microsoft Visual C++ 运行库。",5);
   ProcessStartInfo start=new ProcessStartInfo(file,"/install /quiet /norestart");start.UseShellExecute=true;start.Verb="runas";start.WindowStyle=ProcessWindowStyle.Hidden;
   using(Process process=Process.Start(start)){process.WaitForExit();if(process.ExitCode!=0&&process.ExitCode!=1638&&process.ExitCode!=3010)throw new IOException("Microsoft 运行库安装未完成，代码："+process.ExitCode);}
   if(!HasVc())throw new IOException("Microsoft 运行库尚不可用，请重启 Windows 后重新安装。");
  }
  void CreateShortcuts(){
   string desktop=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),programs=Environment.GetFolderPath(Environment.SpecialFolder.Programs);
   string menu=Path.Combine(programs,SetupProgram.DisplayName),desktopLink=Path.Combine(desktop,SetupProgram.DisplayName+".lnk"),menuLink=Path.Combine(menu,SetupProgram.DisplayName+".lnk");
   // Check both names before changing any existing shortcut or legacy entry.
   RequireShortcutTarget(desktopLink);RequireShortcutTarget(menuLink);Native.CheckAncestors(menu);Directory.CreateDirectory(menu);
   Shortcut(desktopLink);Shortcut(menuLink);
   RemoveOwnedShortcut(Path.Combine(desktop,"Emilia English Coach.lnk"));
   string legacyMenu=Path.Combine(programs,"Emilia English Coach");
   if(RemoveOwnedShortcut(Path.Combine(legacyMenu,"Emilia English Coach.lnk"))&&Directory.Exists(legacyMenu)&&Directory.GetFileSystemEntries(legacyMenu).Length==0)Directory.Delete(legacyMenu);
  }
  bool ShortcutIsOurs(string file){
   Native.CheckAncestors(file);if(!File.Exists(file))return false;
   Type type=Type.GetTypeFromProgID("WScript.Shell");object shell=null,link=null;
   try{shell=Activator.CreateInstance(type);link=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});string target=Convert.ToString(link.GetType().InvokeMember("TargetPath",BindingFlags.GetProperty,null,link,null));return String.Equals(Path.GetFullPath(target),Path.Combine(root,"Emilia.exe"),StringComparison.OrdinalIgnoreCase);}
   catch{return false;}
   finally{if(link!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);if(shell!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}
  }
  void RequireShortcutTarget(string file){Native.CheckAncestors(file);if(File.Exists(file)&&!ShortcutIsOurs(file))throw new IOException("已存在其他程序的 EMILIA 快捷方式，请先将其改名后重试："+file);}
  bool RemoveOwnedShortcut(string file){if(!ShortcutIsOurs(file))return false;File.Delete(file);return true;}
  void Shortcut(string file){RequireShortcutTarget(file);Type type=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(type);object link=null;try{
   link=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});Type lt=link.GetType();
   lt.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{Path.Combine(root,"Emilia.exe")});lt.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,link,new object[]{root});lt.InvokeMember("IconLocation",BindingFlags.SetProperty,null,link,new object[]{Path.Combine(root,"public","assets","branding","emilia.ico")+",0"});lt.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
  }finally{if(link!=null)System.Runtime.InteropServices.Marshal.ReleaseComObject(link);System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);}}
  void RegisterUninstall(){using(RegistryKey key=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\EmiliaEnglishCoach")){
   key.SetValue("DisplayName",SetupProgram.DisplayName);key.SetValue("DisplayVersion","1.3.4");key.SetValue("Publisher","EMILIA contributors");key.SetValue("InstallLocation",root);key.SetValue("DisplayIcon",Path.Combine(root,"Emilia.exe"));key.SetValue("UninstallString",Native.Quote(Path.Combine(root,"Emilia.exe"))+" --uninstall");key.SetValue("NoModify",1,RegistryValueKind.DWord);key.SetValue("NoRepair",1,RegistryValueKind.DWord);
  }}
 }
 public sealed class SetupWindow:Form {
  readonly SetupOptions options;readonly TextBox folder;readonly Button install,browse;readonly Label status;readonly ProgressBar progress;readonly CheckBox accept;CancellationTokenSource cancellation;bool running,finished;
  public SetupWindow(SetupOptions options){this.options=options;Text="安装 "+SetupProgram.DisplayName;Icon=Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location)??SystemIcons.Application;ClientSize=new Size(620,370);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;Font=new Font("Microsoft YaHei UI",10);BackColor=Color.FromArgb(250,248,253);
   Controls.Add(new Label{Text=SetupProgram.DisplayName,Location=new Point(28,25),Size=new Size(560,38),Font=new Font("Segoe UI",21,FontStyle.Bold),ForeColor=Color.FromArgb(96,76,140)});
   Controls.Add(new Label{Text="英语口语练习 · 自然对话 · 本地学习记忆",Location=new Point(30,73),Size=new Size(560,25)});
   Controls.Add(new Label{Text="首次安装需联网下载约 2.4 GB，建议预留 8 GB 空间。\n运行环境和语音模型将自动安装；使用时需填写自己的模型 API。",Location=new Point(30,110),Size=new Size(560,52)});
   folder=new TextBox{Text=options.Root,Location=new Point(30,180),Size=new Size(450,28)};Controls.Add(folder);
   browse=new Button{Text="选择目录",Location=new Point(490,178),Size=new Size(100,30)};browse.Click+=delegate{using(FolderBrowserDialog dialog=new FolderBrowserDialog()){dialog.Description="选择空文件夹或已有 EMILIA 安装目录";dialog.SelectedPath=folder.Text;if(dialog.ShowDialog()==DialogResult.OK)folder.Text=dialog.SelectedPath;}};Controls.Add(browse);
   accept=new CheckBox{Text="我已阅读并同意项目 MIT 许可及第三方组件许可",Location=new Point(30,222),Size=new Size(440,28)};Controls.Add(accept);
   LinkLabel license=new LinkLabel{Text="查看许可",Location=new Point(482,227),Size=new Size(110,25)};license.LinkClicked+=delegate{string temp=Path.Combine(Path.GetTempPath(),"Emilia-licenses.txt");using(Stream resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("licenses.txt"))using(StreamReader reader=new StreamReader(resource,Encoding.UTF8))File.WriteAllText(temp,reader.ReadToEnd(),Encoding.UTF8);Process.Start(new ProcessStartInfo("notepad.exe",Native.Quote(temp)){UseShellExecute=true});};Controls.Add(license);
   status=new Label{Text="准备就绪",Location=new Point(30,270),Size=new Size(450,23),AutoEllipsis=true};Controls.Add(status);progress=new ProgressBar{Location=new Point(30,305),Size=new Size(430,18)};Controls.Add(progress);
   install=new Button{Text="安装",Location=new Point(490,295),Size=new Size(100,40),BackColor=Color.FromArgb(121,99,166),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};install.Click+=async delegate{if(finished){Close();return;}if(running){cancellation.Cancel();install.Enabled=false;status.Text="正在停止…";return;}if(!accept.Checked){MessageBox.Show("请先阅读并同意许可条款。");return;}options.Root=folder.Text;running=true;folder.Enabled=browse.Enabled=accept.Enabled=false;install.Text="取消";cancellation=new CancellationTokenSource();
    try{await Task.Run(delegate{new Installation(options,UpdateProgress,cancellation.Token).Run();});status.Text="安装完成。桌面入口已准备好。";install.Text="关闭";finished=true;}
    catch(OperationCanceledException){status.Text="安装已暂停，重新安装可继续。";install.Text="继续安装";}
    catch(Exception error){status.Text="安装未完成，可重试。";MessageBox.Show(error.Message,"安装未完成",MessageBoxButtons.OK,MessageBoxIcon.Warning);install.Text="重试";}
    finally{running=false;folder.Enabled=browse.Enabled=accept.Enabled=install.Enabled=true;cancellation.Dispose();cancellation=null;}
   };Controls.Add(install);FormClosing+=delegate(object sender,FormClosingEventArgs e){if(running){e.Cancel=true;cancellation.Cancel();status.Text="正在停止安装，请稍候…";}};
  }
  void UpdateProgress(string text,int percent){if(IsDisposed)return;BeginInvoke((Action)delegate{status.Text=text;if(percent>=0)progress.Value=Math.Max(0,Math.Min(100,percent));});}
 }
}
