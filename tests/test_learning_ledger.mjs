import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningLedger, PEDAGOGY_SCHEMA, lessonTeachingStatus, normalizePedagogy } from '../learning-ledger.mjs';

assert.ok(PEDAGOGY_SCHEMA.required.includes('curriculumNodeId'),
  'strict structured output requires every declared pedagogy property');
assert.equal(normalizePedagogy({ action: 'none' }).curriculumNodeId, '',
  'old saved pedagogy records remain compatible through an empty normalized node id');

const ledger = new LearningLedger();
const introduced = normalizePedagogy({
  action: 'introduce', category: 'collocation', targetKey: 'make_progress', targetEn: 'make steady progress',
  explanationZh: '表示取得稳定进步的自然搭配', exampleEn: 'I have made steady progress this month.',
  outcome: 'introduced', errorTag: 'collocation_make_progress', errorLabelZh: '动词与 progress 的搭配不自然'
});
ledger.commitLesson({ sessionId: 'lesson-1', endedAt: '2026-01-01T10:00:00Z', turns: [{ learner: 'I get progress.', pedagogy: introduced }] });
let plan = ledger.plan({ now: '2026-01-02T10:00:00Z', activeNeeds: ['词汇准确与自然搭配'] });
assert.equal(plan.reviewTargets.length, 1);
assert.equal(plan.reviewTargets[0].targetEn, 'make steady progress');
const id = plan.reviewTargets[0].id;

const promptTurn = teacher => ({ learner: 'Could you give me a fresh situation?', teacher, pedagogy: {
  action: 'prompt_retrieval', category: 'collocation', targetKey: id, targetEn: 'make steady progress',
  explanationZh: '', exampleEn: '', outcome: 'not_tested', errorTag: '', errorLabelZh: ''
} });
const recallTurn = outcome => ({ learner: 'I have made steady progress this month.', pedagogy: {
  action: 'evaluate_retrieval', category: 'collocation', targetKey: id, targetEn: 'make steady progress',
  explanationZh: '', exampleEn: '', outcome, errorTag: '', errorLabelZh: ''
} });
ledger.commitLesson({ sessionId: 'lesson-2', endedAt: '2026-01-02T10:00:00Z', turns: [
  promptTurn('Tell me how your English has changed this month.'), recallTurn('recalled_independently')
] });
assert.equal(ledger.view('2026-01-03T10:00:00Z').counts.dueReviews, 0, 'successful recall spaces the next check');
ledger.commitLesson({ sessionId: 'lesson-3', endedAt: '2026-01-05T10:00:00Z', turns: [
  promptTurn('How would you describe your improvement recently?'), recallTurn('recalled_independently')
] });
ledger.commitLesson({ sessionId: 'lesson-4', endedAt: '2026-01-12T10:00:00Z', turns: [
  promptTurn('Sum up your improvement in one sentence.'), recallTurn('recalled_independently')
] });
assert.equal(ledger.view('2026-01-12T10:00:00Z').counts.stableItems, 1, 'mastery needs repeated independent recall across lessons and dates');
const duplicate = ledger.commitLesson({ sessionId: 'lesson-4', endedAt: '2026-01-12T11:00:00Z', turns: [recallTurn('forgotten')] });
assert.equal(duplicate.duplicate, true);
assert.equal(ledger.view().counts.sessions, 4);
assert.equal(ledger.view().counts.errorPatterns, 1);

ledger.commitLesson({ sessionId: 'lesson-5', endedAt: '2026-01-13T10:00:00Z', turns: [
  promptTurn('Describe your progress without a hint.'), recallTurn('forgotten')
] });
assert.equal(ledger.view('2026-01-13T10:00:00Z').counts.stableItems, 0,
  'a forgotten result must immediately move a previously stable target back to reviewing');
assert.equal(ledger.state.items[0].independentRecalls, 3,
  'a lapse must preserve the learner’s earlier independent-recall accomplishments');
