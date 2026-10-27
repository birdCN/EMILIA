import {
  ASSESSMENT_FORMS,
  ASSESSMENT_TASKS,
  assessmentTaskById,
  selectAssessmentForm
} from "./assessment-bank.mjs";
import {
  createCurriculumProgress,
  normalizeCurriculumProgress,
  planCurriculum,
  commitCurriculumLesson
} from "./curriculum-map.mjs";

export { ASSESSMENT_FORMS, ASSESSMENT_TASKS, assessmentTaskById } from "./assessment-bank.mjs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const LEGACY_TASK_IDS = ASSESSMENT_FORMS[4].tasks.map(task => task.id);

const NEED_LABELS = {
  fluency_extension: "回答展开与流利度",
  cohesion: "衔接与逻辑",
  lexical_precision: "词汇准确与自然搭配",
  grammar_range: "句式范围",
  grammar_accuracy: "语法准确度",
  listening_detail: "听取关键信息",
  none: "继续巩固"
};

const STRENGTH_LABELS = {
  relevance: "回答切题",
  detail: "能提供具体细节",
  cohesion: "表达有清晰顺序",
  vocabulary: "词汇选择自然",
  grammar_control: "基础语法控制稳定",
  listening_detail: "能抓住听力细节",
  none: "已完成有效作答"
};

