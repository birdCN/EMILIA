import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
// Local operational counters only. Never receive/store prompts, credentials or conversation text.
export class ProviderUsage {
 constructor(path=null){
  this.path=path;this.recent=new Map();this.timer=null;this.warning='';this.days=[];
  try{if(path&&existsSync(path))this.days=JSON.parse(readFileSync(path,'utf8')).days||[];}catch{this.warning='用量记录未能读取；历史用量不能据此推算。';}
 }
 record(event){
  if(event.type==='start'){
   const day=new Date(Date.parse(event.at||new Date().toISOString())+8*3600000).toISOString().slice(0,10);
   let row=this.days.find(x=>x.day===day);
   if(!row){row={day,requests:0,completed:0,failed:0,cancelled:0,usageReportedRequests:0,inputTokens:0,outputTokens:0,cacheHitTokens:0,purposes:{}};this.days.push(row);this.days=this.days.sort((a,b)=>b.day.localeCompare(a.day)).slice(0,31);}
   const purpose=/^[a-z_]{1,32}$/.test(event.purpose||'')?event.purpose:'other';
   row.requests++;row.purposes[purpose]=(row.purposes[purpose]||0)+1;
   this.recent.set(event.id,{row,finished:false,usage:false});
   if(this.recent.size>1000)this.recent.delete(this.recent.keys().next().value);
  }else{
   const entry=this.recent.get(event.id);if(!entry)return;
   if(event.type==='finish'&&!entry.finished){entry.finished=true;entry.row[['completed','cancelled'].includes(event.status)?event.status:'failed']++;}
   if(event.type==='usage'&&event.usage&&Number.isSafeInteger(event.usage.prompt_tokens)&&Number.isSafeInteger(event.usage.completion_tokens)){
    const next={input:count(event.usage.prompt_tokens),output:count(event.usage.completion_tokens),cache:count(event.usage.prompt_cache_hit_tokens??event.usage.prompt_tokens_details?.cached_tokens)};
    if(!entry.usage)entry.row.usageReportedRequests++;
    const old=entry.usage||{input:0,output:0,cache:0};
    for(const [key,column]of [['input','inputTokens'],['output','outputTokens'],['cache','cacheHitTokens']]){next[key]=Math.max(next[key],old[key]);entry.row[column]+=next[key]-old[key];}
    entry.usage=next;
   }
  }
  if(this.path&&!this.timer){this.timer=setTimeout(()=>this.flush(),500);this.timer.unref?.();}
 }
 view(){return structuredClone({days:this.days,warning:this.warning,note:'仅统计启用后的调用；取消或未返回 usage 的请求费用未知。金额以服务商账单为准。'});}
 flush(){
  clearTimeout(this.timer);this.timer=null;if(!this.path)return;
  try{mkdirSync(dirname(this.path),{recursive:true});const temp=this.path+'.tmp';writeFileSync(temp,JSON.stringify(this.view()));renameSync(temp,this.path);this.warning='';}
  catch{this.warning='用量记录写入失败；统计可能不完整。';}
 }
}
let collector=null;
export function configureProviderUsage(path){collector=new ProviderUsage(path);return collector;}
export function recordProviderEvent(event){try{collector?.record(event);}catch{/* Accounting never blocks speech. */}}
process.once('exit',()=>collector?.flush());
