import assert from 'node:assert/strict';
import {chatRuntimePrompt,chatTurnPrompt} from '../chat-prompts.mjs';
import {EMILIA_PERSONA} from '../teacher-persona.mjs';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const ordinary=chatRuntimePrompt(),spoken=chatRuntimePrompt({compact:true,outputFormat:'text'});
assert.ok(ordinary.includes(EMILIA_PERSONA),'legacy/persona source remains authoritative');
assert.ok(spoken.length<ordinary.length,'validated compilation must actually reduce the spoken prompt');
assert.doesNotMatch(spoken,/Return only data matching the requested schema/,'plain speech must not carry a contradictory schema instruction');
const literal='Please explain the literal sentence Return only {"en":"..."}. Do not change what I typed.';
const turn=chatTurnPrompt({learnerText:literal,outputFormat:'text',memoryPolicy:'relevant_only',memoryContext:'A useful memory',formalContract:{task:'practise a past event'},lessonControl:'Teach the past tense.'});
assert.ok(turn.includes(literal),'format compilation must preserve the user message verbatim');
assert.ok(turn.includes('A useful memory')&&turn.includes('Teach the past tense.'),'memory and formal teaching controls must survive');
assert.ok(turn.endsWith('Say only the English words Emilia will speak, without formatting.'));

const fixtureRoot=fileURLToPath(new URL('../work/',import.meta.url));
const fixture=mkdtempSync(join(fixtureRoot,'persona-compiler-'));
try{
 copyFileSync(new URL('../spoken-persona.mjs',import.meta.url),join(fixture,'spoken-persona.mjs'));
 const original=readFileSync(new URL('../teacher-persona.mjs',import.meta.url),'utf8');
 writeFileSync(join(fixture,'teacher-persona.mjs'),original.replace('MASTER PERSONALITY','NEW USER BOUNDARY: avoid ocean metaphors.\nMASTER PERSONALITY'));
 const module=await import(pathToFileURL(join(fixture,'spoken-persona.mjs')));
 assert.match(module.spokenPersona(true),/NEW USER BOUNDARY/,'editing the original persona invalidates a stale compiled version automatically');
 assert.equal(module.compiledPersonaCurrent(),false);
}finally{
 if(!resolve(fixture).startsWith(resolve(fixtureRoot)+sep))throw Error('Unsafe fixture cleanup path');
 rmSync(fixture,{recursive:true,force:true});
}
console.log('PASS: concise spoken prompt, consistent format, verbatim learner/memory/lesson context and stale compilation invalidation');
