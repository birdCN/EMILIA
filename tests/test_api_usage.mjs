import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProviderUsage} from '../api-usage.mjs';
import {streamCompletion} from '../model-providers.mjs';
const root=mkdtempSync(fileURLToPath(new URL('../work/usage-',import.meta.url)));
try{
 const file=join(root,'usage.json'),u=new ProviderUsage(file);
 u.record({type:'start',id:'one',purpose:'spoken',model:'fixture',at:'2026-10-21T02:00:00Z',prompt:'DO NOT SAVE ME',apiKey:'secret'});
 u.record({type:'finish',id:'one',status:'completed',ttftMs:80});
 u.record({type:'usage',id:'one',usage:{prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:60}});
 u.record({type:'usage',id:'one',usage:{prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:60}});
 u.record({type:'start',id:'two',purpose:'translation',model:'fixture',at:'2026-10-21T02:00:01Z'});
 u.record({type:'finish',id:'two',status:'cancelled'});u.flush();
 const v=new ProviderUsage(file).view();
 assert.equal(v.days[0].requests,2);assert.equal(v.days[0].inputTokens,100);assert.equal(v.days[0].outputTokens,20);
 assert.equal(v.days[0].cacheHitTokens,60);assert.equal(v.days[0].usageReportedRequests,1);
 assert.equal(v.days[0].cancelled,1);assert.doesNotMatch(readFileSync(file,'utf8'),/DO NOT SAVE ME|secret|apiKey|prompt"/);
 const claude=new ProviderUsage();
 const packets=[{type:'message_start',message:{usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:60}}},
  {type:'content_block_delta',delta:{type:'text_delta',text:'Hello.'}},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:20}}, {type:'message_stop'}];
 await streamCompletion({model:'fixture',protocol:'anthropic',provider:'custom',baseUrl:'http://localhost:1'},[{role:'user',content:'fixture'}],null,()=>{},
  {onProviderEvent:e=>claude.record(e),fetcher:async()=>new Response(packets.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})});
 assert.equal(claude.view().days[0].inputTokens,160);assert.equal(claude.view().days[0].outputTokens,20);
 assert.equal(claude.view().days[0].cacheHitTokens,60);
 console.log('PASS: usage counts once, distinguishes unknown cancelled usage, persists without prompts or credentials');
}finally{rmSync(root,{recursive:true,force:true});}
