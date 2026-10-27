# 第三方组件与素材

第三方依赖、模型权重、系统组件和角色素材分别遵守其原许可证。模型、DLL 和 Live2D/Cubism SDK 需从相应上游单独获取。

| 组件 | 上游与许可说明 |
|---|---|
| kokoro-onnx | [项目与 MIT 许可](https://github.com/thewh1teagle/kokoro-onnx)，Python 推理封装 |
| Kokoro-82M | [原模型](https://huggingface.co/hexgrad/Kokoro-82M)，模型卡列为 Apache-2.0 |
| ONNX voice embeddings | [ONNX Community 模型与 voices](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)，模型页列为 Apache-2.0；请同时查看原模型对声音来源的说明 |
| faster-whisper | [上游 MIT 许可](https://github.com/SYSTRAN/faster-whisper)；CTranslate2 与其他依赖各有许可 |
| Whisper large-v3-turbo 转换 | [dropbox-dash 转换模型](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo)，模型页列为 MIT；保留上游声明 |
| multilingual-e5-small | [原模型](https://huggingface.co/intfloat/multilingual-e5-small) 列为 MIT；[Xenova ONNX 转换](https://huggingface.co/Xenova/multilingual-e5-small) 的文件另行下载 |
| ONNX Runtime、NumPy、SoundFile、tokenizers 等 | 由 requirements.txt 安装，依赖文件内的原许可继续适用 |
| eSpeak NG / phonemizer 及 loader | 音素与系统依赖，须查看其各自许可；包含 GPL 组件，不能把项目 MIT 声明当成其再分发许可。此包不含 eSpeak DLL/数据文件 |
| 人物表演脚本 | `public/assets/emilia-performance-v4.js`、配套运行页与 `emilia-face-library.js` 恢复原有表情、口型与动作；不依赖 Live2D/Cubism SDK |
| 爱蜜莉亚人物图片与卧室背景 | 人物与场景图片位于 `public/assets/avatar-v3/` 和 `public/assets/room/`。这些素材的使用、对外发布及再分发条件独立于源码 MIT 许可，应按素材的实际来源与授权范围处理；本说明不作额外权利授予 |

添加 Live2D 模型、人物图、背景图、字体或声音资源时，应记录来源、许可证及分发条件。
