import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PROJECT_ROOT,PYTHON_EXECUTABLE} from '../local-paths.mjs';
if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or newer is required.');
const checks=[['Python environment',PYTHON_EXECUTABLE],['Kokoro ONNX','runtime/tts/kokoro/kokoro-v1.0.onnx'],['Voice jf_alpha','runtime/tts/kokoro/voices/jf_alpha.bin'],['Voice af_heart','runtime/tts/kokoro/voices/af_heart.bin'],['Voice af_sky','runtime/tts/kokoro/voices/af_sky.bin'],['Whisper turbo','runtime/asr/large-v3-turbo/model.bin'],['Pronunciation ASR','runtime/asr/base.en/model.bin'],['E5 tokenizer','runtime/rag/models/multilingual-e5-small-int8/tokenizer.json'],['E5 ONNX','runtime/rag/models/multilingual-e5-small-int8/onnx/model_int8.onnx']];
let missing=0;
for(const [label,file] of checks){const found=existsSync(file===PYTHON_EXECUTABLE?file:join(PROJECT_ROOT,file));console.log(`${found?'OK':'MISSING'} ${label}`);if(!found)missing++;}
if(existsSync(PYTHON_EXECUTABLE)){const r=spawnSync(PYTHON_EXECUTABLE,['-c','import numpy,soundfile,onnxruntime,kokoro_onnx,faster_whisper,tokenizers; print("Python imports OK")'],{encoding:'utf8',windowsHide:true});if(r.status!==0){missing++;console.log('MISSING Python packages; install requirements.txt');}else console.log(r.stdout.trim());}
console.log('No credentials were read or sent. This check does not call a model provider.');
if(missing){console.log('See README.md and docs/SETUP.md. Model files are intentionally excluded from the release.');process.exitCode=1;}
