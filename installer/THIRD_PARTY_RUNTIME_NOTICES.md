# Windows online installer: third-party runtime notices

The application source is licensed under the project's MIT license. Third-party runtimes, Python packages, native libraries and model weights retain their own licenses. The bootstrap EXE contains application source and download metadata; it downloads unmodified runtime, wheel and model files directly from the linked upstream sources. It does not bundle those external binaries.

The installer retains the runtime archives' license files, wheel `.dist-info` metadata/licenses, package-local notices and downloaded model cards. Do not remove those files when repackaging an installed copy. The SHA-256 and exact upstream revisions are recorded in `artifacts.json`.

## Runtimes and native libraries

| Component | License / source |
|---|---|
| Node.js 24.22.1 x64 | MIT and bundled third-party licenses; retain `runtime/node/LICENSE`. [Official source and licenses](https://github.com/nodejs/node/tree/v24.22.1) |
| CPython 3.13.17 embeddable x64 | PSF License Agreement and bundled-library notices; retain `runtime/python/LICENSE.txt`. [Release](https://www.python.org/downloads/release/python-31317/), [source license](https://docs.python.org/3.13/license.html) |
| Microsoft Visual C++ x64 Redistributable | Microsoft's separate license applies. The installer downloads Microsoft's signed official package and invokes it only if needed. Installation can require Windows administrator approval. [Official package and terms](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) |
| eSpeak NG native DLL/data in espeakng-loader | eSpeak NG is GPL-3.0-or-later; the loader project is MIT. [eSpeak NG source and COPYING](https://github.com/espeak-ng/espeak-ng), [loader and build scripts](https://github.com/thewh1teagle/espeakng-loader). The loader wheel does not include a license file; this notice links the upstream licenses explicitly. |
| phonemizer | GPL-3.0-or-later; full license remains in the installed wheel's `.dist-info/licenses/LICENSE`. [Source](https://github.com/bootphon/phonemizer) |
| SoundFile native libsndfile | LGPL-2.1-or-later; preserve `_soundfile_data/COPYING` and `licensing/license_notes.md`. [libsndfile source](https://github.com/libsndfile/libsndfile) |
| PyAV and FFmpeg dependencies | PyAV is BSD-3-Clause; its wheel also contains FFmpeg, libx264/libx265 and other native codec libraries under their own licenses, including GPL/LGPL. [PyAV source](https://github.com/PyAV-Org/PyAV), [FFmpeg source and licensing](https://ffmpeg.org/legal.html), [PyAV wheel build recipes](https://github.com/PyAV-Org/pyav-wheels) |
| CTranslate2 and bundled native dependencies | CTranslate2 MIT, Intel OpenMP and NVIDIA cuDNN retain their separate redistribution terms. CPU operation requires no CUDA installation; installing the wheel preserves the upstream package unchanged. [CTranslate2 source](https://github.com/OpenNMT/CTranslate2), [Intel runtime terms](https://www.intel.com/content/www/us/en/developer/articles/license/end-user-license-agreement.html), [NVIDIA cuDNN license](https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html) |
| NumPy / OpenBLAS | NumPy BSD and bundled notices, OpenBLAS BSD and Microsoft runtime terms. Retain all NumPy wheel notices. [Source](https://github.com/numpy/numpy) |
| ONNX Runtime | MIT and `onnxruntime/ThirdPartyNotices.txt`. [Source](https://github.com/microsoft/onnxruntime) |

A locally installed copy includes GPL/LGPL components and is not an MIT-only binary bundle. If redistributing installed binaries, retain copyright and license notices and provide the corresponding source/build materials and any required installation information or source offer under the relevant GPL/LGPL terms. Upstream download links by themselves are not a substitute for the distributor's obligations. This online bootstrap does not claim an exemption or relicense external components.

ONNX Runtime requires `MSVCP140.dll` and `MSVCP140_1.dll`; CTranslate2 and eSpeak NG require `MSVCP140.dll`. Python's archive supplies `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll`. The official VC Redistributable supplies the remaining runtime libraries.

## Model weights and voice embeddings

| Artifact | Source / license |
|---|---|
| Kokoro v1.0 ONNX | [Official converted weights](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1), [original model card](https://huggingface.co/hexgrad/Kokoro-82M): Apache-2.0 |
| `jf_alpha`, `af_heart`, `af_sky` voices | [ONNX Community source and model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX): Apache-2.0; preserve voice attribution/source information in the model card |
| large-v3-turbo ASR | [Dropbox converted Whisper model](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo), [original Whisper](https://github.com/openai/whisper): MIT |
| base.en pronunciation ASR | [SYSTRAN converted Whisper model](https://huggingface.co/Systran/faster-whisper-base.en), [original Whisper](https://github.com/openai/whisper): MIT |
| multilingual-e5-small int8 ONNX | [Xenova conversion](https://huggingface.co/Xenova/multilingual-e5-small), [original model](https://huggingface.co/intfloat/multilingual-e5-small): MIT |

Hugging Face URLs pin immutable repository commits. `hf-mirror.com` is an optional third-party transport fallback; every file must match the same upstream SHA-256 and size. Large Git LFS files use upstream LFS SHA-256 metadata. Small repository files are downloaded and hashed by the maintainer resolver. GitHub Kokoro uses the release asset's published SHA-256.

Kokoro's primary URL remains the official GitHub release. Optional fallback transport uses the community-hosted [kanirudh/kokoro-82m-onnx](https://huggingface.co/kanirudh/kokoro-82m-onnx/tree/be37f7d55632acf0b6b4a17eb4cf673c06dcebed) repository at commit `be37f7d55632acf0b6b4a17eb4cf673c06dcebed`, then the same pinned path on `hf-mirror.com`. This uploader is independent of the original Kokoro export author. The resolver verifies that the pinned HF LFS metadata matches GitHub's exact 325,505,369-byte asset and SHA-256 `beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a`; the installer applies that same integrity check after downloading through any fallback.

## Resolved Python wheel inventory

This table reports top-level wheel metadata; bundled native libraries can have additional licenses as described above. Full retained license files take precedence over these short labels.

| Package | Version | Metadata license | Upstream package |
|---|---|---|---|
| aiohappyeyeballs | 2.7.1 | PSF-2.0 | [PyPI](https://pypi.org/project/aiohappyeyeballs/2.7.1/) |
| aiohttp | 3.14.5 | Apache-2.0 AND MIT | [PyPI](https://pypi.org/project/aiohttp/3.14.5/) |
| aiosignal | 1.4.0 | Apache 2.0 | [PyPI](https://pypi.org/project/aiosignal/1.4.0/) |
| anyio | 4.15.1 | MIT | [PyPI](https://pypi.org/project/anyio/4.15.1/) |
| attrs | 26.1.0 | MIT | [PyPI](https://pypi.org/project/attrs/26.1.0/) |
| av | 18.1.0 | BSD-3-Clause | [PyPI](https://pypi.org/project/av/18.1.0/) |
| certifi | 2026.10.19 | MPL-2.0 | [PyPI](https://pypi.org/project/certifi/2026.10.19/) |
| cffi | 2.1.1 | MIT-0 | [PyPI](https://pypi.org/project/cffi/2.1.1/) |
| charset-normalizer | 3.5.2 | MIT | [PyPI](https://pypi.org/project/charset-normalizer/3.5.2/) |
| click | 8.5.0 | BSD-3-Clause | [PyPI](https://pypi.org/project/click/8.5.0/) |
| cloudpickle | 3.1.2 | BSD-3-Clause | [PyPI](https://pypi.org/project/cloudpickle/3.1.2/) |
| colorama | 0.4.6 | BSD License | [PyPI](https://pypi.org/project/colorama/0.4.6/) |
| ctranslate2 | 4.8.3 | MIT | [PyPI](https://pypi.org/project/ctranslate2/4.8.3/) |
| dlinfo | 2.0.0 | MIT | [PyPI](https://pypi.org/project/dlinfo/2.0.0/) |
| edge-tts | 7.3.1 | GNU Lesser General Public License v3 (LGPLv3) | [PyPI](https://pypi.org/project/edge-tts/7.3.1/) |
| espeakng-loader | 0.2.4 | Loader: MIT; bundled eSpeak NG: GPL-3.0-or-later | [PyPI](https://pypi.org/project/espeakng-loader/0.2.4/) |
| faster-whisper | 1.2.1 | MIT | [PyPI](https://pypi.org/project/faster-whisper/1.2.1/) |
| filelock | 4.2.4 | MIT | [PyPI](https://pypi.org/project/filelock/4.2.4/) |
| flatbuffers | 25.12.19 | Apache 2.0 | [PyPI](https://pypi.org/project/flatbuffers/25.12.19/) |
| frozenlist | 1.8.0 | Apache-2.0 | [PyPI](https://pypi.org/project/frozenlist/1.8.0/) |
| fsspec | 2026.9.0 | BSD-3-Clause | [PyPI](https://pypi.org/project/fsspec/2026.9.0/) |
| h11 | 0.16.0 | MIT | [PyPI](https://pypi.org/project/h11/0.16.0/) |
| hf-xet | 1.7.0 | Apache-2.0 | [PyPI](https://pypi.org/project/hf-xet/1.7.0/) |
| httpcore | 1.0.9 | BSD-3-Clause | [PyPI](https://pypi.org/project/httpcore/1.0.9/) |
| httpx | 0.28.1 | BSD-3-Clause | [PyPI](https://pypi.org/project/httpx/0.28.1/) |
| huggingface_hub | 1.30.0 | Apache-2.0 | [PyPI](https://pypi.org/project/huggingface_hub/1.30.0/) |
| idna | 3.20 | BSD-3-Clause | [PyPI](https://pypi.org/project/idna/3.20/) |
| joblib | 1.6.0 | BSD-3-Clause | [PyPI](https://pypi.org/project/joblib/1.6.0/) |
| kokoro-onnx | 0.6.1 | MIT (upstream project) | [PyPI](https://pypi.org/project/kokoro-onnx/0.6.1/) |
| multidict | 7.1.0 | Apache-2.0 | [PyPI](https://pypi.org/project/multidict/7.1.0/) |
| numpy | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | [PyPI](https://pypi.org/project/numpy/2.4.6/) |
| onnxruntime | 1.29.0 | MIT License | [PyPI](https://pypi.org/project/onnxruntime/1.29.0/) |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | [PyPI](https://pypi.org/project/packaging/26.3/) |
| phonemizer | 3.4.0 | GPL-3.0-or-later | [PyPI](https://pypi.org/project/phonemizer/3.4.0/) |
| propcache | 0.5.4 | Apache-2.0 | [PyPI](https://pypi.org/project/propcache/0.5.4/) |
| protobuf | 7.36.2 | 3-Clause BSD License | [PyPI](https://pypi.org/project/protobuf/7.36.2/) |
| pycparser | 3.12 | BSD-3-Clause | [PyPI](https://pypi.org/project/pycparser/3.12/) |
| PyYAML | 6.0.3 | MIT | [PyPI](https://pypi.org/project/PyYAML/6.0.3/) |
| requests | 2.34.2 | Apache-2.0 | [PyPI](https://pypi.org/project/requests/2.34.2/) |
| soundfile | 0.14.0 | BSD 3-Clause License | [PyPI](https://pypi.org/project/soundfile/0.14.0/) |
| tabulate | 0.10.0 | MIT | [PyPI](https://pypi.org/project/tabulate/0.10.0/) |
| tokenizers | 0.23.2 | Apache Software License | [PyPI](https://pypi.org/project/tokenizers/0.23.2/) |
| tqdm | 4.70.1 | MPL-2.0 AND MIT | [PyPI](https://pypi.org/project/tqdm/4.70.1/) |
| typing_extensions | 4.16.0 | PSF-2.0 | [PyPI](https://pypi.org/project/typing_extensions/4.16.0/) |
| urllib3 | 2.8.0 | MIT | [PyPI](https://pypi.org/project/urllib3/2.8.0/) |
| yarl | 1.25.1 | Apache-2.0 | [PyPI](https://pypi.org/project/yarl/1.25.1/) |
