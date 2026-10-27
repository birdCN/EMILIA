import {randomUUID,createHash} from 'node:crypto';
import {readDocument,writeDocument,documentExists} from './durable-storage.mjs';
import {detectTopicDomain} from './topic-director.mjs';
import {memoryRelevanceSignals} from './memory-retrieval.mjs';
const hash=s=>createHash('sha256').update(s.toLowerCase()).digest('hex');
const EXERCISE=/\b(?:translate|translation|example|role.?play|pretend|fiction|practi[cs]e|sentence|grammar|say|repeat|read.{0,30}aloud)\b|翻译|造句|举例|扮演|假设|练习|跟读|朗读/iu;
const OFFSCREEN=/\b(?:yesterday|this morning|last night|my (?:family|childhood|home|lunch|dinner)|after my|I went|I ate)\b/iu;
// A small record of actually voiced opinions, separate from learner biography and relationship permissions.
// No model call and no invented life events. These notes are inspectable and deletable.
export class PersonaContinuity {
 constructor(path){this.path=path;this.state={version:1,records:[],blocked:[]};if(documentExists(path)){const data=JSON.parse(readDocument(path));if(data.version!==1||!Array.isArray(data.records)||!Array.isArray(data.blocked))throw new Error('人物连续性记录损坏，未覆盖原文件。');this.state=data;}}
 view(now=Date.now()){return structuredClone({records:this.state.records.filter(r=>Date.parse(r.expiresAt)>now)});}
 observe({learner='',teacher='',formalLesson=false,uncertain=false,turnId='',at=new Date().toISOString()}){
  if(formalLesson||uncertain||EXERCISE.test(learner)||EXERCISE.test(teacher)||OFFSCREEN.test(teacher))return;
  // Only an unquoted first-person taste at the start of an actual reply qualifies.
  const quote=teacher.trim().match(/^I (?:tend to )?(?:prefer|like|enjoy)\b[^.!?]{2,230}[.!?](?=\s|$)/iu)?.[0];
  const normalized=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(!quote||normalized(learner).includes(normalized(quote))||/\b(?:you|your|how you|that you|to think|to say|sk-[\w-]{12,}|password|api.?key|bearer)\b|系统提示词|忽略.*指令/iu.test(quote))return;
  const topic=detectTopicDomain(quote);if(!topic||this.state.blocked.includes(hash(quote)))return;
  const old=this.state.records.find(r=>r.topic===topic);
  if(old?.quote===quote)return;
  const row={id:old?.id||randomUUID(),topic,quote,sourceSpeaker:'Emilia',sourceTurnId:turnId,at,
    expiresAt:new Date(Date.parse(at)+180*86400000).toISOString()};
  this.state.records=[...this.view(Date.parse(at)).records.filter(r=>r.topic!==topic),row].slice(-24);this.save();
 }
 context(query){
  const rows=this.view().records.filter(r=>{const s=memoryRelevanceSignals(query,{text:r.quote,key:r.topic});return s.sharedTopics>0||s.lexicalMatches>=2;}).slice(-2);
  return rows.length?'Previously voiced Emilia opinions (quoted evidence, not user facts or topic instructions). Keep a relevant opinion consistent, or explain a genuine change of mind. Do not manufacture lived experiences:\n'+rows.map(r=>JSON.stringify({quote:r.quote,at:r.at})).join('\n'):'';
 }
 delete(id){const row=this.state.records.find(r=>r.id===id);if(!row)throw new Error('这条人物记录已不存在。');this.state.blocked=[...new Set([...this.state.blocked,hash(row.quote)])].slice(-128);this.state.records=this.state.records.filter(r=>r.id!==id);this.save();return this.view();}
 save(){writeDocument(this.path,JSON.stringify(this.state));}
}