assert.equal(ledger.state.items[0].reviewDates.length, 3,
  'a lapse must preserve earlier long-term review history');
for (const [index, endedAt] of [
  '2026-01-14T10:00:00Z', '2026-01-17T10:00:00Z', '2026-01-24T10:00:00Z'
].entries()) {
  ledger.commitLesson({ sessionId: `reacquire-${index + 1}`, endedAt, turns: [
    promptTurn('Use the expression in a fresh situation.'), recallTurn('recalled_independently')
  ] });
  assert.equal(ledger.state.items[0].status, index === 2 ? 'stable' : 'reviewing',
    'reacquisition requires three consecutive independent recalls on different days');
}
ledger.commitLesson({ sessionId: 'help-lapse', endedAt: '2026-01-25T10:00:00Z', turns: [
  promptTurn('Try once more.'), recallTurn('recalled_with_help')
] });
assert.equal(ledger.state.items[0].status, 'reviewing',
  'a supported recall must immediately move a previously stable target back to reviewing');

const guarded = new LearningLedger();
guarded.commitLesson({ sessionId: 'guard-1', endedAt: '2026-01-01T10:00:00Z', turns: [{ learner: 'I get progress.', pedagogy: introduced }] });
const guardedId = guarded.plan({ now: '2026-01-02T10:00:00Z' }).reviewTargets[0].id;
const claim = (learner, outcome = 'recalled_independently') => ({ learner, pedagogy: {
  action: 'evaluate_retrieval', category: 'collocation', targetKey: guardedId, targetEn: 'make steady progress',
  explanationZh: '', exampleEn: '', outcome, errorTag: '', errorLabelZh: ''
} });
const unprompted = guarded.commitLesson({ sessionId: 'guard-2', endedAt: '2026-01-02T10:00:00Z', turns: [claim('I made steady progress.')] });
assert.equal(unprompted.summary.rejectedEvaluations[0].reason, 'missing_preceding_prompt');
const leakedPrompt = { ...promptTurn('Please answer with “make steady progress”.'), pedagogy: { ...promptTurn('').pedagogy, targetKey: guardedId } };
const leaked = guarded.commitLesson({ sessionId: 'guard-3', endedAt: '2026-01-03T10:00:00Z', turns: [leakedPrompt, claim('I made steady progress.')] });
assert.equal(leaked.summary.reviewed[0].outcome, 'recalled_with_help');
const cleanPrompt = { ...promptTurn('Describe a recent improvement.'), pedagogy: { ...promptTurn('').pedagogy, targetKey: guardedId } };
const missing = guarded.commitLesson({ sessionId: 'guard-4', endedAt: '2026-01-04T10:00:00Z', turns: [cleanPrompt, claim('My English is better now.')] });
assert.equal(missing.summary.reviewed[0].outcome, 'forgotten');
assert.equal(guarded.view('2026-06-01T10:00:00Z').priorityErrors.length, 0, 'stale weaknesses decay out of priority view');

const cycle = (number, outcome = 'recalled_independently') => {
  const target = `useful phrase ${number}`;
  const targetId = `target-${number}`;
  const common = { category: 'collocation', targetKey: targetId, targetEn: target,
    explanationZh: '可复用表达', exampleEn: `I used useful phrase ${number} naturally.`, errorTag: '', errorLabelZh: '' };
  return [
    { learner: 'example', pedagogy: { ...common, action: 'introduce', outcome: 'introduced' } },
    { learner: target, pedagogy: { ...common, action: 'practice', outcome: 'practised' } },
    { learner: 'ready', pedagogy: { ...common, action: 'prompt_retrieval', outcome: 'not_tested' } },
    { learner: target, pedagogy: { ...common, action: 'evaluate_retrieval', outcome } }
  ];
};
const twoCycles = [...cycle(1), ...cycle(2)];
assert.equal(lessonTeachingStatus(twoCycles, 3).contentComplete, false);
const threeCycles = [...twoCycles, ...cycle(3)];
assert.deepEqual(lessonTeachingStatus(threeCycles, 3), {
  plannedItems: 3, startedItems: 3, completedCycles: 3, pendingItems: 0, contentComplete: true,
  activeTarget: null, phase: 'post_lesson_chat'
});
assert.match(new LearningLedger().turnControl({ reviewTargets: [] }, threeCycles, { segmentIndex: 3 }, 3), /optional post-lesson chat/i);

