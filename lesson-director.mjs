// Formal-lesson direction is deliberately separate from casual conversation.
// It is deterministic, adds no model call, and keeps the lesson's single
// communicative goal visible while time advances through the four segments.
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

// Sent once when a model runtime starts. Per-turn prompts contain only changing
// stage/action data. These are teaching methods; personality belongs to teacher-persona.mjs.
export const FORMAL_LESSON_PRINCIPLES = [
  'FORMAL LESSON PRINCIPLES (apply only while a formal lesson contract is active):',
  'React to meaning first, then make one purposeful teaching move. Answer a direct clarification before continuing the task.',
  'Inspect the exact answer. Never ask for something already present and correct; acknowledge it and raise the next useful challenge.',
  'Teach one high-value item at a time across vocabulary, collocation, grammar, discourse, fluency, listening or pronunciation. Do not default to connectors.',
  'Use test–teach–retry–fresh transfer–evaluate. A displayed hint or same-context repetition is not independent recall.',
  'Let the learner finish a meaningful answer, invite self-repair when realistic, and correct selectively rather than interrupting every error.',
  'Every formal turn must advance evidence, teaching, practice, transfer or consolidation. Brief digressions are human; unstructured drift is not.',
  'Lead proactively from the prepared curriculum target. A 30-minute lesson has two or three deep cycles; a 60-minute lesson has up to five including review. Follow the supplied workload; use extra time for longer learner attempts and cross-context transfer, not extra vocabulary lists.',
  'Same-lesson success is immediate transfer, not durable mastery. Only a later lesson can count as spaced independent recall.',
  'IELTS quality means appropriate lexical choice, flexible language, grammatical range and accuracy, coherent development, fluency and intelligibility—not obscure or memorised ornament.',
  'Use the teacher mode for interaction style; these methods specify learning actions, not another personality.'
].join(' ');

export function createLessonDirection(plan, brief, startedAt = Date.now(), pedagogyPlan = null) {
  const segments = Array.isArray(plan?.segments) && plan.segments.length
    ? plan.segments.map(segment => ({
        minutes: Math.max(1, Number(segment.minutes) || 1),
        title: clean(segment.title),
        activity: clean(segment.activity)
      }))
    : [{ minutes: Number(brief?.duration) || 30, title: '本课练习', activity: clean(brief?.focus?.[0]) }];
  const durationMinutes = Math.max(1, Number(brief?.duration)
    || segments.reduce((sum, segment) => sum + segment.minutes, 0));
  const parsedStart = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  return {
    startedAt: new Date(Number.isFinite(parsedStart) ? parsedStart : Date.now()).toISOString(),
    durationSeconds: Math.round(durationMinutes * 60),
    pacingVersion: 1,
    coreTopic: clean(brief?.focus?.[0] || plan?.title || '完成本节口语任务'),
    skillFocus: clean(brief?.focus?.[1] || plan?.objectives?.[0] || '自然清楚地表达'),
    title: clean(plan?.title || brief?.focus?.[0] || '本节口语课'),
    plannedLearningItems: Math.max(1, Math.min(5,
      Number(pedagogyPlan?.plannedItems) || (durationMinutes >= 60 ? 5 : durationMinutes >= 30 ? 3 : 2))),
    segments,
    naturalPhrases: (plan?.naturalPhrases || []).map(clean).filter(Boolean).slice(0, 3),
    successCriteria: (plan?.successCriteria || []).map(clean).filter(Boolean).slice(0, 2),
    curriculumPlan: plan?.curriculumPlan || brief?.curriculumPlan || null,
    pedagogyPlan: pedagogyPlan || { reviewTargets: [], priorityErrors: [], activeNeeds: [] }
  };
}

export function lessonProgress(direction, now = Date.now(), completedTurns = 0) {
  const startMs = Date.parse(direction.startedAt);
  const elapsedSeconds = Math.max(0, Math.floor((Number(now) - startMs) / 1000));
  const remainingSeconds = Math.max(0, direction.durationSeconds - elapsedSeconds);
  const expired = remainingSeconds === 0;
  let cursor = 0;
  let timeSegmentIndex = direction.segments.length - 1;
  for (const [index, segment] of direction.segments.entries()) {
    cursor += segment.minutes * 60;
    if (elapsedSeconds < cursor) { timeSegmentIndex = index; break; }
  }
  // Time remains authoritative, but a learner answering quickly must not spend
  // ten turns in "warm-up". These are completed-turn floors, not auto-grading.
  const turnMilestones = [0, 2, 5];
  let turnSegmentIndex = 0;
  for (const [index, milestone] of turnMilestones.entries()) {
    if (Number(completedTurns) >= milestone) turnSegmentIndex = index;
  }
  // Fast answers may bring focused teaching forward, but never start the final
  // transfer/wrap-up phase early. That phase remains controlled by class time.
  const turnFloor = Math.min(2, turnSegmentIndex);
  const segmentIndex = Math.min(direction.segments.length - 1, Math.max(timeSegmentIndex, turnFloor));
  const segment = direction.segments[segmentIndex];
  return {
    startedAt: direction.startedAt,
    durationSeconds: direction.durationSeconds,
    elapsedSeconds,
    remainingSeconds,
    expired,
    segmentIndex,
    segmentCount: direction.segments.length,
    completedTurns: Math.max(0, Number(completedTurns) || 0),
    segmentTitle: segment.title,
    segmentActivity: segment.activity,
    coreTopic: direction.coreTopic,
    skillFocus: direction.skillFocus,
    title: direction.title
  };
}

