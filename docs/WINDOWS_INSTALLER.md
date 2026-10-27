# Windows 安装版

## 安装

支持 Windows 10/11 x64。首次安装需要联网下载约 2.4 GB，预留至少 8 GB 空间。建议 16 GB 内存；默认使用 CPU，无需 NVIDIA 显卡或 CUDA。

双击 Releases 中的 `EMILIA-1.3.4-Setup-x64.exe`，选择安装目录并阅读许可条款。安装程序下载经过大小和 SHA-256 校验的 Node.js、Python、语音识别、语音合成和语义检索模型。完成前会实际加载本地模型进行检查。下载失败后可以重新运行继续；校验不通过的文件会重新下载。原生运行环境下载优先使用系统代理；代理或传输失败后尝试直连，并独立限制连接、读取空闲和每次尝试时长。安装程序不会修改系统代理设置。Node.js 下载使用已核对相同 SHA-256 的阿里云镜像并保留官方地址作为回退；部分 Python 依赖也有同样校验的备用源，见下载清单。

Microsoft Visual C++ 运行库缺失时会出现 Windows 管理员确认提示。取消该提示会停止安装，不会留下成功标记。安装包未进行代码签名，请从可信发布页下载并核对校验和。

## 首次使用

打开桌面或开始菜单中的 EMILIA。首次页面引导选择服务商、填写模型 ID 和 API Key。保存设置本身不调用收费接口；练习中的模型请求由服务商计费。密钥经 Windows 当前用户加密保存，不能直接复制给另一位 Windows 用户使用。

程序通过系统默认浏览器显示页面，在系统托盘运行。最后一个 EMILIA 页面关闭后约 5 秒，服务、托盘及本次启动的模型进程会退出；刷新、设置页跳转及其他仍打开的 EMILIA 标签页会继续保活。后台标签页不会因计时而过期。也可使用托盘菜单「退出 EMILIA」。不要直接双击网页 HTML 文件。

## 数据位置

| 内容 | 默认位置 |
|---|---|
| 程序、私有运行环境和本地模型 | `%LOCALAPPDATA%\Programs\EmiliaEnglishCoach` |
| 学习档案、记忆、加密接口设置 | `%LOCALAPPDATA%\EmiliaEnglishCoach\UserData` |
| 下载缓存 | `%LOCALAPPDATA%\EmiliaEnglishCoach\DownloadCache` |

通过 Windows「已安装的应用」卸载。卸载保留用户数据；彻底删除前请先退出应用，再自行删除上表中的用户数据及下载缓存目录。安装目录还包含运行日志、临时文件与音频缓存，不能直接当作纯净源码上传。

重新安装前先从托盘退出应用。重新运行安装程序并选原目录，可以重新下载或修复程序和模型；不会覆盖独立用户数据目录。

便携模式卸载后，`user-data` 与 `.emilia-user-data.json` 会保留，后者用于识别可重装的应用目录。请一起保留，并使用相同的便携模式选项重装。自定义数据目录及其中的 `learner`、`private` 子目录不能与待卸载的程序文件重叠，也不能通过目录联接指向其他位置。

## 开发者构建

在 Windows 使用系统 .NET Framework C# 编译器构建，不依赖 Inno Setup 或额外 .NET SDK：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer/build.ps1
```

产物位于 `dist/`。构建只将项目源码、原生启动器、下载清单和许可说明放入 EXE；模型和第三方运行环境从上游下载。语音组件通过受控的本机路径适配支持中文和空格目录，不需要改动系统区域设置或启用短文件名。

固定版本及哈希见 `installer/artifacts.json`，依赖许可见 [运行组件说明](../installer/THIRD_PARTY_RUNTIME_NOTICES.md)。重新解析上游依赖是维护操作，不属于用户安装步骤。

安装器支持以下自动化参数：

```text
--dir PATH        安装到空目录或已有 Emilia 目录
--cache PATH      下载缓存目录
--no-launch       安装后不启动
--portable        不创建快捷方式或注册卸载项，用户数据存于安装目录/user-data
--quiet           无安装窗口；Microsoft 运行库缺失时明确失败，需先运行图形安装
```

启动器支持 `--background`（不打开浏览器）、`--data-dir PATH`（独立用户档案）和 `--uninstall`。自定义档案应位于安装目录之外；若需要放在安装目录内，只能使用保留的 `user-data` 文件夹。

## 新环境验收

推荐在启用网络的 Windows Sandbox 或干净 Windows 虚拟机内运行安装器。沙盒中不应安装 Node.js、Python、CUDA，也不应映射个人用户目录。完整验收应包括：安装下载、模型检查、首次配置、文本对话、录音识别、声音播放、退出重开和卸载。

仓库自动化检查使用合成数据和本地模拟模型接口；本地模型检查执行真实推理。它们不能替代不同 Windows 版本、硬件和网络条件上的虚拟机与实机验收。

启用 Windows Sandbox 后，可生成一个只映射安装文件的沙盒入口；不会映射个人用户目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer/Create-SandboxTest.ps1
```

双击输出的 `.wsb` 文件开始。Sandbox 的虚拟硬件性能与宿主机不同，麦克风测试需要另外允许音频输入。

```powershell
npm test
node --test installer/tests/*.test.mjs
# 对已安装且已退出的副本执行本地合成语音、识别、配置加密和模拟接口检查：
node installer/tests/installed-smoke.mjs "C:\path\to\EmiliaEnglishCoach"
```

卸载对话框测试默认跳过。需在专用测试桌面或沙盒中显式设置 `EMILIA_TEST_NATIVE_DIALOGS=1` 后运行 `node installer/tests/uninstall.test.mjs`；该测试会显示 Windows 确认与完成窗口。
