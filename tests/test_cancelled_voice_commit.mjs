import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Exercise the actual fallback-to-commit boundary without model or voice workers.
const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('    let voiceResult = await earlyVoiceJob;');
const end=source.indexOf('    runtime.turns += 1;',start)+'    runtime.turns += 1;'.length;
assert.ok(start>0&&end>start);
const controller=new AbortController(),runtime={turns:0};let delivered=0;
const run=vm.runInNewContext(`(async()=>{${source.slice(start,end)}})`,{
 signal:controller.signal,runtime,earlyVoiceJob:Promise.resolve({error:Error('synthetic primary voice failure')}),finalEnglish:'A synthetic answer.',
 synthesizeVoice:()=>{},createSentenceVoice:()=>({finish:async()=>{controller.abort();return {url:'synthetic-voice'};}}),
 deliverSpeech:()=>delivered++
});
await assert.rejects(run(),/取消/);assert.equal(runtime.turns,0);assert.equal(delivered,0);
console.log('PASS: disconnect during fallback TTS cannot deliver or commit an unheard reply');
