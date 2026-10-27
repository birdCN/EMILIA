import assert from 'node:assert/strict';
import { createLessonDirection, enforceLessonReply, formalLessonMove, FORMAL_LESSON_PRINCIPLES, lessonContract, lessonProgress, lessonTurnPrompt } from '../lesson-director.mjs';

const plan = {
  title: '描述这一周自己完成的事情', objectives: ['回答展开', '过去时准确度'],
  segments: [
    { minutes: 3, title: '建立素材', activity: '选一件本周做过的事情' },
    { minutes: 5, title: '展开细节', activity: '补充顺序、原因和细节' },
    { minutes: 7, title: '针对修复', activity: '过去时与自然连接' },
    { minutes: 5, title: '独立复述', activity: '换一个例子完整表达' }
  ],
  openingQuestion: 'What is one thing you did this week?',
  followUps: ['What happened first?', 'Why did it matter?', 'What happened in the end?'],
  naturalPhrases: ['earlier this week', 'what I did was', 'in the end'],
  successCriteria: ['独立讲清一件事', '过去时基本准确']
};
const curriculumPlan = {
  plannedTargets: [
    { id: 'lexis.collocation_precision', labelZh: '自然搭配与准确用词', kind: 'new' },
    { id: 'communication.answer_development', labelZh: '展开回答', kind: 'review' }
  ],
  completionCriteria: ['先复习后新授', '能在有支架重说中使用', '能在新语境独立迁移']
};
plan.curriculumPlan = curriculumPlan;
const brief = { duration: 20, focus: ['描述这一周做过的事情', '过去时与回答展开'], route: ['起', '承', '转', '收'], curriculumPlan };
const start = Date.parse('2026-09-06T10:00:00.000Z');
const direction = createLessonDirection(plan, brief, start);
assert.equal(lessonProgress(direction, start).segmentIndex, 0);
assert.equal(lessonProgress(direction, start + 180_000).segmentIndex, 1);
assert.equal(lessonProgress(direction, start + 480_000).segmentIndex, 2);
assert.equal(lessonProgress(direction, start + 900_000).segmentIndex, 3);
assert.equal(lessonProgress(direction, start + 10_000, 2).segmentIndex, 1, 'fast answers must move beyond warm-up');
assert.equal(lessonProgress(direction, start + 10_000, 5).segmentIndex, 2, 'turn progress must unlock focused repair');
assert.equal(lessonProgress(direction, start + 10_000, 8).segmentIndex, 2, 'turn count alone must never force wrap-up');
const ended = lessonProgress(direction, start + 1_200_000);
assert.equal(ended.expired, true);
assert.equal(ended.remainingSeconds, 0);
assert.equal(formalLessonMove({ directQuestion: false }, lessonProgress(direction, start + 500_000)).questionBudget, 1);
assert.equal(formalLessonMove({ act: 'classroom_flustered_redirect', directQuestion: false },
  lessonProgress(direction, start + 500_000)).act, 'classroom_flustered_redirect');
assert.equal(formalLessonMove({ act: 'empathize', directQuestion: false },
  lessonProgress(direction, start + 500_000)).act, 'classroom_empathy_redirect');
assert.equal(formalLessonMove({ act: 'respect_privacy', directQuestion: false },
  lessonProgress(direction, start + 500_000)).act, 'classroom_boundary_redirect');
assert.match(FORMAL_LESSON_PRINCIPLES, /Use the teacher mode for interaction style/);
assert.doesNotMatch(FORMAL_LESSON_PRINCIPLES, /outranks/);
assert.doesNotMatch(FORMAL_LESSON_PRINCIPLES, /MASTER PERSONALITY/);
assert.match(FORMAL_LESSON_PRINCIPLES, /already present and correct/);
assert.ok(lessonTurnPrompt(direction, lessonProgress(direction, start + 500_000)).length < 900,
  'per-turn formal control should contain changing data, not repeat the full teaching handbook');
assert.equal(lessonContract(direction, plan, brief).centralCommunicativeTask, '描述这一周做过的事情');
assert.equal(lessonContract(direction, plan, brief).maximumNewLearningItems, 2);
assert.deepEqual(lessonContract(direction, plan, brief).curriculumTargets.map(item => item.id),
  ['lexis.collocation_precision', 'communication.answer_development']);
assert.match(lessonContract(direction, plan, brief).completionCriteria.join(' '), /独立迁移/);
assert.equal(direction.plannedLearningItems, 2, 'twenty-minute lessons favour two deep cycles over target stuffing');
const redirected = enforceLessonReply(
  "That's a relatable feeling. Did you write about how he tries to change that?",
  direction,
  lessonProgress(direction, start + 200_000, 3)
);
assert.equal(redirected.redirected, true);
assert.match(redirected.text, /your own process/);
assert.doesNotMatch(redirected.text, /how he tries/);
console.log(JSON.stringify({ ok: true, core: direction.coreTopic, stages: direction.segments.length, countdown: true, guidedTurn: true }));