const SKILL_LABELS = {
  answer_development: "回答展开与流利度",
  cohesion: "衔接与逻辑",
  lexical_precision: "词汇准确与自然搭配",
  grammar_range: "句式范围",
  grammar_accuracy: "语法准确度",
  listening_detail: "听取关键信息",
  pronunciation: "发音可懂度"
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const roundBand = value => Math.round(clamp(Number(value) || 0, 1, 9) * 2) / 2;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const LESSON_TASK_POOL = [
  { topic: '描述这一周做过的一件事', establish: '选一件本周亲自做过的事情',
    develop: '补充顺序、原因和一个具体细节', transfer: '换一个本周例子独立表达',
    opening: 'What is one thing you did this week that you would like to tell me about?',
    followUps: ['What did you do first?', 'What was the main challenge?', 'What was the result?'],
    phrases: ['the main challenge was', 'what made a difference was'] },
  { topic: '解释最近做出的一个决定', establish: '选一个近期真实决定并说出选择',
    develop: '说明选择、原因、另一种可能和结果', transfer: '用同样结构解释另一个小决定',
    opening: 'What is one decision you made recently, and what did you choose?',
    followUps: ['What alternatives did you consider?', 'What influenced your choice?', 'Would you make the same choice again?'],
    phrases: ['I decided to', 'what influenced me most was'] },
  { topic: '说明一个问题及解决过程', establish: '选一个自己真正遇到的小问题',
    develop: '交代问题、尝试、调整和最终结果', transfer: '换一个场景简短复述解决方法',
    opening: 'What is a small problem you dealt with recently?',
    followUps: ['What did you try first?', 'Why did you change your approach?', 'What did you learn from it?'],
    phrases: ['I dealt with it by', 'that approach worked because'] },
  { topic: '比较两种熟悉的选择', establish: '确定两个自己熟悉且真正用过的选择',
    develop: '比较优点、限制和适用场景', transfer: '给一个具体的人提出有理由的建议',
    opening: 'What are two ways of doing something that you know well?',
    followUps: ['What is the biggest difference?', 'When does each option work best?', 'Which would you recommend and why?'],
    phrases: ['whereas', 'is better suited to'] }
];

function lessonTask(profile) {
  return LESSON_TASK_POOL[(profile.sessionSummaries?.length || 0) % LESSON_TASK_POOL.length];
}

export function createDefaultProfile() {
  return {
    version: 1,
    learnerId: "local-default",
    updatedAt: null,
    stableBand: null,
    stableRange: null,
    targetBand: null,
    confidence: 0,
    confidenceGate: {
      threshold: 90,
      verified: false,
      missing: ["完成 3 轮标准化测评", "至少跨 2 个日期复测", "保持多轮结果一致"]
    },
    dimensions: {
      fluencyCoherence: null,
      lexicalResource: null,
      grammaticalRangeAccuracy: null,
      pronunciationIntelligibility: null,
      listening: null
    },
    activeNeeds: [],
    masteredItems: [],
    skillMemory: {},
    curriculumProgress: createCurriculumProgress(),
    assessmentHistory: [],
    latestAssessmentReport: null,
    pronunciationProfile: {
      status: "unmeasured",
      confidence: 0,
      sampleCount: 0,
      totalSeconds: 0,
      distinctDates: 0,
      provisionalScore: null,
      lastReport: null,
      samples: [],
      missing: ["完成 60–90 秒朗读采样", "至少 3 次跨日复测"]
    },
    sessionSummaries: [],
    currentSession: null,
    assessment: {
      status: "not_started",
      attemptId: null,
      currentTaskIndex: 0,
      formId: null,
      formTier: null,
      taskIds: [],
      startedAt: null,
      completedAt: null,
      answerEvidenceIds: []
    },
    evidence: []
  };
}

export function normalizeProfile(raw) {
  const base = createDefaultProfile();
  if (!raw || typeof raw !== "object") return base;
  const assessment = {
    ...base.assessment,
    ...(raw.assessment || {}),
    taskIds: Array.isArray(raw.assessment?.taskIds) ? raw.assessment.taskIds.slice(0, 4) : []
  };
  if (assessment.status === "in_progress" && !assessment.taskIds.length) {
    assessment.taskIds = [...LEGACY_TASK_IDS];
    assessment.formId = "developing-travel-05";
    assessment.formTier = 1;
  }
  const dimensions = { ...base.dimensions, ...(raw.dimensions || {}) };
  // The local read-aloud analyser measures coverage, pace, pauses and pitch
  // variation. Those are useful practice signals, but they are not an IELTS
  // pronunciation band and must never be shown as one.
  if (raw.pronunciationProfile?.sampleCount && raw.pronunciationDimensionSource !== 'ielts_assessment') {
    dimensions.pronunciationIntelligibility = null;
  }
  return {
    ...base,
    ...raw,
    confidenceGate: { ...base.confidenceGate, ...(raw.confidenceGate || {}) },
    dimensions,
    assessment,
    activeNeeds: Array.isArray(raw.activeNeeds) ? raw.activeNeeds.slice(0, 3) : [],
    masteredItems: Array.isArray(raw.masteredItems) ? raw.masteredItems.slice(0, 3) : [],
    skillMemory: raw.skillMemory && typeof raw.skillMemory === "object" ? raw.skillMemory : {},
    curriculumProgress: normalizeCurriculumProgress(raw.curriculumProgress),
    assessmentHistory: Array.isArray(raw.assessmentHistory) ? raw.assessmentHistory.slice(-20) : [],
    latestAssessmentReport: raw.latestAssessmentReport && typeof raw.latestAssessmentReport === "object"
      ? {
          ...raw.latestAssessmentReport,
          items: Array.isArray(raw.latestAssessmentReport.items) ? raw.latestAssessmentReport.items.slice(0, 4) : []
        }
      : null,
    pronunciationProfile: raw.pronunciationProfile && typeof raw.pronunciationProfile === "object"
      ? {
          ...base.pronunciationProfile,
          ...raw.pronunciationProfile,
          samples: Array.isArray(raw.pronunciationProfile.samples) ? raw.pronunciationProfile.samples.slice(-12) : [],
          missing: Array.isArray(raw.pronunciationProfile.missing) ? raw.pronunciationProfile.missing.slice(0, 4) : base.pronunciationProfile.missing
        }
      : base.pronunciationProfile,
    sessionSummaries: Array.isArray(raw.sessionSummaries) ? raw.sessionSummaries.slice(-60) : [],
    currentSession: raw.currentSession && typeof raw.currentSession === "object" ? raw.currentSession : null,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(-24) : []
  };
}

export function publicTask(task, profile = null) {
  if (!task) return null;
  const { expectedEvidence, answerChecks, minimumWords, ...visible } = task;
  const taskIds = profile?.assessment?.taskIds?.length ? profile.assessment.taskIds : LEGACY_TASK_IDS;
  return { ...visible, index: taskIds.indexOf(task.id) + 1, total: taskIds.length };
}

export function currentAssessmentTask(profile) {
  if (profile.assessment.status !== "in_progress") return null;
  const taskIds = profile.assessment.taskIds?.length ? profile.assessment.taskIds : LEGACY_TASK_IDS;
  return assessmentTaskById(taskIds[profile.assessment.currentTaskIndex]) || null;
}

export function startAssessment(profile, now = new Date().toISOString()) {
  const next = normalizeProfile(structuredClone(profile));
  if (next.assessment.status === "in_progress" && currentAssessmentTask(next)) return next;
  const selectedForm = selectAssessmentForm(next);
  next.assessment = {
    status: "in_progress",
    attemptId: `assessment-${Date.now()}`,
    currentTaskIndex: 0,
    formId: selectedForm.id,
    formTier: selectedForm.tier,
    taskIds: selectedForm.tasks.map(task => task.id),
    startedAt: now,
    completedAt: null,
    answerEvidenceIds: []
  };
  next.updatedAt = now;
  return next;
}

export function advanceAssessmentCheckpoint(profile, now = new Date().toISOString()) {
  const next = normalizeProfile(structuredClone(profile));
  if (next.assessment.status !== "in_progress" || !currentAssessmentTask(next)) {
    throw new Error("当前没有可继续的测评题目");
  }
  if (next.assessment.currentTaskIndex >= next.assessment.taskIds.length - 1) {
    throw new Error("最后一道题必须完成整套综合评分");
  }
  next.assessment.currentTaskIndex += 1;
  next.updatedAt = now;
  return next;
}

function rankedLabels(evidence, field, labels, maximum) {
  const counts = new Map();
  for (const item of evidence) {
    const tag = item[field];
    if (!tag || tag === "none") continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maximum)
    .map(([tag]) => labels[tag] || tag);
}

function recomputeProfile(profile) {
  const assessmentEvidence = profile.evidence.filter(item => item.kind === "assessment");
  const speaking = assessmentEvidence.filter(item => item.taskKind === "speaking" && item.scores);
  const listening = assessmentEvidence.filter(item => item.taskKind === "listening");
  const recentSpeaking = speaking.slice(-6);
  const newestAttemptIds = new Set(profile.assessment.answerEvidenceIds);
  const newestSpeaking = recentSpeaking.filter(item => newestAttemptIds.has(item.id));

  if (recentSpeaking.length) {
    const observed = {
      fluencyCoherence: roundBand(average(recentSpeaking.map(item => item.scores.fluencyCoherence))),
      lexicalResource: roundBand(average(recentSpeaking.map(item => item.scores.lexicalResource))),
      grammaticalRangeAccuracy: roundBand(average(recentSpeaking.map(item => item.scores.grammaticalRangeAccuracy)))
    };
    profile.dimensions = { ...profile.dimensions, ...observed };
    const currentObserved = newestSpeaking.length ? roundBand(average(newestSpeaking.flatMap(item => [
      item.scores.fluencyCoherence,
      item.scores.lexicalResource,
      item.scores.grammaticalRangeAccuracy
    ]))) : null;
    if (profile.assessment.status === "completed" && newestSpeaking.length >= 3) {
      if (profile.stableBand == null) profile.stableBand = currentObserved;
      else profile.stableBand = roundBand(profile.stableBand + clamp(currentObserved - profile.stableBand, -0.5, 0.5));
    }
    profile.targetBand = profile.stableBand == null ? null : roundBand(Math.min(9, profile.stableBand + 0.5));
  }

  if (listening.length) {
    profile.dimensions.listening = Math.round(average(listening.slice(-4).map(item => item.listeningAccuracy)) * 100);
  }

  const currentAttemptEvidence = profile.assessment.answerEvidenceIds
    .map(id => profile.evidence.find(item => item.id === id))
    .filter(Boolean);
  const voiceCount = currentAttemptEvidence.filter(item => item.source === "voice").length;
  const completedTasks = currentAttemptEvidence.length;
  const completedAttempts = profile.assessmentHistory.length;
  const distinctDates = new Set(profile.assessmentHistory.map(item => String(item.completedAt || "").slice(0, 10))).size;
  const attemptBands = profile.assessmentHistory.map(item => item.observedBand).filter(value => Number.isFinite(value));
  const bandMean = average(attemptBands);
  const bandSpread = attemptBands.length
    ? Math.sqrt(average(attemptBands.map(value => (value - bandMean) ** 2)))
    : null;
  const historicalVoiceItems = assessmentEvidence.filter(item => item.source === "voice").length;
  const voiceCoverage = assessmentEvidence.length ? historicalVoiceItems / assessmentEvidence.length : 0;
  if (completedAttempts === 0) profile.confidence = clamp(18 + completedTasks * 10 + voiceCount * 3, 0, 68);
  else if (completedAttempts === 1) profile.confidence = 70;
  else if (completedAttempts === 2) profile.confidence = 82;
  else {
    const passesHighConfidenceGate = distinctDates >= 2
      && speaking.length >= 9
      && listening.length >= 3
      && voiceCoverage >= 0.75
      && bandSpread != null
      && bandSpread <= 0.75;
    profile.confidence = passesHighConfidenceGate ? 90 : 86;
  }
  const missing = [];
  if (completedAttempts < 3) missing.push(`还需 ${3 - completedAttempts} 轮标准化测评`);
  if (distinctDates < 2) missing.push("至少跨 2 个日期复测");
  if (voiceCoverage < 0.75) missing.push("语音作答覆盖率达到 75%");
  if (attemptBands.length >= 2 && bandSpread > 0.75) missing.push("多轮水平结果保持一致");
  profile.confidenceGate = { threshold: 90, verified: profile.confidence >= 90, missing };
  if (profile.stableBand != null) {
    const margin = profile.confidence >= 90 ? 0.5 : 1;
    profile.stableRange = [roundBand(Math.max(1, profile.stableBand - margin)), roundBand(Math.min(9, profile.stableBand + margin))];
  }

  const recent = assessmentEvidence.slice(-8);
  profile.activeNeeds = rankedLabels(recent, "priorityTag", NEED_LABELS, 3);
  profile.masteredItems = rankedLabels(recent, "strengthTag", STRENGTH_LABELS, 2);
  if (profile.dimensions.pronunciationIntelligibility == null && !profile.activeNeeds.includes("发音仍需专门采样")) {
    profile.activeNeeds.push("发音仍需专门采样");
  }
  profile.activeNeeds = profile.activeNeeds.slice(0, 3);
  if (!profile.masteredItems.length && completedTasks) profile.masteredItems = ["已完成有效作答"];
  return profile;
}

export function addAssessmentEvidence(profile, task, answer, evaluation, now = new Date().toISOString()) {
  const next = normalizeProfile(structuredClone(profile));
  const id = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const evidence = {
    id,
    kind: "assessment",
    attemptId: next.assessment.attemptId,
    taskId: task.id,
    taskKind: task.kind,
    at: now,
    source: answer.source,
    wordCount: answer.wordCount,
    durationSeconds: answer.durationSeconds,
    asrConfidence: answer.asrConfidence,
    scores: task.kind === "speaking" ? {
      fluencyCoherence: roundBand(evaluation.scores.fluencyCoherence),
      lexicalResource: roundBand(evaluation.scores.lexicalResource),
      grammaticalRangeAccuracy: roundBand(evaluation.scores.grammaticalRangeAccuracy)
    } : null,
    listeningAccuracy: task.kind === "listening" ? clamp(Number(evaluation.listeningAccuracy) || 0, 0, 1) : null,
    strengthTag: evaluation.strengthTag || "none",
    priorityTag: evaluation.priorityTag || "none"
  };
  const cutoff = Date.now() - 90 * DAY_MS;
  next.evidence = [...next.evidence, evidence]
    .filter(item => Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) >= cutoff)
    .slice(-24);
  next.assessment.answerEvidenceIds.push(id);
  next.assessment.currentTaskIndex += 1;
  const taskTotal = next.assessment.taskIds?.length || 4;
  if (next.assessment.currentTaskIndex >= taskTotal) {
    next.assessment.status = "completed";
    next.assessment.completedAt = now;
    const attemptItems = next.assessment.answerEvidenceIds
      .map(evidenceId => next.evidence.find(item => item.id === evidenceId))
      .filter(Boolean);
    const attemptSpeakingScores = attemptItems
      .filter(item => item.taskKind === "speaking" && item.scores)
      .flatMap(item => Object.values(item.scores));
    next.assessmentHistory = [...next.assessmentHistory, {
      attemptId: next.assessment.attemptId,
      formId: next.assessment.formId,
      formTier: next.assessment.formTier,
      completedAt: now,
      evidenceCount: attemptItems.length,
      voiceCount: attemptItems.filter(item => item.source === "voice").length,
      observedBand: attemptSpeakingScores.length ? roundBand(average(attemptSpeakingScores)) : null,
      listeningAccuracy: attemptItems.find(item => item.taskKind === "listening")?.listeningAccuracy ?? null
    }].slice(-20);
  }
  next.updatedAt = now;
  return recomputeProfile(next);
}

