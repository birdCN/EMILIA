import { learningDay } from './public/lesson-policy.js';
const DAY_MS = 24 * 60 * 60 * 1_000;
export const CURRICULUM_VERSION = 1;

const node = (id, labelZh, outcomeZh, minBand, prerequisites = []) => ({
  id, labelZh, outcomeZh, minBand, prerequisites
});

export const CURRICULUM_TRACKS = {
  communication: {
    labelZh: '沟通功能',
    nodes: [
      node('communication-extended-answer', '展开熟悉话题', '用观点、原因和细节完成自然回答', 3),
      node('communication-narrative', '讲述真实经历', '清楚交代背景、过程、转折和结果', 4, ['communication-extended-answer']),
      node('communication-compare-explain', '比较并解释选择', '比较两种选择并说明适用条件', 4.5, ['communication-extended-answer']),
      node('communication-position', '形成并支持观点', '提出立场、理由、例子和适度限定', 5.5, ['communication-compare-explain'])
    ]
  },
  lexis: {
    labelZh: '词汇与搭配',
    nodes: [
      node('lexis-core-precision', '常用词准确表达', '减少宽泛用词并选用准确常用词', 3),
      node('lexis-natural-collocations', '自然搭配', '在不同语境自然复用一个高频搭配', 4, ['lexis-core-precision']),
      node('lexis-paraphrase', '同义改述', '不用生僻词也能自然换一种说法', 5, ['lexis-natural-collocations']),
      node('lexis-register-nuance', '语域与细微差别', '按情境选择准确且得体的表达', 6, ['lexis-paraphrase'])
    ]
  },
  grammar: {
    labelZh: '语法与句式',
    nodes: [
      node('grammar-core-control', '核心语法稳定性', '稳定使用时态、主谓一致和基本句序', 3),
      node('grammar-relationships', '表达逻辑关系', '自然表达原因、条件、让步和结果', 4.5, ['grammar-core-control']),
      node('grammar-complex-control', '复杂句控制', '在较长回答中准确使用从句和修饰结构', 5.5, ['grammar-relationships'])
    ]
  },
  fluency: {
    labelZh: '连贯与流利',
    nodes: [
      node('fluency-thought-groups', '意群表达', '用自然短语块组织回答而非逐词拼接', 3),
      node('fluency-cohesive-development', '连贯展开', '不用堆连接词也能让信息顺畅推进', 4.5, ['fluency-thought-groups']),
      node('fluency-repair-extend', '修正并持续表达', '卡顿或改口后能自然继续完成长回答', 5.5, ['fluency-cohesive-development'])
    ]
  },
  listening: {
    labelZh: '听力理解',
    nodes: [
      node('listening-gist-key-detail', '主旨与关键细节', '听清主旨、原因、数字和结果', 3),
      node('listening-paraphrase', '识别同义表达', '识别问题与语音中的改述关系', 4.5, ['listening-gist-key-detail']),
      node('listening-attitude-inference', '态度与隐含意义', '结合语气和上下文判断说话者态度', 5.5, ['listening-paraphrase'])
    ]
  },
  pronunciation: {
    labelZh: '发音与韵律',
    nodes: [
      node('pronunciation-intelligibility', '清晰可懂', '关键词和词尾能被稳定听清', 3),
      node('pronunciation-stress-rhythm', '重音与节奏', '用句子重音和意群停顿突出信息', 4.5, ['pronunciation-intelligibility']),
      node('pronunciation-intonation', '语调与表达意图', '用自然语调区分陈述、强调和态度', 5.5, ['pronunciation-stress-rhythm'])
    ]
  }
};

const ALL_NODES = Object.entries(CURRICULUM_TRACKS).flatMap(([track, value]) =>
  value.nodes.map(item => ({ ...item, track, trackLabelZh: value.labelZh })));
const NODE_BY_ID = new Map(ALL_NODES.map(item => [item.id, item]));
const VALID_STATUS = new Set(['unstarted', 'practising', 'review', 'secure']);
const NEED_TRACK = [
  [/词汇|搭配|lexical|vocabulary|collocation|paraphrase/i, 'lexis'],
  [/语法|句式|grammar|sentence_structure/i, 'grammar'],
  [/衔接|逻辑|流利|展开|cohesion|fluency/i, 'fluency'],
  [/听|listening/i, 'listening'],
  [/发音|重音|语调|pronunciation/i, 'pronunciation']
];

const validDate = value => Number.isFinite(Date.parse(value));
const isoDay = value => validDate(value) ? learningDay(value) : null;

export function createCurriculumProgress() {
  return { version: CURRICULUM_VERSION, nodes: {} };
}

export function normalizeCurriculumProgress(raw) {
  const next = createCurriculumProgress();
  if (!raw || typeof raw !== 'object' || !raw.nodes || typeof raw.nodes !== 'object') return next;
  for (const [id, value] of Object.entries(raw.nodes)) {
    if (!NODE_BY_ID.has(id) || !value || typeof value !== 'object') continue;
    next.nodes[id] = {
      status: VALID_STATUS.has(value.status) ? value.status : 'unstarted',
      attempts: Math.max(0, Math.round(Number(value.attempts) || 0)),
      successfulDates: [...new Set((Array.isArray(value.successfulDates) ? value.successfulDates : [])
        .map(isoDay).filter(Boolean))].slice(-8),
      lastPractisedAt: validDate(value.lastPractisedAt) ? new Date(value.lastPractisedAt).toISOString() : null,
      nextReviewAt: validDate(value.nextReviewAt) ? new Date(value.nextReviewAt).toISOString() : null
    };
  }
  return next;
}

