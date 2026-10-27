# 安装与环境

## 支持范围

- 在线安装版：Windows 10/11 x64，运行环境和模型由安装程序自动下载；无需预装 Node.js 或 Python。
- 从源码运行：Node.js 24、64 位 Python 3.13。
- 浏览器：支持麦克风和现代音频接口的 Edge/Chrome；音频自动播放受浏览器手势规则限制。
- 无第三方 npm 运行依赖。Python 语音/向量包按 requirements.txt 安装；它不是包含全部传递依赖哈希的锁文件。
- 安装程序自动检查 Microsoft Visual C++ 运行库；缺失时需要允许系统安装提示。自定义 Live2D SDK 与角色资源不在安装范围内。

推荐直接使用 Releases 中的 Setup EXE。首次安装下载约 2.4 GB，预留 8 GB 存储空间，推荐 16 GB 内存。安装后双击桌面入口，按首次引导保存 API 配置。安装器、修复和卸载说明见 [Windows 安装版](WINDOWS_INSTALLER.md)。

## 模型文件

运行 `python tools/setup_models.py` 只列出上游来源；显式加 `--download` 后才下载。需要时使用 `--only tts`、`--only asr` 或 `--only rag` 分别安装。

```text
runtime/tts/kokoro/kokoro-v1.0.onnx
runtime/tts/kokoro/voices/af_heart.bin
runtime/tts/kokoro/voices/af_sky.bin
runtime/tts/kokoro/voices/jf_alpha.bin
runtime/asr/large-v3-turbo/model.bin (+ config/tokenizer 等文件)
runtime/asr/base.en/model.bin (+ config/tokenizer 等文件)
runtime/rag/models/multilingual-e5-small-int8/tokenizer.json
runtime/rag/models/multilingual-e5-small-int8/onnx/model_int8.onnx
```

Kokoro 默认组合使用上面三种上游 voice embedding，不附个人音频样本，也不进行用户声线克隆。`kokoro-onnx`/`espeakng-loader` 负责音素运行依赖；如果检测不到 eSpeak，可自行安装有授权的 eSpeak NG，并设置 IELTS_ESPEAK_ROOT 指向包含 espeak-ng.dll 与 espeak-ng-data 的目录。参见上游文档，勿复制来源不明的 DLL。

长文本发音体检使用 base.en 模型。完整 `--download` 或 `--only asr` 会同时安装；也可单独执行 `--download --only pronunciation`。发音分析从本地路径加载模型。

## 配置

`.env` 由 `npm start` 加载；不应提交到 Git。直接 `node server.mjs` 不加载该文件。API 密钥在网页「模型设置」输入，由 Windows 当前用户 DPAPI 加密保存，不放入 .env.example。

源码服务默认端口 4317，ASR 端口 4431；同时运行多份源码实例时分别修改 IELTS_DEMO_PORT 与 IELTS_ASR_PORT。安装版启动器自动分配本机端口，使用自己的运行环境和用户档案目录；请通过桌面入口启动，勿直接打开 HTML 文件。

## GPU 进阶

默认 IELTS_ASR_DEVICE=cpu、IELTS_ASR_COMPUTE_TYPE=int8、IELTS_TTS_GPU=0。使用 NVIDIA GPU 时，可设置 ASR 为 cuda/float16，并按 faster-whisper 文档安装匹配的 CUDA/cuDNN。Kokoro 的独立 GPU 运行目录通过 IELTS_KOKORO_GPU_ROOT 指定，DLL 根目录由 IELTS_ASR_CUDA_ROOT 指定。

GPU 配置需要与显卡驱动和推理运行时匹配。安装完成后，应先验证识别和合成，再进行性能测试。

## 常见问题

- 页面能开但没有语音：先 `npm run doctor`；检查模型路径、Python 依赖及浏览器音频权限。
- 没有模型列表：先填写正确地址和自己的密钥；还可手填模型 ID。列表权限与聊天权限可能不同。
- 余额不足或 401：修正账号或密钥；重复点击不会解决，不应连续重试。
- 刚启动较慢：本地语音与识别需要预热；CPU 的大型识别模型尤其明显。
- 无法识别：确认 ASR 模型已下载、端口未占用、所选计算设备依赖齐全。
- 看到上次聊天恢复：明确选继续或放弃；不会自动重播过去的回答。