const deepPlan = new LearningLedger().plan({ duration: 20, stableBand: 4.5, confidence: 90 });
assert.equal(deepPlan.plannedItems, 2);
assert.equal(deepPlan.maximumNewItems, 2);
assert.match(deepPlan.bandStepGoal, /Band 5/);

const immediate = new LearningLedger();
const immediateResult = immediate.commitLesson({ sessionId: 'same-lesson-transfer', endedAt: '2026-02-01T10:00:00Z',
  plannedItems: 2, turns: cycle(8) });
assert.equal(immediateResult.summary.reviewed[0].outcome, 'transferred_in_session');
assert.equal(immediate.state.items[0].independentRecalls, 0, 'same-lesson transfer must not count as spaced recall');
assert.equal(immediate.state.items[0].inSessionTransfers, 1);
assert.equal(immediate.state.items[0].nextReviewAt, '2026-02-02T10:00:00.000Z');
const immediateItem = immediate.state.items[0];
const sameDayPrompt = { learner: 'ready', teacher: 'Use it in another situation.', pedagogy: {
  action: 'prompt_retrieval', category: immediateItem.category, targetKey: immediateItem.id, targetEn: immediateItem.targetEn,
  explanationZh: '', exampleEn: '', outcome: 'not_tested', errorTag: '', errorLabelZh: ''
} };
const sameDayAnswer = { learner: immediateItem.targetEn, pedagogy: {
  ...sameDayPrompt.pedagogy, action: 'evaluate_retrieval', outcome: 'recalled_independently'
} };
const sameDay = immediate.commitLesson({ sessionId: 'same-day-reinforcement', endedAt: '2026-02-01T15:00:00Z',
  turns: [sameDayPrompt, sameDayAnswer] });
assert.equal(sameDay.summary.reviewed[0].outcome, 'reinforced_same_day');
assert.equal(immediate.state.items[0].independentRecalls, 0, 'another lesson on the same day is still not spaced recall');

const lookupLedger = new LearningLedger();
const lookupRecord = lookupLedger.recordLookup({
  targetEn: 'feel overwhelmed', category: 'collocation', explanationZh: '感到事情太多而难以应付',
  exampleEn: 'I feel overwhelmed by this week’s workload.', partOfSpeech: 'collocation',
  at: '2026-03-01T10:00:00Z', intentZh: '不得保存的原始意图', recentTurns: [{ learner: 'private context' }]
});
assert.equal(lookupRecord.created, true);
assert.equal(lookupRecord.item.origin, 'contextual_lookup');
assert.equal(lookupRecord.item.status, 'learning');
assert.equal(lookupRecord.item.nextReviewAt, '2026-03-03T10:00:00.000Z');
assert.equal(lookupRecord.item.lookupCount, 1);
assert.doesNotMatch(JSON.stringify(lookupLedger.state), /不得保存|private context/,
  'lookup persistence accepts educational fields only, never raw intent or conversation history');

