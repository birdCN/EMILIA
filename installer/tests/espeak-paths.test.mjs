import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const tools=fileURLToPath(new URL('../../tools/',import.meta.url));
const pythons=JSON.parse(process.env.EMILIA_ESPEAK_TEST_PYTHONS||'[]');
const script=String.raw`
import json, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from espeak_paths import espeak_runtime
from kokoro_onnx.tokenizer import Tokenizer
import phonemizer.backend.espeak.wrapper as wrapper
cwd=Path.cwd()
original=wrapper.EspeakAPI
for index in range(2):
    with espeak_runtime() as config:
        tokenizer=Tokenizer(config)
        phonemes=tokenizer.phonemize("Hello Emilia. I would like to practice English today.","en-us")
        assert len(tokenizer.tokenize(phonemes)) > 10
    assert Path.cwd() == cwd
    assert wrapper.EspeakAPI is original
try:
    with espeak_runtime():
        raise ValueError("synthetic failure")
except ValueError:
    pass
assert Path.cwd() == cwd
assert wrapper.EspeakAPI is original
print(json.dumps({"ok":True,"prefix":sys.prefix,"tokens":len(tokenizer.tokenize(phonemes))},ensure_ascii=True))
`;

test('real eSpeak phonemization restores its process state in configured private runtimes',{skip:!pythons.length},()=>{
  for(const python of pythons){
    assert.ok(path.isAbsolute(python));
    const result=spawnSync(python,['-I','-c',script,tools],{cwd:tools,env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).ok,true);
  }
});