function updateSkillMemory(profile, patch, now, sessionId) {
  if (!patch || !SKILL_LABELS[patch.skillKey] || patch.signal === "neutral") return;
  const previous = profile.skillMemory[patch.skillKey] || {
    key: patch.skillKey,
    label: SKILL_LABELS[patch.skillKey],
    status: "watch",
    needProbability: 0.5,
    evidenceWeight: 0,
    confirmations: 0,
    contradictions: 0,
    lastSeen: null,
    note: ""
  };
  const qualityWeight = { low: 0.08, medium: 0.16, high: 0.26 }[patch.evidenceQuality] || 0.1;
  const weight = qualityWeight * clamp(Number(patch.confidence) || 0.5, 0.25, 1);
  const target = patch.signal === "weakness" ? 1 : 0;
  const needProbability = clamp(previous.needProbability * (1 - weight) + target * weight, 0, 1);
  const confirmations = previous.confirmations + (patch.signal === "strength" ? 1 : 0);
  const contradictions = previous.contradictions + (patch.signal === "weakness" ? 1 : 0);
  const confirmationSessions = [...new Set([...(previous.confirmationSessions || []), ...(patch.signal === 'strength' ? [sessionId] : [])])].slice(-12);
  const confirmationDates = [...new Set([...(previous.confirmationDates || []), ...(patch.signal === 'strength' ? [now.slice(0,10)] : [])])].slice(-12);
  let status = "watch";
  if (needProbability >= 0.62 && contradictions >= 2) status = "active";
  if (needProbability <= 0.30 && confirmationSessions.length >= 3 && confirmationDates.length >= 2) status = "mastered";
  profile.skillMemory[patch.skillKey] = {
    ...previous,
    status,
    needProbability: Math.round(needProbability * 100) / 100,
    evidenceWeight: Math.round((previous.evidenceWeight + weight) * 100) / 100,
    confirmations,
    contradictions,
    confirmationSessions,
    confirmationDates,
    lastSeen: now,
    note: String(patch.noteZh || previous.note).slice(0, 80)
  };

  const cutoff = Date.now() - 90 * DAY_MS;
  profile.skillMemory = Object.fromEntries(Object.entries(profile.skillMemory)
    .filter(([, item]) => Number.isFinite(Date.parse(item.lastSeen)) && Date.parse(item.lastSeen) >= cutoff)
    .sort((left, right) => Date.parse(right[1].lastSeen) - Date.parse(left[1].lastSeen))
    .slice(0, 8));
  const active = Object.values(profile.skillMemory)
    .filter(item => item.status === "active")
    .sort((left, right) => right.needProbability - left.needProbability)
    .map(item => item.label);
  const mastered = Object.values(profile.skillMemory)
    .filter(item => item.status === "mastered")
    .sort((left, right) => left.needProbability - right.needProbability)
    .map(item => item.label);
  profile.activeNeeds = [...new Set([...active, ...profile.activeNeeds.filter(label => !mastered.includes(label))])].slice(0, 3);
  profile.masteredItems = [...new Set([...mastered, ...profile.masteredItems.filter(label => !active.includes(label))])].slice(0, 3);
}