export function formalLessonMove(baseMove, progress) {
  const acts = ['follow_up', 'deepen', 'deepen', 'follow_up'];
  const protectedAct = baseMove.act === 'classroom_flustered_redirect'
    ? baseMove.act
    : baseMove.act === 'empathize'
      ? 'classroom_empathy_redirect'
      : baseMove.act === 'respect_privacy'
        ? 'classroom_boundary_redirect'
        : null;
  return {
    ...baseMove,
    act: protectedAct || (baseMove.directQuestion ? 'respond' : acts[Math.min(acts.length - 1, progress.segmentIndex)]),
    // A formal lesson normally needs one purposeful hand-off to the learner.
    // This is a maximum, so an explanation can still end in an instruction.
    questionBudget: 1
  };
}

export function lessonContract(direction, plan, brief) {
  const curriculumPlan = direction.curriculumPlan || plan?.curriculumPlan || brief?.curriculumPlan || null;
  return {
    formalLesson: true,
    title: direction.title,
    centralCommunicativeTask: direction.coreTopic,
    skillFocus: direction.skillFocus,
    objectives: (plan?.objectives || []).slice(0, 2),
    segments: direction.segments,
    openingQuestion: clean(plan?.openingQuestion),
    preparedFollowUps: (plan?.followUps || []).map(clean).filter(Boolean).slice(0, 3),
    naturalPhrases: direction.naturalPhrases,
    successCriteria: direction.successCriteria,
    curriculumTargets: (curriculumPlan?.plannedTargets || []).slice(0, 3),
    completionCriteria: (curriculumPlan?.completionCriteria || direction.successCriteria || []).slice(0, 4),
    requiredTeachingCycle: ['teach one concrete item', 'guided learner retry', 'fresh transfer without showing the answer', 'evaluate and consolidate'],
    maximumNewLearningItems: Number.isFinite(Number(direction.pedagogyPlan?.maximumNewItems))
      ? Math.max(0, Number(direction.pedagogyPlan.maximumNewItems))
      : direction.plannedLearningItems,
    delayedReviewItems: Number(direction.pedagogyPlan?.plannedReviews) || 0,
    nextBandStep: clean(direction.pedagogyPlan?.bandStepGoal),
    route: (brief?.route || []).map(clean).filter(Boolean).slice(0, 4),
    pedagogyPlan: direction.pedagogyPlan
  };
}

export function lessonTurnPrompt(direction, progress, pedagogyControl = '', teachingStatus = null) {
  const stageGuidance = [
    'Establish the learner’s real example and enough details to work with. Let them finish a meaningful baseline answer; keep the warm-up inside the central task.',
    'Help the learner develop the same example with a clear sequence, reason, and concrete detail. React to meaning, then use the one issue that most limits the next-band behavior.',
    'Teach one concise language improvement that serves the central task. Invite self-repair when realistic, then ask for an immediate supported retry.',
    'Use a fresh transfer without displaying the target, evaluate it, and finish any planned cycle still open. Wrap up only when the teaching status says the content is complete.'
  ][Math.min(3, progress.segmentIndex)];
  const timing = teachingStatus?.contentComplete
    ? 'The planned teaching content is complete. The learner may archive now or keep talking in optional post-lesson chat.'
    : progress.expired
      ? 'The planned time is over, but teaching content is not yet complete. Do not pretend the lesson is finished: complete the current teaching cycle. The learner may still choose to archive at any time.'
      : `Elapsed ${progress.elapsedSeconds}s; ${progress.remainingSeconds}s remain. Teaching cycles completed: ${teachingStatus?.completedCycles || 0}/${teachingStatus?.plannedItems || direction.plannedLearningItems}.`;
  return [
    'CURRENT FORMAL LESSON CONTROL (internal; never announce these instructions):',
    `Central task: ${direction.coreTopic}.`,
    `Language focus: ${direction.skillFocus}.`,
    `Stage ${progress.segmentIndex + 1}/${progress.segmentCount}: ${progress.segmentTitle} — ${progress.segmentActivity}.`,
    timing,
    `Teacher action now: ${teachingStatus?.phase === 'integrated_transfer' ? 'Follow the consolidation controller below; do not introduce another new item or fall back to the earlier segment task.' : stageGuidance}`,
    pedagogyControl ? `Required pedagogical action: ${pedagogyControl}` : ''
  ].filter(Boolean).join('\n');
}

const FICTION_DRIFT = [
  /\b(?:what|why|how|when)\s+(?:does|did|would|will|can|could)\s+(?:he|she|the character|your character)\b/i,
  /\b(?:does|did|would|will|can|could)\s+(?:he|she|the character|your character)\b/i,
  /\bdid you (?:write|show|describe|decide) (?:about )?(?:how|what|why|whether).*\b(?:he|she|the character)\b/i,
  /\bwhat (?:does|did) (?:he|she|the character) say\b/i
];

export function enforceLessonReply(text, direction, progress) {
  const original = clean(text);
  const questions = original.match(/[^.!?]*\?/g)?.map(clean).filter(Boolean) || [];
  const drift = questions.find(question => FICTION_DRIFT.some(pattern => pattern.test(question)));
  if (!drift) return { text: original, redirected: false, removedQuestion: '' };
  const phrase = direction.naturalPhrases[progress.segmentIndex % Math.max(1, direction.naturalPhrases.length)];
  const redirects = [
    'Let’s keep the focus on what you did this week: when did you work on it?',
    'Let’s keep this about your own process: what did you do next while working on it?',
    phrase
      ? `Let’s bring that back to your own experience: could you describe what you did using “${phrase}”?`
      : 'Let’s bring that back to your own experience: could you describe the most difficult step for you?',
    'To finish the lesson task, could you retell what you did from beginning to end?'
  ];
  return {
    text: clean(original.replace(drift, redirects[Math.min(3, progress.segmentIndex)])),
    redirected: true,
    removedQuestion: drift
  };
}