function targetTrack(profile) {
  const needs = Array.isArray(profile?.activeNeeds) ? profile.activeNeeds : [];
  for (const need of needs) {
    const match = NEED_TRACK.find(([pattern]) => pattern.test(need));
    if (match) return match[1];
  }
  return 'communication';
}

function nodeProgress(progress, id) {
  return progress.nodes[id] || { status: 'unstarted', attempts: 0, successfulDates: [], lastPractisedAt: null, nextReviewAt: null };
}

function nextNodeForTrack(track, progress, band, excluded = new Set()) {
  const nodes = ALL_NODES.filter(item => item.track === (CURRICULUM_TRACKS[track] ? track : 'communication'));
  const ceiling = band != null && Number.isFinite(Number(band)) ? Number(band) + 0.5 : 4.5;
  const eligible = nodes.filter(item => item.minBand <= ceiling && !excluded.has(item.id));
  const ready = eligible.find(item => nodeProgress(progress, item.id).status !== 'secure'
    && item.prerequisites.every(id => nodeProgress(progress, id).status === 'secure'));
  return ready || eligible.find(item => nodeProgress(progress, item.id).status !== 'secure')
    || nodes.find(item => !excluded.has(item.id)) || nodes[0];
}

function publicTarget(item, kind) {
  return item ? { id: item.id, track: item.track, trackLabelZh: item.trackLabelZh,
    labelZh: item.labelZh, outcomeZh: item.outcomeZh, kind } : null;
}

export function planCurriculum(profile, { now = new Date().toISOString(), duration = 30, ledgerPlan = null } = {}) {
  const progress = normalizeCurriculumProgress(profile?.curriculumProgress);
  const due = ALL_NODES
    .filter(item => {
      const state = nodeProgress(progress, item.id);
      return state.nextReviewAt && Date.parse(state.nextReviewAt) <= Date.parse(now);
    })
    .sort((a, b) => Date.parse(nodeProgress(progress, a.id).nextReviewAt) - Date.parse(nodeProgress(progress, b.id).nextReviewAt));
  const ledgerReview = ledgerPlan?.reviewTargets?.[0];
  const reviewNode = due[0] || (ledgerReview ? nextNodeForTrack(targetTrack({ activeNeeds: [ledgerReview.category || ''] }), progress,
    profile?.stableBand) : null);
  const excluded = new Set(reviewNode ? [reviewNode.id] : []);
  const track = targetTrack(profile);
  const newNode = ledgerPlan?.maximumNewItems === 0 ? null : nextNodeForTrack(track, progress, profile?.stableBand, excluded);
  const targets = [
    ...(reviewNode ? [publicTarget(reviewNode, 'review')] : []),
    ...(newNode ? [publicTarget({ ...newNode, track, trackLabelZh: CURRICULUM_TRACKS[track].labelZh }, 'new')] : [])
  ];
  return {
    version: CURRICULUM_VERSION,
    reviewTarget: reviewNode ? publicTarget(reviewNode, 'review') : null,
    newTarget: newNode ? publicTarget({ ...newNode, track, trackLabelZh: CURRICULUM_TRACKS[track].labelZh }, 'new') : null,
    plannedTargets: targets.slice(0, Number(duration) >= 30 ? 3 : 2),
    maximumNewTargets: newNode ? 1 : 0,
    completionCriteria: [
      '先完成一次不提示的尝试，再根据真实表现教学',
      '教学后立即重说，并在新情境中独立迁移',
      '同课成功只算练习；后续跨日想起才算稳定掌握'
    ]
  };
}

export function commitCurriculumLesson(progressInput, {
  endedAt = new Date().toISOString(), practisedNodeIds = [], successfulNodeIds = [], unsuccessfulNodeIds = []
} = {}) {
  const progress = normalizeCurriculumProgress(progressInput);
  const practised = new Set(practisedNodeIds.filter(id => NODE_BY_ID.has(id)));
  const successful = new Set(successfulNodeIds.filter(id => practised.has(id)));
  const unsuccessful = new Set(unsuccessfulNodeIds.filter(id => practised.has(id) && !successful.has(id)));
  const day = isoDay(endedAt);
  for (const id of practised) {
    const previous = nodeProgress(progress, id);
    const successfulDates = successful.has(id) && day
      ? [...new Set([...previous.successfulDates, day])].slice(-8)
      : previous.successfulDates;
    const status = unsuccessful.has(id) ? 'practising' : successfulDates.length >= 3 ? 'secure' : successful.has(id) ? 'review' : 'practising';
    const intervalDays = unsuccessful.has(id) ? 1 : status === 'secure' ? 30 : [1, 3, 7][Math.min(2, successfulDates.length)] || 1;
    progress.nodes[id] = {
      status,
      attempts: previous.attempts + 1,
      successfulDates,
      lastPractisedAt: new Date(endedAt).toISOString(),
      nextReviewAt: new Date(Date.parse(endedAt) + intervalDays * DAY_MS).toISOString()
    };
  }
  return progress;
}