export function publicLevelSummary(profile) {
  const range = profile?.stableRange?.length === 2
    ? `${Number(profile.stableRange[0]).toFixed(1)}–${Number(profile.stableRange[1]).toFixed(1)}`
    : null;
  if (!range) return '目前水平仍在建立中，我会先从熟悉话题稳步观察。';
  const need = profile.activeNeeds?.[0];
  return `目前大约 ${range}${need ? `，下一步重点练习${need}` : '，接下来继续巩固自然表达'}。`;
}

function compileSessionBrief(profile, duration, mode, nextMove = "probe", curriculumPlanInput = null) {
  const primary = profile.activeNeeds[0] || "建立可靠基线";
  const task = lessonTask(profile);
  const coreTopic = task.topic;
  const strengths = profile.masteredItems.length ? profile.masteredItems.slice(0, 2) : ["暂无稳定结论"];
  const curriculumPlan = curriculumPlanInput || planCurriculum(profile, { duration });
  return {
    compiledAt: new Date().toISOString(),
    bandContext: publicLevelSummary(profile),
    mode,
    duration,
    focus: [coreTopic, primary],
    strengths,
    route: [
      `起：${task.establish}`,
      `承：${task.develop}`,
      `转：针对“${primary}”提供短支架并立即重说`,
      `收：${task.transfer}，再决定如何更新印象`
    ],
    curriculumPlan,
    nextMove,
    contextRule: "每轮只携带本摘要和最近必要信号，不载入历史原文"
  };
}