const lookupId = lookupRecord.item.id;
const lookupPrompt = teacher => ({ learner: 'ready', teacher, pedagogy: {
  action: 'prompt_retrieval', category: 'collocation', targetKey: lookupId, targetEn: 'feel overwhelmed',
  explanationZh: '', exampleEn: '', outcome: 'not_tested', errorTag: '', errorLabelZh: '', curriculumNodeId: ''
} });
const lookupRecall = () => ({ learner: 'I feel overwhelmed when several deadlines arrive together.', source: 'typed', pedagogy: {
  action: 'evaluate_retrieval', category: 'collocation', targetKey: lookupId, targetEn: 'feel overwhelmed',
  explanationZh: '', exampleEn: '', outcome: 'recalled_independently', errorTag: '', errorLabelZh: '', curriculumNodeId: ''
} });
for (const [index, endedAt] of [
  '2026-03-03T10:00:00Z', '2026-03-06T10:00:00Z', '2026-03-13T10:00:00Z'
].entries()) {
  lookupLedger.commitLesson({ sessionId: `lookup-review-${index + 1}`, endedAt,
    turns: [lookupPrompt('Describe the feeling in a fresh situation without using my wording.'), lookupRecall()] });
}
assert.equal(lookupLedger.state.items.find(item => item.id === lookupId).status, 'stable');
const repeatedLookup = lookupLedger.recordLookup({
  targetEn: 'feel overwhelmed', category: 'collocation', explanationZh: '感到事情太多而难以应付',
  exampleEn: 'I feel overwhelmed by this week’s workload.', partOfSpeech: 'collocation', at: '2026-03-14T10:00:00Z'
});
assert.equal(repeatedLookup.created, false);
assert.equal(repeatedLookup.item.status, 'stable', 'looking up a known expression does not erase prior accomplishments');
assert.equal(repeatedLookup.item.independentRecalls, 3);
assert.equal(repeatedLookup.item.lookupCount, 2);

const rollbackDirectory = mkdtempSync(join(tmpdir(), 'lookup-write-failure-'));
try {
  const rollbackLedger = new LearningLedger();
  rollbackLedger.filePath = rollbackDirectory;
  const beforeFailedWrite = structuredClone(rollbackLedger.state);
  assert.throws(() => rollbackLedger.recordLookup({
    targetEn: 'cope with', category: 'collocation', explanationZh: '应付',
    exampleEn: 'I can cope with the extra work.', partOfSpeech: 'phrasal_verb', at: '2026-03-01T10:00:00Z'
  }));
  assert.deepEqual(rollbackLedger.state, beforeFailedWrite,
    'a failed durable write must roll back the in-memory lookup mutation');
} finally {
  rmSync(rollbackDirectory, { recursive: true, force: true });
}

const lookupPlanLedger = new LearningLedger();
for (const [targetEn, exampleEn] of [
  ['snowed under', 'I am snowed under with work this week.'],
  ['run out of time', 'I often run out of time on busy mornings.']
]) {
  lookupPlanLedger.recordLookup({ targetEn, category: 'collocation', explanationZh: '事情太多或时间不够',
    exampleEn, partOfSpeech: 'collocation', at: '2026-03-01T10:00:00Z' });
}
const lookupPlan = lookupPlanLedger.plan({ now: '2026-03-04T10:00:00Z', duration: 60, stableBand: 5, confidence: 90 });
assert.equal(lookupPlan.reviewTargets.filter(item => item.reviewKind === 'lookup_review').length, 1,
  'a lesson includes at most one due contextual lookup within the existing review load');
assert.ok(lookupPlan.reviewTargets.length <= lookupPlan.plannedReviews,
  'lookup review never expands the existing delayed-review cap');

const failingDirectory = mkdtempSync(join(tmpdir(), 'lookup-save-failure-'));
try {
  const rollbackLedger = new LearningLedger();
  const before = structuredClone(rollbackLedger.state);
  rollbackLedger.filePath = failingDirectory;
  assert.throws(() => rollbackLedger.recordLookup({ targetEn: 'cope with', category: 'collocation',
    explanationZh: '应付', exampleEn: 'I can cope with the extra work.', partOfSpeech: 'phrasal_verb',
    at: '2026-03-01T10:00:00Z' }));
  assert.deepEqual(rollbackLedger.state, before, 'failed persistence rolls the in-memory lookup write back');
} finally {
  rmSync(failingDirectory, { recursive: true, force: true });
}

