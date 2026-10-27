using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace EmiliaInstaller
{
    public static class LauncherProgram
    {
        private const string Product = "EmiliaEnglishCoach";
        private const string DisplayName = "EMILIA";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\EmiliaEnglishCoach";
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileEx(string existing, string replacement, int flags);

        [STAThread]
        public static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                if (args.Length == 3 && args[0] == "--remove-install")
                    return RemoveInstallation(args[1], Int32.Parse(args[2], CultureInfo.InvariantCulture));
                string root = Native.ValidateInstallRoot(AppDomain.CurrentDomain.BaseDirectory, false);
                bool background = false, uninstall = false;
                string dataOverride = null;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--background") background = true;
                    else if (args[i] == "--uninstall") uninstall = true;
                    else if (args[i] == "--data-dir" && i + 1 < args.Length) dataOverride = args[++i];
                    else throw new InvalidOperationException("无法识别启动参数。");
                }
                string key = InstallKey(root);
                if (uninstall) return Uninstall(root, key);
                if (File.Exists(Path.Combine(root, ".emilia-installing.json"))) throw new InvalidOperationException("安装尚未完成。请重新运行 EMILIA 安装程序完成安装或修复。");
                RequireProductMarker(root);
                bool created;
                using (Mutex mutex = new Mutex(true, @"Local\" + Product + "-" + key, out created))
                {
                    if (!created)
                    {
                        if (!background) OpenExisting(root);
                        return 0;
                    }
                    try
                    {
                        string dataRoot = SelectDataRoot(root, dataOverride);
                        using (TraySession session = new TraySession(root, dataRoot, key, background))
                            Application.Run(session);
                    }
                    finally { mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show("EMILIA 启动失败。\n\n" + error.Message + "\n\n如果安装文件不完整，请重新运行安装程序。", DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string InstallKey(string root)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd('\\').ToUpperInvariant()))).Replace("-", "");
        }

        private static void RequireProductMarker(string root, bool allowPending = false)
        {
            string file = Path.Combine(root, ".emilia-install.json");
            if (allowPending && !File.Exists(file)) file = Path.Combine(root, ".emilia-installing.json");
            Dictionary<string, object> marker = Native.ReadJson(file);
            object value;
            if (!marker.TryGetValue("product", out value) || !String.Equals(Convert.ToString(value), Product, StringComparison.Ordinal))
                throw new InvalidOperationException("这个目录不是 EMILIA 的有效安装目录。");
        }

        private static void RejectReparseAncestors(string path)
        {
            string current = Path.GetFullPath(path);
            while (!String.IsNullOrEmpty(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("目录不能包含符号链接或目录联接：" + current);
                DirectoryInfo parent = Directory.GetParent(current);
                current = parent == null ? null : parent.FullName;
            }
        }

        private static bool AtOrBelow(string candidate, string directory)
        {
            candidate = Path.GetFullPath(candidate).TrimEnd('\\', '/');
            directory = Path.GetFullPath(directory).TrimEnd('\\', '/');
            return String.Equals(candidate, directory, StringComparison.OrdinalIgnoreCase)
                || candidate.StartsWith(directory + "\\", StringComparison.OrdinalIgnoreCase);
        }

        private static string SelectDataRoot(string root, string dataOverride)
        {
            object portable;
            Dictionary<string, object> marker = Native.ReadJson(Path.Combine(root, ".emilia-install.json"));
            bool isPortable = marker.TryGetValue("portable", out portable) && portable is bool && (bool)portable;
            string data = dataOverride ?? (isPortable ? Path.Combine(root, "user-data") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product, "UserData"));
            data = Path.GetFullPath(data);
            if (data.Length > Path.GetPathRoot(data).Length) data = data.TrimEnd('\\', '/');
            string preserved = Path.Combine(root, "user-data");
            if (AtOrBelow(data, root) && !String.Equals(data, preserved, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("自定义学习档案请选择应用安装目录之外的文件夹，或使用安装目录中的 user-data 文件夹。");
            RejectReparseAncestors(data);
            string[] folders = { Path.Combine(data, "learner"), Path.Combine(data, "private") };
            foreach (string folder in folders)
            {
                if (!AtOrBelow(folder, preserved) && (AtOrBelow(folder, root) || AtOrBelow(root, folder)))
                    throw new InvalidOperationException("学习档案或 API 设置目录不能与应用安装目录重叠。请选择独立的学习档案目录。");
                RejectReparseAncestors(folder);
            }
            foreach (string folder in folders) Directory.CreateDirectory(folder);
            return data;
        }

        private static int FreePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static bool HealthMatches(string url, string instanceId)
        {
            try
            {
                Uri uri;
                Guid parsed;
                if (!Guid.TryParse(instanceId, out parsed) || !Uri.TryCreate(url, UriKind.Absolute, out uri)
                    || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.UserInfo.Length != 0) return false;
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(new Uri(uri, "api/health"));
                request.Proxy = null;
                request.AllowAutoRedirect = false;
                request.Timeout = 1200;
                request.ReadWriteTimeout = 1200;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (Stream stream = response.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    char[] buffer = new char[32769];
                    int count = reader.ReadBlock(buffer, 0, buffer.Length);
                    if (count > 32768) return false;
                    Dictionary<string, object> body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new String(buffer, 0, count));
                    object value;
                    return body.TryGetValue("instanceId", out value) && String.Equals(Convert.ToString(value), instanceId, StringComparison.Ordinal);
                }
            }
            catch { return false; }
        }

        private static void OpenBrowser(string url)
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        private static void OpenExisting(string root)
        {
            string statePath = Path.Combine(root, "runtime", "launcher.json");
            for (int attempt = 0; attempt < 80; attempt++)
            {
                try
                {
                    Dictionary<string, object> state = Native.ReadJson(statePath);
                    string url = Convert.ToString(state["url"]), instance = Convert.ToString(state["instanceId"]);
                    if (HealthMatches(url, instance)) { OpenBrowser(url); return; }
                }
                catch { }
                Thread.Sleep(250);
            }
            throw new InvalidOperationException("EMILIA 正在启动或未能响应。请从系统托盘退出后重试。");
        }

        private static bool ModelsReady(string root)
        {
            string[] required = {
                @"runtime\asr\large-v3-turbo\model.bin", @"runtime\asr\large-v3-turbo\config.json", @"runtime\asr\large-v3-turbo\tokenizer.json",
                @"runtime\tts\kokoro\kokoro-v1.0.onnx", @"runtime\tts\kokoro\voices\jf_alpha.bin", @"runtime\tts\kokoro\voices\af_heart.bin", @"runtime\tts\kokoro\voices\af_sky.bin"
            };
            foreach (string relative in required)
            {
                FileInfo file = new FileInfo(Path.Combine(root, relative));
                if (!file.Exists || file.Length == 0) return false;
            }
            return true;
        }

        // Membership survives an intermediate parent's exit. Closing this non-inheritable
        // handle also terminates owned local-model workers if the launcher is terminated.
        private sealed class OwnedProcessJob : IDisposable
        {
            private const uint KillOnJobClose = 0x00002000;
            private readonly JobHandle handle;

            [StructLayout(LayoutKind.Sequential)]
            private struct BasicLimits
            {
                public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
                public uint LimitFlags;
                public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
                public uint ActiveProcessLimit;
                public UIntPtr Affinity;
                public uint PriorityClass, SchedulingClass;
            }
            [StructLayout(LayoutKind.Sequential)]
            private struct IoCounters
            {
                public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
                public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
            }
            [StructLayout(LayoutKind.Sequential)]
            private struct ExtendedLimits
            {
                public BasicLimits BasicLimitInformation;
                public IoCounters IoInfo;
                public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
            }
            private sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid
            {
                private JobHandle() : base(true) { }
                protected override bool ReleaseHandle() { return CloseHandle(handle); }
            }
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            private static extern JobHandle CreateJobObject(IntPtr securityAttributes, string name);
            [DllImport("kernel32.dll", SetLastError = true)]
            private static extern bool SetInformationJobObject(JobHandle job, int informationClass, ref ExtendedLimits information, uint informationLength);
            [DllImport("kernel32.dll", SetLastError = true)]
            private static extern bool AssignProcessToJobObject(JobHandle job, IntPtr process);
            [DllImport("kernel32.dll", SetLastError = true)]
            private static extern bool CloseHandle(IntPtr handle);

            public OwnedProcessJob()
            {
                // Null security attributes create a handle that child processes cannot inherit.
                handle = CreateJobObject(IntPtr.Zero, null);
                if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error, "无法创建 EMILIA 的专用进程组。"); }
                ExtendedLimits limits = new ExtendedLimits();
                limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
                if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
                {
                    int error = Marshal.GetLastWin32Error(); handle.Dispose();
                    throw new Win32Exception(error, "无法配置 EMILIA 的专用进程组。");
                }
            }
            public void Assign(Process process)
            {
                if (!AssignProcessToJobObject(handle, process.Handle))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "无法管理 EMILIA 的专用进程。请退出后重试。");
            }
            public void Dispose() { handle.Dispose(); }
        }

        private sealed class TraySession : ApplicationContext
        {
            private readonly string root, url, instanceId, statePath;
            private readonly bool background;
            private readonly Process child;
            private readonly NotifyIcon tray;
            private readonly System.Windows.Forms.Timer timer;
            private readonly EventWaitHandle stopEvent;
            private readonly OwnedProcessJob job;
            private readonly object logLock = new object();
            private readonly string logPath;
            private readonly DateTime started = DateTime.UtcNow;
            private bool ready, closing;

            public TraySession(string installRoot, string dataRoot, string key, bool silent)
            {
                root = installRoot; background = silent;
                string runtime = Path.Combine(root, "runtime");
                RejectReparseAncestors(runtime);
                Directory.CreateDirectory(runtime);
                statePath = Path.Combine(runtime, "launcher.json");
                logPath = Path.Combine(runtime, "launcher.log");
                if (File.Exists(logPath) && new FileInfo(logPath).Length > 1024 * 1024) File.Delete(logPath);
                if (File.Exists(statePath)) File.Delete(statePath);
                string node = Path.Combine(runtime, "node", "node.exe"), python = Path.Combine(runtime, "python", "python.exe");
                if (!File.Exists(node) || !File.Exists(python) || !File.Exists(Path.Combine(root, "server.mjs")))
                    throw new InvalidOperationException("缺少 EMILIA 的专用运行环境或程序文件。");
                RejectReparseAncestors(node); RejectReparseAncestors(python);
                int port = FreePort(), asrPort;
                do { asrPort = FreePort(); } while (asrPort == port);
                url = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/";
                instanceId = Guid.NewGuid().ToString("D");
                ProcessStartInfo info = new ProcessStartInfo(node, Native.Quote(Path.Combine(root, "server.mjs")));
                info.WorkingDirectory = root; info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
                info.RedirectStandardOutput = true; info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
                string temp = Path.Combine(runtime, "temp"), hf = Path.Combine(runtime, "cache", "huggingface"), pip = Path.Combine(runtime, "cache", "pip");
                foreach (string folder in new string[] { temp, hf, pip }) { RejectReparseAncestors(folder); Directory.CreateDirectory(folder); }
                string[] clear = { "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS", "NODE_PATH", "IELTS_PREVIEW_ONLY", "IELTS_ESPEAK_ROOT", "IELTS_KOKORO_GPU_ROOT", "IELTS_ASR_CUDA_ROOT" };
                foreach (string name in clear) info.EnvironmentVariables.Remove(name);
                var environment = new Dictionary<string, string> {
                    {"IELTS_DEMO_PORT", port.ToString(CultureInfo.InvariantCulture)}, {"IELTS_ASR_PORT", asrPort.ToString(CultureInfo.InvariantCulture)},
                    {"EMILIA_INSTANCE_ID", instanceId}, {"EMILIA_INSTALL_ROOT", root}, {"IELTS_RUNTIME_ROOT", runtime}, {"IELTS_PYTHON_PATH", python},
                    {"EMILIA_BROWSER_STARTUP_GRACE_MS", background ? "0" : "60000"},
                    {"IELTS_LEARNER_DATA_ROOT", Path.Combine(dataRoot, "learner")}, {"IELTS_MODEL_CONFIG_PATH", Path.Combine(dataRoot, "private", "model-settings.json")},
                    {"PYTHONNOUSERSITE", "1"}, {"PYTHONUTF8", "1"}, {"PYTHONDONTWRITEBYTECODE", "1"}, {"HF_HOME", hf}, {"HF_HUB_CACHE", Path.Combine(hf, "hub")},
                    {"HF_HUB_OFFLINE", "1"}, {"TRANSFORMERS_OFFLINE", "1"}, {"HF_DATASETS_OFFLINE", "1"}, {"PIP_NO_INDEX", "1"}, {"PIP_CACHE_DIR", pip}, {"TEMP", temp}, {"TMP", temp},
                    {"IELTS_COMPACT_SPOKEN_PROMPT", "1"}, {"IELTS_TTS_GPU", "0"}, {"IELTS_ASR_DEVICE", "cpu"}, {"IELTS_ASR_COMPUTE_TYPE", "int8"},
                    {"IELTS_SKIP_WARMUP", ModelsReady(root) ? "0" : "1"},
                    {"PHONEMIZER_ESPEAK_LIBRARY", Path.Combine(runtime, @"python\Lib\site-packages\espeakng_loader\espeak-ng.dll")}
                };
                foreach (KeyValuePair<string, string> pair in environment) info.EnvironmentVariables[pair.Key] = pair.Value;
                try
                {
                    job = new OwnedProcessJob();
                    stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, @"Local\" + Product + "-" + key + "-Stop");
                    stopEvent.Reset();
                    child = new Process(); child.StartInfo = info;
                    if (!child.Start()) throw new InvalidOperationException("无法启动 EMILIA 的专用运行环境。");
                    job.Assign(child);
                    child.OutputDataReceived += LogLine; child.ErrorDataReceived += LogLine;
                    child.BeginOutputReadLine(); child.BeginErrorReadLine();
                    tray = new NotifyIcon(); tray.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location) ?? SystemIcons.Application; tray.Text = DisplayName + " · 正在启动";
                    var menu = new ContextMenuStrip();
                    menu.Items.Add("打开 " + DisplayName, null, delegate { if (ready) OpenBrowser(url); });
                    menu.Items.Add("退出 " + DisplayName, null, delegate { ExitThread(); });
                    tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { if (ready) OpenBrowser(url); }; tray.Visible = true;
                    timer = new System.Windows.Forms.Timer(); timer.Interval = 350; timer.Tick += Tick; timer.Start();
                }
                catch
                {
                    if (job != null) job.Dispose();
                    if (timer != null) timer.Dispose();
                    if (tray != null) { tray.Visible = false; tray.Dispose(); }
                    if (stopEvent != null) stopEvent.Dispose();
                    if (child != null)
                    {
                        try { if (!child.HasExited) child.Kill(); child.WaitForExit(5000); } catch { }
                        child.Dispose();
                    }
                    throw;
                }
            }

            private void LogLine(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                lock (logLock) { try { File.AppendAllText(logPath, e.Data + Environment.NewLine, Encoding.UTF8); } catch { } }
            }

            private void Tick(object sender, EventArgs e)
            {
                if (closing) return;
                if (stopEvent.WaitOne(0)) { ExitThread(); return; }
                if (child.HasExited)
                {
                    timer.Stop();
                    if (!ready) MessageBox.Show("EMILIA 服务未能启动。请重新运行安装程序以修复文件。\n\n诊断日志：" + logPath, DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ExitThread(); return;
                }
                if (!ready && HealthMatches(url, instanceId))
                {
                    ready = true;
                    Native.WriteJson(statePath, new { url = url, port = new Uri(url).Port, pid = child.Id, instanceId = instanceId });
                    tray.Text = DisplayName + " · 正在运行";
                    if (!background)
                    {
                        try { OpenBrowser(url); }
                        catch { tray.ShowBalloonTip(7000, "EMILIA 已启动", "请从托盘菜单打开，或在浏览器访问 " + url, ToolTipIcon.Info); }
                    }
                }
                else if (!ready && (DateTime.UtcNow - started).TotalSeconds > 40)
                {
                    timer.Stop();
                    MessageBox.Show("EMILIA 启动超时。请从系统托盘退出后重新启动，或重新运行安装程序修复文件。", DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ExitThread();
                }
            }

            protected override void ExitThreadCore()
            {
                if (closing) return;
                closing = true; timer.Stop();
                tray.Visible = false;
                // Closing the job terminates every owned descendant, including workers
                // whose intermediate parent has already exited. No PID file is trusted.
                job.Dispose();
                try
                {
                    if (!child.HasExited)
                    {
                        child.WaitForExit(5000);
                    }
                }
                catch { }
                try
                {
                    Dictionary<string, object> state = Native.ReadJson(statePath);
                    if (Convert.ToString(state["instanceId"]) == instanceId) File.Delete(statePath);
                }
                catch { }
                tray.Dispose(); timer.Dispose(); stopEvent.Dispose(); child.Dispose();
                base.ExitThreadCore();
            }
        }

        private static int Uninstall(string root, string key)
        {
            if (MessageBox.Show("卸载 EMILIA 及本地模型？\n\n学习档案和 API 设置将保留。", "卸载 " + DisplayName, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return 0;
            RequireProductMarker(root, true); RejectReparseTree(root);
            try { using (EventWaitHandle stop = EventWaitHandle.OpenExisting(@"Local\" + Product + "-" + key + "-Stop")) stop.Set(); }
            catch (WaitHandleCannotBeOpenedException) { }
            bool created;
            using (Mutex mutex = new Mutex(false, @"Local\" + Product + "-" + key, out created))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(15000); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new InvalidOperationException("EMILIA 尚未退出。请从系统托盘退出后再次卸载。");
                mutex.ReleaseMutex();
            }
            string helperRoot = Path.Combine(Path.GetTempPath(), Product + "-uninstall-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(helperRoot);
            string helper = Path.Combine(helperRoot, "EmiliaRemove.exe");
            File.Copy(Assembly.GetExecutingAssembly().Location, helper);
            ProcessStartInfo start = new ProcessStartInfo(helper, "--remove-install " + Native.Quote(root) + " " + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
            start.WorkingDirectory = helperRoot; start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(start);
            return 0;
        }

        private static void RejectReparseTree(string directory)
        {
            RejectReparseAncestors(directory);
            foreach (string entry in Directory.EnumerateFileSystemEntries(directory))
            {
                FileAttributes attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("安装目录中存在符号链接或目录联接，请移除链接后重新卸载。");
                if ((attributes & FileAttributes.Directory) != 0 && !String.Equals(Path.GetFileName(entry), "user-data", StringComparison.OrdinalIgnoreCase)) RejectReparseTree(entry);
            }
        }

        private static int RemoveInstallation(string requestedRoot, int parentPid)
        {
            string root = Native.ValidateInstallRoot(requestedRoot, false);
            RequireProductMarker(root, true);
            // Waiting is safe even if the caller supplied an unrelated PID: no PID supplied to this helper is ever killed.
            try { using (Process parent = Process.GetProcessById(parentPid)) parent.WaitForExit(10000); } catch (ArgumentException) { }
            RejectReparseTree(root);
            bool retainedData = Directory.Exists(Path.Combine(root, "user-data"));
            if (retainedData) Native.WriteJson(Path.Combine(root, Native.RetainedDataMarker), new { product = Product, schemaVersion = 1 });
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                if (key != null && String.Equals(Convert.ToString(key.GetValue("InstallLocation")), root, StringComparison.OrdinalIgnoreCase))
                { key.Close(); Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); }
            }
            RemoveOurShortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), root);
            foreach (string menu in new string[] { DisplayName, "Emilia English Coach" })
            {
                string programsFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), menu);
                if (RemoveOurShortcut(programsFolder, root) && Directory.Exists(programsFolder) && Directory.GetFileSystemEntries(programsFolder).Length == 0)
                    Directory.Delete(programsFolder);
            }
            foreach (string entry in Directory.EnumerateFileSystemEntries(root))
            {
                if (String.Equals(Path.GetFileName(entry), "user-data", StringComparison.OrdinalIgnoreCase)) continue;
                if (retainedData && String.Equals(Path.GetFileName(entry), Native.RetainedDataMarker, StringComparison.OrdinalIgnoreCase)) continue;
                for (int attempt = 0; ; attempt++)
                {
                    try { if (Directory.Exists(entry)) Directory.Delete(entry, true); else File.Delete(entry); break; }
                    catch (IOException) { if (attempt >= 20) throw; Thread.Sleep(250); }
                }
            }
            if (Directory.GetFileSystemEntries(root).Length == 0) Directory.Delete(root);
            string self = Assembly.GetExecutingAssembly().Location;
            MoveFileEx(self, null, 4); MoveFileEx(Path.GetDirectoryName(self), null, 4);
            MessageBox.Show("EMILIA 已卸载。学习档案和 API 设置已保留。", DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        private static bool RemoveOurShortcut(string folder, string root)
        {
            // Read the shortcut's real target before touching a user-owned desktop/start-menu file.
            bool removed = false;
            foreach (string name in new string[] { DisplayName + ".lnk", "Emilia English Coach.lnk" })
            {
                string path = Path.Combine(folder, name);
                if (!File.Exists(path)) continue;
                object shell = null, shortcut = null;
                try
                {
                    RejectReparseAncestors(path);
                    Type type = Type.GetTypeFromProgID("WScript.Shell"); shell = Activator.CreateInstance(type);
                    shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
                    string target = Convert.ToString(shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
                    if (String.Equals(Path.GetFullPath(target), Path.Combine(root, "Emilia.exe"), StringComparison.OrdinalIgnoreCase)) { File.Delete(path); removed = true; }
                }
                catch { }
                finally { if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut); if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell); }
            }
            return removed;
        }
    }
}