function archiveCurrentSession(profile, now, curriculumEvidence = null) {
  if (!profile.currentSession) return null;
  const session = profile.currentSession;
  const observations = Array.isArray(session.observations) ? session.observations : [];
  // Correlated answers in one class count as ONE update, not independent proof
  // of mastery. The lesson brief and stable portrait never change mid-class.
  const groups = new Map();
  for (const observation of observations) {
    const patch = observation.patch;
    if (!patch || !SKILL_LABELS[patch.skillKey] || !['strength','weakness'].includes(patch.signal)) continue;
    const group = groups.get(patch.skillKey) || [];
    group.push(patch); groups.set(patch.skillKey, group);
  }
  for (const patches of groups.values()) {
    const positives = patches.filter(p => p.signal === 'strength');
    const negatives = patches.filter(p => p.signal === 'weakness');
    const majority = positives.length > negatives.length ? positives : negatives;
    // A lone correct sentence or strongly contradictory class remains a hypothesis.
    if (majority.length < 2 || majority.length / patches.length < .75) continue;
    const patch = majority.at(-1);
    updateSkillMemory(profile, { ...patch, evidenceQuality: majority.length >= 3 ? patch.evidenceQuality : 'medium' }, now, session.sessionId);
  }
  const strengths = [];
  const needs = [];
  const mixedSignals = [];
  for (const [skillKey, patches] of groups) {
    const positives = patches.filter(patch => patch.signal === 'strength').length;
    const negatives = patches.filter(patch => patch.signal === 'weakness').length;
    const majority = Math.max(positives, negatives);
    const label = SKILL_LABELS[skillKey];
    if (majority >= 2 && majority / patches.length >= .75) {
      (positives > negatives ? strengths : needs).push(label);
    } else if (positives && negatives) {
      mixedSignals.push(label);
    }
  }
  const voiceTurns = observations.filter(item => item.source === "voice").length;
  const typedTurns = observations.filter(item => item.source === "typed").length;
  const averageWords = observations.length ? Math.round(average(observations.map(item => item.wordCount || 0))) : 0;
  const summary = {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    endedAt: now,
    mode: session.mode,
    duration: session.duration,
    turnCount: session.turnCount || 0,
    voiceTurns,
    typedTurns,
    averageWords,
    focus: session.focus,
    topicDomain: session.topicDomain || session.brief?.topicDomain || null,
    observedStrengths: strengths.slice(0, 2),
    observedNeeds: needs.slice(0, 2),
    mixedSignals: mixedSignals.slice(0, 2),
    nextFocus: profile.activeNeeds.slice(0, 2)
  };
  if (summary.turnCount > 0) {
    profile.sessionSummaries = [...profile.sessionSummaries, summary].slice(-60);
    const lessonEvidence = {
      id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "lesson-summary",
      at: now,
      sessionId: session.sessionId,
      turnCount: summary.turnCount,
      voiceTurns,
      typedTurns,
      averageWords,
      observedStrengths: summary.observedStrengths,
      observedNeeds: summary.observedNeeds,
      mixedSignals: summary.mixedSignals
    };
    const cutoff = Date.now() - 90 * DAY_MS;
    profile.evidence = [...profile.evidence, lessonEvidence]
      .filter(item => Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) >= cutoff)
      .slice(-24);
    if (curriculumEvidence?.sessionId === session.sessionId && Array.isArray(curriculumEvidence.nodes)) {
      const curriculumPlan = session.curriculumPlan || session.brief?.curriculumPlan;
      const plannedNodeIds = new Set((Array.isArray(curriculumPlan?.plannedTargets) ? curriculumPlan.plannedTargets : [])
        .map(target => target?.id).filter(Boolean));
      const outcomesByNode = new Map(curriculumEvidence.nodes
        .filter(item => item && typeof item.nodeId === 'string'
          && plannedNodeIds.has(item.nodeId)
          && ['practised', 'recalled_independently', 'recalled_with_help', 'forgotten'].includes(item.outcome))
        .map(item => [item.nodeId, item.outcome]));
      const practisedNodeIds = [...outcomesByNode.keys()];
      if (practisedNodeIds.length) {
        profile.curriculumProgress = commitCurriculumLesson(profile.curriculumProgress, {
          endedAt: now,
          practisedNodeIds,
          successfulNodeIds: practisedNodeIds.filter(id => outcomesByNode.get(id) === 'recalled_independently'),
          unsuccessfulNodeIds: practisedNodeIds.filter(id => ['recalled_with_help', 'forgotten'].includes(outcomesByNode.get(id)))
        });
      }
    }
  }
  profile.currentSession = null;
  return summary;
}

