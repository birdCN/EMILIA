"""Optional isolated CUDA runtime for Kokoro; never changes the ASR environment."""
import os
from pathlib import Path
import sys

GPU_ROOT=Path(os.environ.get('IELTS_KOKORO_GPU_ROOT',str(Path(__file__).resolve().parents[1]/'runtime'/'optional-gpu'/'kokoro')))
DLL_HANDLES=[]
def configure():
    if os.environ.get('IELTS_TTS_GPU') == '0' or not (GPU_ROOT/'onnxruntime').is_dir():
        return False
    sys.path.insert(0,str(GPU_ROOT))
    roots=[GPU_ROOT/'nvidia',Path(os.environ.get('IELTS_ASR_CUDA_ROOT',str(Path(__file__).resolve().parents[1]/'runtime'/'optional-gpu'/'asr-cuda')))/'nvidia']
    paths=sorted({dll.parent for root in roots for dll in root.rglob('*.dll')})
    for path in paths:
        DLL_HANDLES.append(os.add_dll_directory(str(path)))
    os.environ['PATH']=os.pathsep.join(map(str,paths))+os.pathsep+os.environ.get('PATH','')
    return True
