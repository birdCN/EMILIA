import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,copyFile,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
const python=process.env.EMILIA_TEST_PYTHON;
if(!python){console.log(JSON.stringify({ok:true,shutdownHelpers:'skipped; set EMILIA_TEST_PYTHON to a Python executable'}));process.exit(0);}
const root=fileURLToPath(new URL('..',import.meta.url)),fixture=await mkdtemp(join(tmpdir(),'emilia-owned-helpers-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
let child,closed,control,controlClosed,lease;const owned=[];let logs='';const requests=[];
const bootstrap=String.raw`
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const original=cp.spawn;cp.spawn=(file,args,options)=>{const child=original(file,args,options);if(file===process.env.IELTS_PYTHON_PATH&&child.pid)process.send({kind:'owned-python',pid:child.pid,args});return child;};syncBuiltinESMExports();
await import('./server.mjs');
`;
try{
 await mkdir(join(fixture,'public'));for(const name of await readdir(root))if(name.endsWith('.mjs')||name==='package.json')await copyFile(join(root,name),join(fixture,name));
 for(const name of await readdir(join(root,'public')))if(/\.(js|html|css)$/.test(name))await copyFile(join(root,'public',name),join(fixture,'public',name));
 await mkdir(join(fixture,'tools'));await mkdir(join(fixture,'runtime/asr'),{recursive:true});await mkdir(join(fixture,'runtime/asr-temp'));await mkdir(join(fixture,'learner'));
 await writeFile(join(fixture,'runtime/asr-temp/unrelated.wav'),'foreign file must remain');await writeFile(join(fixture,'learner/retained.txt'),'synthetic learning record');
 const stub='import json, pathlib, sys, time\nif pathlib.Path(sys.argv[0]).name == "kokoro_local_tts.py":\n    print(json.dumps({"type":"ready","providers":["CPUExecutionProvider"]}), flush=True)\ntime.sleep(60)\n';
 for(const name of ['transcribe_local.py','analyze_pronunciation.py','kokoro_local_tts.py'])await writeFile(join(fixture,'tools',name),stub);
 control=spawn(python,['-I','-c','import time; time.sleep(60)'],{windowsHide:true,stdio:'ignore'});controlClosed=new Promise(r=>control.once('exit',r));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['--input-type=module','-e',bootstrap],{cwd:fixture,windowsHide:true,env:{...process.env,IELTS_DEMO_PORT:String(port),IELTS_SKIP_WARMUP:'0',IELTS_PYTHON_PATH:python,EMILIA_BROWSER_STARTUP_GRACE_MS:'0',IELTS_RUNTIME_ROOT:join(fixture,'runtime'),IELTS_LEARNER_DATA_ROOT:join(fixture,'learner'),IELTS_MODEL_CONFIG_PATH:join(fixture,'settings.json')},stdio:['ignore','pipe','pipe','ipc']});closed=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));child.on('message',m=>{if(m.kind==='owned-python')owned.push(m);});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await sleep(50);}assert.ok(ready,logs);
 const headers={'X-Emilia-Settings':'1','Content-Type':'application/json'},config=await(await fetch(origin+'/api/model/settings',{headers})).json();
 assert.equal((await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify({...config,mode:'api',provider:'custom',protocol:'openai',baseUrl:'http://127.0.0.1:1',model:'synthetic-keep',apiKey:''})})).status,200);const settings=await readFile(join(fixture,'settings.json'));
 lease=new AbortController();const response=await fetch(origin+'/api/app/connection',{method:'POST',headers:{'X-Emilia-Lifecycle':'1'},signal:lease.signal});assert.equal(response.status,200);await response.body.getReader().read();
 const audio=Buffer.alloc(64);audio.write('RIFF');const passage=await(await fetch(origin+'/api/pronunciation/passage')).json();
 for(const endpoint of ['/api/transcribe','/api/pronunciation/analyze?passageId='+passage.passage.id])requests.push(fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'audio/wav'},body:audio}).then(r=>r.arrayBuffer()).catch(()=>{}));
 for(let i=0;i<100&&owned.length<4;i++)await sleep(25);assert.equal(owned.length,4,'warmup, Kokoro, transcription, pronunciation all started');
 const wavs=owned.flatMap(item=>item.args.filter(arg=>arg.endsWith('.wav')));assert.equal(wavs.length,2);for(const wav of wavs)await access(wav);
 const started=Date.now();lease.abort();let deadline;const exit=await Promise.race([closed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Backend shutdown stalled: '+logs)),9000);})]);clearTimeout(deadline);assert.equal(exit.code,0,logs);
 assert.ok(owned.every(item=>!alive(item.pid)),'every helper created by this instance must exit before Node');for(const wav of wavs)await assert.rejects(access(wav));
 assert.equal(alive(control.pid),true,'unrelated process using the same Python must survive');assert.deepEqual(await readFile(join(fixture,'settings.json')),settings);assert.equal(await readFile(join(fixture,'learner/retained.txt'),'utf8'),'synthetic learning record');assert.equal(await readFile(join(fixture,'runtime/asr-temp/unrelated.wav'),'utf8'),'foreign file must remain');
 await Promise.all(requests);console.log(JSON.stringify({ok:true,ownedHelpersStopped:owned.length,ownRecordingsRemoved:wavs.length,unrelatedPythonPreserved:true,settingsPreserved:true,foreignTempPreserved:true,shutdownMs:Date.now()-started,exit}));
}finally{
 lease?.abort();if(child&&child.exitCode===null&&!child.killed){child.kill();await closed;}
 // Test cleanup uses only PIDs received directly from this fixture's spawn hook.
 for(const item of owned)if(alive(item.pid))try{process.kill(item.pid,'SIGKILL');}catch{}
 if(control&&control.exitCode===null&&!control.killed){control.kill();await controlClosed;}
 await Promise.all(requests);assert.ok(resolve(fixture).startsWith(resolve(tmpdir())+sep));await rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
