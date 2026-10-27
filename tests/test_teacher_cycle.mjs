import assert from 'node:assert/strict';
import { createDefaultProfile, prepareLessonSession, addConversationObservation, finishLessonSession } from '../learning-core.mjs';
const custom = { plan: {title:'复核最近三课中的过去时迁移'}, brief: {
  focus:['过去时迁移','在旅行新话题中复核'], route:['聊近况','回顾上次旅行','换新情境','独立迁移'],
  strengths:['能明确表达偏好'], nextMove:'converse', contextRule:'保留本教案，按回答追问', duration:20, mode:'speaking'
}};
const observation = signal => ({ source:'voice', wordCount:25, connectors:1, specifics:2,
  memoryPatch:{skillKey:'answer_development',signal,evidenceQuality:'high',confidence:.95,noteZh:'在新问题中独立展开',nextMove:'challenge'} });
let profile=createDefaultProfile();
for(let lesson=0;lesson<3;lesson++) {
  const date=`2026-09-${26+lesson}`;
  const prepared=prepareLessonSession(profile,20,'speaking',date+'T08:00:00Z',custom);
  let working=prepared.profile;
  const oldMemory=structuredClone(working.skillMemory);
  for(let turn=0;turn<12;turn++) working=addConversationObservation(working,observation('strength'),date+`T08:${String(turn).padStart(2,'0')}:00Z`);
  assert.deepEqual(working.currentSession.brief,custom.brief,'AI-authored route must survive every turn');
  assert.deepEqual(working.skillMemory,oldMemory,'no mid-class portrait rewrite');
  assert.equal(working.currentSession.observations.length,12,'all class observations, not only last eight');
  profile=finishLessonSession(working,date+'T08:30:00Z').profile;
  assert.equal(profile.skillMemory.answer_development.confirmations,lesson+1,'one independent update per class');
  if(lesson<2) assert.notEqual(profile.skillMemory.answer_development.status,'mastered');
}
assert.equal(profile.skillMemory.answer_development.status,'mastered');
let sameDay=createDefaultProfile();
for(let lesson=0;lesson<4;lesson++) {
  sameDay=prepareLessonSession(sameDay).profile;
  for(let turn=0;turn<10;turn++) sameDay=addConversationObservation(sameDay,observation('strength'));
  sameDay=finishLessonSession(sameDay,'2026-09-26T10:00:00Z').profile;
}
assert.notEqual(sameDay.skillMemory.answer_development.status,'mastered','repetition in one day is not stable mastery');
let mixed=prepareLessonSession(createDefaultProfile()).profile;
for(const signal of ['strength','weakness','strength','weakness']) mixed=addConversationObservation(mixed,observation(signal));
assert.deepEqual(finishLessonSession(mixed).profile.skillMemory,{},'contradictions remain unproven');
const idle=createDefaultProfile();
assert.deepEqual(addConversationObservation(idle,observation('weakness')),idle,'no false lesson through casual observation');
console.log(JSON.stringify({ok:true,briefPreserved:true,deferredPortrait:true,independentSessions:true,crossDateMastery:true,contradictions:true}));
