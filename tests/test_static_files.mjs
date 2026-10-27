import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';

const source=fileURLToPath(new URL('..',import.meta.url));
const fixture=await mkdtemp(join(tmpdir(),'emilia-static-'));
let child;
try {
  await mkdir(join(fixture,'public','assets','nested'),{recursive:true});
  await mkdir(join(fixture,'public-private'));
  await writeFile(join(fixture,'public','assets','hello.txt'),'public fixture');
  await writeFile(join(fixture,'public-private','secret.txt'),'synthetic private fixture');
  for(const file of await readdir(source))if(file.endsWith('.mjs'))await copyFile(join(source,file),join(fixture,file));
  for(const file of await readdir(join(source,'public')))if(/\.(js|html|css)$/.test(file))await copyFile(join(source,'public',file),join(fixture,'public',file));
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...process.env,IELTS_DEMO_PORT:String(port),IELTS_SKIP_WARMUP:'1',IELTS_RUNTIME_ROOT:join(fixture,'runtime'),IELTS_LEARNER_DATA_ROOT:join(fixture,'learner'),IELTS_MODEL_CONFIG_PATH:join(fixture,'private','settings.json')},stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stdout.on('data',x=>diagnostics+=x);child.stderr.on('data',x=>diagnostics+=x);
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.ok(ready,diagnostics);
  assert.equal(await (await fetch(origin+'/assets/hello.txt')).text(),'public fixture');
  // A Windows absolute path can otherwise pass a simple string-prefix check.
  const escaped=await fetch(origin+'/'+encodeURIComponent(join(fixture,'public-private','secret.txt')));
  assert.equal(escaped.status,404,'a sibling whose name starts with public must remain private');
  await escaped.text();
  for(const route of ['/assets/','/assets/nested/','/missing.txt']){
    const response=await fetch(origin+route);
    assert.equal(response.status,404,route+' must not be streamed as a file');
    await response.text();
    assert.equal((await fetch(origin+'/api/health')).status,200,'invalid static request must not stop the service');
  }
  console.log('PASS: static files served; directories, missing files and absolute sibling paths return 404 without stopping service');
} finally {
  if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  await rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
