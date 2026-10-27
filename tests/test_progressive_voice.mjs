import assert from 'node:assert/strict';
import { attachVoicePlaylist } from '../public/voice-playlist.js';
import { readChatResponse } from '../public/chat-stream.js';
import { createSentenceVoice } from '../sentence-voice.mjs';

let ends=0,plays=0;
const audio={src:'',play:async()=>{plays++;}};
const playlist=attachVoicePlaylist(audio,{urls:['/first.wav'],open:true},{isCurrent:()=>true,onEnded:()=>ends++,onError:error=>{throw error;}});
audio.onended();
assert.equal(ends,0,'a finished prefix must wait for the continuation instead of ending the turn');
playlist.append(['/tail.wav']);
await Promise.resolve();
assert.equal(audio.src,'/tail.wav');
assert.equal(plays,1,'a delayed continuation must automatically resume on the same audio element');
playlist.finish();audio.onended();assert.equal(ends,1);
assert.equal(audio.voiceSegmentCount,2);

const events=[
 {type:'speech',reply:{en:'Walking helps me relax.',voiceUrl:'/first.wav',partial:true}},
 {type:'text',reply:{en:'Walking helps me relax. What do you enjoy about it?'}},
 {type:'speech-append',reply:{en:'Walking helps me relax. What do you enjoy about it?',voiceUrls:['/tail.wav']},final:true},
 {type:'complete',ok:true,reply:{en:'Walking helps me relax. What do you enjoy about it?',voiceUrl:'/first.wav',voiceUrls:['/first.wav','/tail.wav']}}
];
const encode=new TextEncoder(),seen=[];
const response=new Response(new ReadableStream({start(c){for(const event of events)c.enqueue(encode.encode(JSON.stringify(event)+'\n'));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
const result=await readChatResponse(response,e=>seen.push(e));
assert.deepEqual(seen.map(e=>e.type),['speech','text','speech-append']);
assert.equal(result.reply.en,events[3].reply.en);
const mismatched=new Response(events.slice(0,1).concat({type:'text',reply:{en:'An unrelated replacement.'}}).map(e=>JSON.stringify(e)+'\n').join(''),{headers:{'content-type':'application/x-ndjson'}});
await assert.rejects(()=>readChatResponse(mismatched),/不一致|变化/,'audible content must never be silently replaced');

let resolveVoice;
const sentence=createSentenceVoice(()=>new Promise(r=>resolveVoice=r));
sentence.observe('{"en":"Walking helps me relax. What do');
assert.equal(sentence.preview().text,'Walking helps me relax.');
resolveVoice({url:'/first.wav'});
assert.equal((await sentence.preview().ready).url,'/first.wav');
const longReply='A useful explanation keeps every example and every important detail. '.repeat(22).trim();
let failFirst=true,voiceId=0;const textsByUrl=new Map(),requested=[];
const synthesize=async text=>{
 requested.push(text);
 if(failFirst){failFirst=false;throw new Error('temporary synthesis failure');}
 const url='/voice-'+(++voiceId)+'.wav';textsByUrl.set(url,text);return {url};
};
await assert.rejects(()=>createSentenceVoice(synthesize,{enabled:false}).finish(longReply),/temporary/);
const recovered=await createSentenceVoice(synthesize,{enabled:false}).finish(longReply);
assert.ok(requested.every(text=>text.length<=800),'recovery must retain the per-segment TTS limit');
const recoveredWords=recovered.voiceUrls.map((url,i)=>i===0?textsByUrl.get(url):new URL(url,'http://local').searchParams.get('text')).join(' ');
assert.equal(recoveredWords,longReply,'retry must preserve the complete long answer');
console.log('PASS: progressive playback waits, appends, finalizes and rejects changed audible text; first sentence exposed before final JSON');
