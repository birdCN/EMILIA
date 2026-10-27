import assert from 'node:assert/strict';
import { ApiModelClient } from '../model-providers.mjs';
const bodies=[];
const fetcher=async(url,options)=>{
  bodies.push(JSON.parse(options.body));
  return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'{"en":"Hello."}'}}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
};
const client=new ApiModelClient({protocol:'openai',baseUrl:'http://localhost:1/v1',provider:'custom',model:'fixture',apiKey:'fixture'}, {fetcher});
const schema={type:'object',properties:{en:{type:'string'}},required:['en']};
const {thread}=await client.request('thread/start',{baseInstructions:'PERSONA',ephemeral:true});
for(let i=0;i<48;i++){
  client.setLearnerTurn(`learner-${i}`);
  const wait=client.waitFor(m=>m.method==='turn/completed'&&m.params.threadId===thread.id);
  await client.request('turn/start',{threadId:thread.id,input:[{text:`TRANSIENT MEMORIES ${i}`}],outputSchema:schema});
  assert.equal((await wait).params.turn.status,'completed');
}
assert.ok(client.threads.get(thread.id).length<=81);
const last=bodies.at(-1).messages;
assert.equal(last[0].content.startsWith('PERSONA'),true);
assert.equal(last.slice(0,-1).some(m=>m.content.includes('TRANSIENT')),false);
assert.equal(last.at(-1).content,'TRANSIENT MEMORIES 47');
const ephemeral=await client.request('thread/start',{ephemeral:true});
const wait=client.waitFor(m=>m.method==='turn/completed'&&m.params.threadId===ephemeral.thread.id);
await client.request('turn/start',{threadId:ephemeral.thread.id,input:[{text:'metadata'}]});
await wait;
assert.equal(client.threads.has(ephemeral.thread.id),false);
client.close();
assert.equal(client.threads.size,0);
console.log(JSON.stringify({ok:true,turns:48,historyBound:40,ephemeralReleased:true,noHistoricalDirectorAccumulation:true}));
