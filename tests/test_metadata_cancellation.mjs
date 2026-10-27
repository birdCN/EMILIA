import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual function without starting a service or model process.
const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function requestMetadataRepair(');
const end=source.indexOf('\nconst vocabularyJobs',start);
assert.ok(start>=0&&end>start);
const request=vm.runInNewContext(`(${source.slice(start,end).trim()})`,{
 CHAT_MODEL:'fixture',DEMO_ROOT:'fixture',CHAT_EFFORT:'none'
});
const unhandled=[];
const onUnhandled=error=>unhandled.push(error);
process.on('unhandledRejection',onUnhandled);
try{
 let rejectCompletion;
 const runtime={client:{
  waitFor(){return new Promise((resolve,reject)=>{rejectCompletion=reject;});},
  async request(method){
   if(method==='thread/start')return {thread:{id:'fixture-thread'}};
   // Closing Codex rejects the outstanding RPC and completion waiter together.
   rejectCompletion(new Error('completion connection closed'));
   throw new Error('RPC connection closed');
  }
 }};
 await assert.rejects(request(runtime,'instructions','input',{}),/RPC connection closed/);
 await new Promise(r=>setImmediate(r));
 assert.equal(unhandled.length,0,'a canceled startup must not leak unhandled completion rejections');
 const controller=new AbortController();controller.abort();
 await assert.rejects(request(runtime,'instructions','input',{}, {signal:controller.signal}),/取消|超时/);
 const mid=new AbortController();let scopedCancel=0;
 const slow={client:{waitFor:()=>new Promise(()=>{}),cancelTurn:()=>scopedCancel++,request:async method=>method==='thread/start'?{thread:{id:'slow-thread'}}:new Promise(()=>{})}};
 const job=request(slow,'instructions','input',{}, {signal:mid.signal});
 await new Promise(r=>setImmediate(r));mid.abort();
 await assert.rejects(Promise.race([job,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancellation stalled')),100))]),/取消|超时/);
 assert.equal(scopedCancel,1,'a stalled startup is cancelled once without retry');
 const methodStart=source.indexOf('  waitFor(predicate, timeout = CODEX_TIMEOUT_MS)');
 const methodEnd=source.indexOf('\n  onMessage(',methodStart);
 const waitFor=vm.runInNewContext(`({${source.slice(methodStart,methodEnd)}}).waitFor`,{
  CODEX_TIMEOUT_MS:10,setTimeout,clearTimeout
 });
 const waiting=waitFor.call({waiters:[]},()=>false,1);
 await new Promise(r=>setTimeout(r,10));
 const leaked=unhandled.length;
 await assert.rejects(waiting,/响应超时/);
 assert.equal(leaked,0,'Codex waiters must be observed even while their caller awaits another RPC');
 console.log(JSON.stringify({ok:true,failedRpcCompletionObserved:true,earlyCancellation:true,modelCalls:0}));
}finally{process.off('unhandledRejection',onUnhandled);}