export function prepareLessonSession(profile, duration = 30, mode = "speaking", now = new Date().toISOString(), compiled = null) {
  const next = normalizeProfile(structuredClone(profile));
  archiveCurrentSession(next, now);
  const curriculumPlan = compiled?.curriculumPlan || compiled?.brief?.curriculumPlan
    || planCurriculum(next, { now, duration, ledgerPlan: compiled?.pedagogyPlan || null });
  const plan = compiled?.plan || buildPersonalizedPlan(next, duration, mode, curriculumPlan);
  const brief = compiled?.brief || compileSessionBrief(next, duration, mode, 'probe', curriculumPlan);
  plan.curriculumPlan ||= curriculumPlan;
  brief.curriculumPlan ||= curriculumPlan;
  next.currentSession = {
    sessionId: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    startedAt: now,
    lastTurnAt: null,
    mode,
    duration,
    focus: brief.focus,
    topicDomain: brief.topicDomain || null,
    turnCount: 0,
    observations: [],
    curriculumPlan,
    brief
  };
  next.updatedAt = now;
  return { profile: next, plan, brief };
}

export function finishLessonSession(profile, nowOrOptions = new Date().toISOString()) {
  const options = nowOrOptions && typeof nowOrOptions === 'object' ? nowOrOptions : null;
  const now = options ? (options.now || new Date().toISOString()) : nowOrOptions;
  const next = normalizeProfile(structuredClone(profile));
  const summary = archiveCurrentSession(next, now, options?.curriculumEvidence || null);
  next.updatedAt = now;
  return { profile: next, summary };
}

