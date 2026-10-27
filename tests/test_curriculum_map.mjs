import assert from 'node:assert/strict';
import {
  CURRICULUM_TRACKS,
  createCurriculumProgress,
  normalizeCurriculumProgress,
  planCurriculum,
  commitCurriculumLesson
} from '../curriculum-map.mjs';

const requiredTracks = ['communication', 'lexis', 'grammar', 'fluency', 'listening', 'pronunciation'];
assert.deepEqual(Object.keys(CURRICULUM_TRACKS), requiredTracks,
  'the durable map must cover every speaking/listening capability');
assert.ok(requiredTracks.every(key => CURRICULUM_TRACKS[key].nodes.length >= 3),
  'each track needs a gradual route, not one broad label');

const baseProfile = {
  stableBand: 4.5,
  activeNeeds: ['词汇准确与自然搭配'],
  masteredItems: [],
  curriculumProgress: createCurriculumProgress()
};
const lexicalPlan = planCurriculum(baseProfile, {
  now: '2026-09-07T08:00:00.000Z',
  duration: 20,
  ledgerPlan: { reviewTargets: [] }
});
assert.equal(lexicalPlan.newTarget.track, 'lexis');
assert.equal(lexicalPlan.plannedTargets.length, 1);
assert.equal(lexicalPlan.maximumNewTargets, 1);
assert.ok(lexicalPlan.completionCriteria.length >= 2);

const withDue = createCurriculumProgress();
withDue.nodes['grammar-core-control'] = {
  status: 'review', successfulDates: ['2026-09-01'], attempts: 1,
  lastPractisedAt: '2026-09-01T08:00:00.000Z', nextReviewAt: '2026-09-06T08:00:00.000Z'
};
const reviewFirst = planCurriculum({ ...baseProfile, curriculumProgress: withDue }, {
  now: '2026-09-07T08:00:00.000Z', duration: 20, ledgerPlan: { reviewTargets: [] }
});
assert.equal(reviewFirst.reviewTarget.id, 'grammar-core-control', 'due review must be planned first');
assert.equal(reviewFirst.plannedTargets[0].kind, 'review');
assert.equal(reviewFirst.plannedTargets.length, 2, 'a normal lesson uses one review plus one new map target');

let progress = createCurriculumProgress();
for (const endedAt of [
  '2026-09-07T08:20:00.000Z',
  '2026-09-07T10:20:00.000Z',
  '2026-09-09T08:20:00.000Z'
]) {
  progress = commitCurriculumLesson(progress, {
    endedAt,
    practisedNodeIds: ['lexis-natural-collocations'],
    successfulNodeIds: ['lexis-natural-collocations']
  });
}
assert.notEqual(progress.nodes['lexis-natural-collocations'].status, 'secure',
  'repetition on only two dates must not become durable learning');
progress = commitCurriculumLesson(progress, {
  endedAt: '2026-09-14T08:20:00.000Z',
  practisedNodeIds: ['lexis-natural-collocations'],
  successfulNodeIds: ['lexis-natural-collocations']
});
assert.equal(progress.nodes['lexis-natural-collocations'].status, 'secure');
assert.equal(progress.nodes['lexis-natural-collocations'].successfulDates.length, 3);

const normalized = normalizeCurriculumProgress({ version: 0, nodes: {
  unknown: { status: 'secure' },
  'lexis-natural-collocations': { status: 'nonsense', attempts: -4, successfulDates: ['bad', '2026-09-01'] }
} });
assert.equal(normalized.nodes.unknown, undefined);
assert.equal(normalized.nodes['lexis-natural-collocations'].status, 'unstarted');
assert.equal(normalized.nodes['lexis-natural-collocations'].attempts, 0);

console.log(JSON.stringify({ ok: true, tracks: requiredTracks.length, reviewFirst: true, crossDateMastery: true }));
