import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';

const source=fileURLToPath(new URL('..',import.meta.url));
const fixture=await mkdtemp(join(tmpdir(),'emilia-grounded-cancel-'));
const reply='How did your speech go?';
let child;
const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  if(body.messages[0].content.includes('output only the English words')){
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:reply}}]})}\n\ndata: [DONE]\n\n`);
  }
  // Keep late metadata pending so cancellation happens after speech delivery.
});
try {
  await mkdir(join(fixture,'public'),{recursive:true});
  for(const file of await readdir(source))if(file.endsWith('.mjs'))await copyFile(join(source,file),join(fixture,file));
  for(const file of await readdir(join(source,'public')))if(/\.(js|html|css)$/.test(file))await copyFile(join(source,'public',file),join(fixture,'public',file));
  const cache=join(fixture,'public','assets','voice','emilia-kokoro-a');await mkdir(cache,{recursive:true});
  const hash=createHash('sha256').update(`kokoro-v1:emilia_timbre_a:0.91:0.4\n${reply}`).digest('hex').slice(0,24);
  await writeFile(join(cache,hash+'.wav'),Buffer.alloc(1200));
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...process.env,IELTS_DEMO_PORT:String(port),IELTS_SKIP_WARMUP:'1',IELTS_RUNTIME_ROOT:join(fixture,'runtime'),IELTS_LEARNER_DATA_ROOT:join(fixture,'learner'),IELTS_MODEL_CONFIG_PATH:join(fixture,'private','settings.json')},stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stdout.on('data',x=>diagnostics+=x);child.stderr.on('data',x=>diagnostics+=x);
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.ok(ready,diagnostics);
  const headers={'Content-Type':'application/json','X-Emilia-Settings':'1'};
  const saved=await(await fetch(origin+'/api/model/settings',{headers})).json();
  assert.equal((await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify({...saved,mode:'api',provider:'custom',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,model:'fixture',apiKey:''})})).status,200);
  for(const [name,text]of [['grounded','I gave a speech yesterday.'],['ordinary','I went hiking yesterday.']]){
    const sessionId=`${name}_cancellation_fixture`;
    const controller=new AbortController();
    const response=await fetch(origin+'/api/codex/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({sessionId,text,mode:'casual',translation:false,sentenceVoice:true,progressiveVoice:true}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',speech;
    while(!speech){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line){const event=JSON.parse(line);if(event.type==='speech')speech=event;}}
    assert.equal(speech?.reply.en,reply,'complete question reply must be delivered before cancellation');
    controller.abort();await reader.cancel().catch(()=>{});
    let recovery;
    for(let i=0;i<60;i++){
      const profile=await(await fetch(origin+'/api/learner/profile?sessionId='+sessionId)).json();recovery=profile.recoverableChat;
      if(recovery?.turnCount===1)break;
      await new Promise(r=>setTimeout(r,30));
    }
    assert.equal(recovery?.turnCount,1,name+' delivered reply must remain recoverable after disconnect');
  }
  console.log('PASS: grounded and ordinary complete spoken replies remain recoverable when late metadata is interrupted');
} finally {
  if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  mock.closeAllConnections();await new Promise(r=>mock.close(r));
  await rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