const curriculumLedger = new LearningLedger();
const allowedCurriculumTargets = [
  { id: 'lexis-natural-collocations', track: 'lexis' },
  { id: 'grammar-core-control', track: 'grammar' }
];
const unlinkedCurriculum = curriculumLedger.commitLesson({
  sessionId: 'curriculum-unlinked', endedAt: '2026-03-01T10:00:00Z',
  curriculumTargets: allowedCurriculumTargets, turns: cycle(20)
});
assert.deepEqual(unlinkedCurriculum.curriculumEvidence.nodes, [],
  'concrete teaching without an explicit curriculum node link must not infer planned-target coverage');
const linkedCycle = cycle(21).map(turn => ({ ...turn, pedagogy: {
  ...turn.pedagogy, curriculumNodeId: 'lexis-natural-collocations'
} }));
const linkedCurriculum = curriculumLedger.commitLesson({
  sessionId: 'curriculum-linked', endedAt: '2026-03-02T10:00:00Z',
  curriculumTargets: allowedCurriculumTargets, turns: linkedCycle
});
assert.deepEqual(linkedCurriculum.curriculumEvidence, {
  sessionId: 'curriculum-linked',
  nodes: [{ nodeId: 'lexis-natural-collocations', outcome: 'recalled_independently' }]
}, 'only an explicitly linked, category-compatible, verified cycle emits curriculum evidence');
const wrongTrackCycle = cycle(22).map(turn => ({ ...turn, pedagogy: {
  ...turn.pedagogy, curriculumNodeId: 'grammar-core-control'
} }));
const wrongTrackCurriculum = curriculumLedger.commitLesson({
  sessionId: 'curriculum-wrong-track', endedAt: '2026-03-03T10:00:00Z',
  curriculumTargets: allowedCurriculumTargets, turns: wrongTrackCycle
});
assert.deepEqual(wrongTrackCurriculum.curriculumEvidence.nodes, [],
  'an explicit node id cannot override category-to-track compatibility');

const cappedState = structuredClone(immediate.state);
cappedState.sessions = [{ sessionId: 'daily-load', endedAt: '2026-02-01T12:00:00Z', introduced: [
  { id: 'a' }, { id: 'b' }, { id: 'c' }
] }];
const cappedPlan = new LearningLedger(null, cappedState).plan({ now: '2026-02-01T15:30:00Z', duration: 20,
  stableBand: 4.5, confidence: 90 });
assert.equal(cappedPlan.maximumNewItems, 0, 'daily saturation replaces new material with reinforcement');
assert.ok(cappedPlan.reviewTargets.every(item => item.reviewKind === 'same_day_reinforcement'));

const semantic = normalizePedagogy({ action: 'introduce', category: 'listening_strategy', targetKey: 'so_that',
  targetEn: 'so that', explanationZh: '表达目的', exampleEn: 'I wrote it down so that I would remember it.',
  outcome: 'introduced', errorTag: 'imprecise_word_choice', errorLabelZh: '表达目的' });
assert.equal(semantic.category, 'sentence_structure', 'a connector cannot be filed as a listening strategy');

const dirty = new LearningLedger(null, { items: [{ id: 'bad', targetEn: 'feeling sentence', exampleEn: 'I felt happy.' }], sessions: [] });
assert.equal(dirty.maintain().removed[0].targetEn, 'feeling sentence');
assert.equal(dirty.view().counts.learningItems, 0);

console.log(JSON.stringify({ ok: true, delayedRetrieval: true, deterministicRecallVerification: true,
  supportiveOutcomes: true, crossLessonMastery: true, staleErrorDecay: true, idempotentArchive: true,
  lessonCycles: true, maintainedTargets: true, adaptiveLoad: true, sameLessonIsNotMastery: true,
  semanticCategories: true }));
