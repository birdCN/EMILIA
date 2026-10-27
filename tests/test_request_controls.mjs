import assert from 'node:assert/strict';
import {ApiModelClient} from '../model-providers.mjs';
const schema={type:'object',properties:{en:{type:'string'}},required:['en']};
for(const status of [400,401,402,403,404,429]){
 let calls=0;
 const client=new ApiModelClient({provider:'deepseek',protocol:'openai',baseUrl:'http://localhost:1',model:'fixture'},
  {fetcher:async()=>{calls++;return new Response('{}',{status});}});
 try{
  const {thread}=await client.request('thread/start',{});
  const done=client.waitFor(x=>x.method==='turn/completed'&&x.params.threadId===thread.id);
  await client.request('turn/start',{threadId:thread.id,input:[{text:'Only synthetic data'}],outputSchema:schema});
  assert.equal((await done).params.turn.status,'failed');
  assert.equal(calls,1,`HTTP ${status} must not launch redundant competing requests`);
 }finally{client.close();}
}
const a=new ApiModelClient({provider:'custom',protocol:'openai',baseUrl:'http://localhost:1',model:'fixture'},
 {fetcher:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}))});
try{
 const {thread}=await a.request('thread/start',{});
 const done=a.waitFor(x=>x.method==='turn/completed'&&x.params.threadId===thread.id);
 await a.request('turn/start',{threadId:thread.id,input:[{text:'Synthetic'}],outputSchema:schema});
 a.cancelTurn(thread.id);
 assert.equal((await done).params.turn.status,'failed');
 assert.equal(a.isAlive(),true,'cancelling one turn must preserve the client');
}finally{a.close();}
console.log('PASS: terminal errors stop immediately and a turn can be cancelled without closing its client');