export function addConversationObservation(profile, observation, now = new Date().toISOString()) {
  const next = normalizeProfile(structuredClone(profile));
  if (!next.currentSession || observation.wordCount < 1) return next;
  const patch = observation.wordCount >= 4 ? observation.memoryPatch || null : null;
  if (next.currentSession) {
    next.currentSession.turnCount += 1;
    next.currentSession.lastTurnAt = now;
    next.currentSession.observations = [...next.currentSession.observations, {
      at: now,
      source: observation.source || "unknown",
      wordCount: observation.wordCount,
      connectors: observation.connectors,
      specifics: observation.specifics,
      skillKey: patch?.skillKey || null,
      signal: patch?.signal || "neutral",
      confidence: clamp(Number(patch?.confidence) || 0, 0, 1),
      nextMove: patch?.nextMove || "probe",
      patch: patch ? { skillKey: patch.skillKey, signal: patch.signal, evidenceQuality: patch.evidenceQuality,
        confidence: clamp(Number(patch.confidence) || 0, 0, 1), noteZh: String(patch.noteZh || '').slice(0,80), nextMove: patch.nextMove } : null
    }].slice(-120);
    next.currentSession.nextMove = patch?.nextMove || 'probe';
  }
  next.updatedAt = now;
  return next;
}

export function addPronunciationSample(profile, report, now = new Date().toISOString()) {
  const next = normalizeProfile(structuredClone(profile));
  const previous = next.pronunciationProfile;
  const sample = {
    at: now,
    passageId: String(report.passageId || "unknown").slice(0, 60),
    durationSeconds: Math.round((Number(report.durationSeconds) || 0) * 10) / 10,
    recognisedWords: Math.max(0, Number(report.recognisedWords) || 0),
    wordCoverage: clamp(Number(report.wordCoverage) || 0, 0, 1),
    wordsPerMinute: Math.max(0, Math.round(Number(report.wordsPerMinute) || 0)),
    pauseRatio: clamp(Number(report.pauseRatio) || 0, 0, 1),
    longPauseCount: Math.max(0, Math.round(Number(report.longPauseCount) || 0)),
    intonationRangeSemitones: Math.max(0, Math.round((Number(report.intonationRangeSemitones) || 0) * 10) / 10),
    clarityScore: clamp(Math.round(Number(report.clarityScore) || 0), 0, 100),
    pacingScore: clamp(Math.round(Number(report.pacingScore) || 0), 0, 100),
    rhythmScore: clamp(Math.round(Number(report.rhythmScore) || 0), 0, 100)
  };
  const cutoff = Date.now() - 120 * DAY_MS;
  const samples = [...previous.samples, sample]
    .filter(item => Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) >= cutoff)
    .slice(-12);
  const totalSeconds = Math.round(samples.reduce((sum, item) => sum + item.durationSeconds, 0) * 10) / 10;
  const dates = new Set(samples.map(item => String(item.at).slice(0, 10)));
  const recentScores = samples.slice(-3).map(item => item.clarityScore);
  const provisionalScore = recentScores.length ? Math.round(average(recentScores)) : null;
  let confidence = 0;
  if (totalSeconds >= 45) confidence = 45;
  if (totalSeconds >= 90 && samples.length >= 2) confidence = 68;
  if (totalSeconds >= 150 && samples.length >= 3 && dates.size >= 2) confidence = 82;
  if (totalSeconds >= 180 && samples.length >= 3 && dates.size >= 3) confidence = 90;
  const missing = [];
  if (totalSeconds < 90) missing.push(`还需约 ${Math.ceil(90 - totalSeconds)} 秒有效朗读`);
  if (samples.length < 3) missing.push(`还需 ${3 - samples.length} 次独立采样`);
  if (dates.size < 3) missing.push("至少跨 3 个日期复测");
  next.pronunciationProfile = {
    status: confidence >= 90 ? "stable" : "provisional",
    confidence,
    sampleCount: samples.length,
    totalSeconds,
    distinctDates: dates.size,
    provisionalScore,
    lastReport: { ...sample, suggestionsZh: Array.isArray(report.suggestionsZh) ? report.suggestionsZh.slice(0, 4) : [] },
    samples,
    missing
  };
  // Keep provisionalScore as an acoustic practice score (0–100). Do not map
  // it onto the 1–9 IELTS scale: the recording does not evidence all four
  // official speaking dimensions or a human pronunciation judgement.
  next.dimensions.pronunciationIntelligibility = next.pronunciationDimensionSource === 'ielts_assessment'
    ? next.dimensions.pronunciationIntelligibility : null;
  next.activeNeeds = next.activeNeeds.filter(item => item !== "发音仍需专门采样");
  if (confidence < 90 && !next.activeNeeds.includes("发音证据仍需复测")) next.activeNeeds.push("发音证据仍需复测");
  next.activeNeeds = next.activeNeeds.slice(0, 3);
  next.updatedAt = now;
  return next;
}

export function fallbackEvaluation(task, text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const connectors = (text.match(/\b(because|although|however|so|while|which|when|if|for example)\b/gi) || []).length;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const uniqueRatio = new Set(words.map(word => word.toLowerCase().replace(/[^a-z']/g, ""))).size / Math.max(1, words.length);
  const lengthBase = words.length >= 45 ? 6 : words.length >= 25 ? 5.5 : words.length >= 12 ? 5 : 4.5;
  if (task.kind === "listening") {
    const normalized = text.toLowerCase();
    const checks = (task.answerChecks || []).map(pattern => new RegExp(pattern, "i").test(normalized));
    const accuracy = checks.length ? checks.filter(Boolean).length / checks.length : 0;
    return {
      scores: { fluencyCoherence: 5, lexicalResource: 5, grammaticalRangeAccuracy: 5 },
      listeningAccuracy: accuracy,
      strengthTag: accuracy >= 0.5 ? "listening_detail" : "none",
      priorityTag: accuracy === 1 ? "none" : "listening_detail",
      feedbackZh: accuracy === 1 ? "两个关键信息都听到了。" : "再注意原因和最终结果这两个信息点。",
      betterAnswer: task.expectedEvidence || "Please include both requested details in one clear sentence."
    };
  }
  return {
    scores: {
      fluencyCoherence: roundBand(lengthBase + Math.min(0.5, connectors * 0.25)),
      lexicalResource: roundBand(lengthBase + (uniqueRatio > 0.72 ? 0.5 : 0)),
      grammaticalRangeAccuracy: roundBand(lengthBase + (sentences >= 3 ? 0.5 : 0))
    },
    listeningAccuracy: 0,
    strengthTag: connectors ? "cohesion" : words.length >= 20 ? "detail" : "relevance",
    priorityTag: words.length < 20 ? "fluency_extension" : connectors ? "grammar_range" : "cohesion",
    feedbackZh: words.length < 20 ? "回答切题，但还需要用原因和细节继续展开。" : "回答有效；下一步继续提高自然衔接和句式变化。",
    betterAnswer: text
  };
}

export function buildPersonalizedPlan(profile, duration = 30, mode = "speaking", curriculumPlanInput = null) {
  const minutes = Number(duration) === 60 ? [6, 16, 23, 15] : Number(duration) === 20 ? [3, 5, 7, 5] : [4, 8, 10, 8];
  const primary = profile.activeNeeds[0] || "建立口语基线";
  const secondary = profile.activeNeeds[1] || "自然表达与听力理解";
  const listeningWeak = profile.dimensions.listening != null && profile.dimensions.listening < 75;
  const focusActivity = {
    "回答展开与流利度": "用“观点—原因—细节”把短回答扩展到三句",
    "衔接与逻辑": "重组一段回答并练习自然连接",
    "词汇准确与自然搭配": "从本人原话中选一个高频搭配，在两个语境中复用",
    "句式范围": "只选一种当前最需要的关系（原因、让步或条件）扩展句子",
    "语法准确度": "修复高频错误后立即换题复练",
    "听取关键信息": "短音频两遍内提取原因、数字和结果",
    "发音仍需专门采样": "采集较长语音并检查重音、停顿和可懂度"
  }[primary] || "建立稳定基线并观察回答展开方式";
  const listeningActivity = listeningWeak || mode === "listening" || mode === "balanced"
    ? "听一段自然英语，复述主旨并回答两个细节问题"
    : "听教师追问并用同义表达复述要点";
  const bandText = profile.stableRange ? `${profile.stableRange[0].toFixed(1)}–${profile.stableRange[1].toFixed(1)}` : "待测";
  const task = lessonTask(profile);
  const coreTopic = task.topic;
  const curriculumPlan = curriculumPlanInput || planCurriculum(profile, { duration });
  const mapObjectives = curriculumPlan.plannedTargets.map(item => item.labelZh);
  return {
    title: `${coreTopic} · ${profile.stableBand == null ? primary : `${bandText} ${primary}`}`,
    objectives: [mapObjectives[0] || primary, mapObjectives[1] || secondary],
    segments: [
      { minutes: minutes[0], title: "建立真实素材", activity: task.establish },
      { minutes: minutes[1], title: "展开核心任务", activity: task.develop },
      { minutes: minutes[2], title: "针对修复", activity: `${focusActivity}，并重说刚才的内容` },
      { minutes: minutes[3], title: "迁移复练", activity: `${listeningActivity}；${task.transfer}` }
    ],
    openingQuestion: task.opening,
    followUps: task.followUps,
    naturalPhrases: task.phrases,
    successCriteria: [curriculumPlan.completionCriteria[1], curriculumPlan.completionCriteria[2]],
    curriculumPlan
  };
}
