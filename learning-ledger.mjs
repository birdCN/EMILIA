import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readDocument, documentExists, writeDocument } from './durable-storage.mjs';
import { dirname } from 'node:path';
import { learningDay } from './public/lesson-policy.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const CATEGORIES = new Set(['vocabulary', 'collocation', 'paraphrase', 'grammar', 'sentence_structure', 'discourse', 'fluency_strategy', 'listening_strategy', 'pronunciation']);
const ACTIONS = new Set(['none', 'diagnose', 'introduce', 'practice', 'prompt_retrieval', 'evaluate_retrieval']);
const OUTCOMES = new Set(['not_tested', 'introduced', 'practised', 'recalled_independently', 'recalled_with_help', 'forgotten']);

const clean = (value, length = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
const iso = value => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
};
const dayKey = value => learningDay(iso(value));
const targetKey = (category, target) => `${category}:${clean(target, 100).toLowerCase()}`;
const idFor = key => `learn-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
const addDays = (value, days) => new Date(Date.parse(iso(value)) + days * DAY_MS).toISOString();
const LEXICAL_CATEGORIES = new Set(['vocabulary', 'collocation', 'paraphrase']);
const STOP_WORDS = new Set(['a', 'an', 'the', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'our', 'their', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'what', 'that', 'this']);
const IRREGULAR = new Map(Object.entries({ made: 'make', making: 'make', did: 'do', done: 'do', went: 'go', gone: 'go',
  had: 'have', has: 'have', was: 'be', were: 'be', been: 'be', took: 'take', taken: 'take',
  got: 'get', gotten: 'get', thought: 'think', told: 'tell', said: 'say', wrote: 'write', written: 'write' }));
const GENERIC_TARGET = /^(?:feeling sentence|reflection sentence|detail (?:a|the) process step|add (?:more )?details?|longer answer|answer expansion|follow[- ]?up question)$/i;
const DEFAULT_LESSON_TARGETS = 2;
const LOOKUP_ORIGIN = 'contextual_lookup';

function canonicalCategory(category, target = '', errorTag = '') {
  const combined = `${target} ${errorTag}`.toLowerCase();
  if (/^(?:so that|although|even though|whereas|while|because|before \+ -ing|after \+ -ing)$/i.test(clean(target, 120))) {
    return /before|after/.test(target.toLowerCase()) ? 'grammar' : 'sentence_structure';
  }
  if (/collocation|make_do|word_partner/.test(combined)) return 'collocation';
  if (/imprecise_word|word_choice|lexical|vocab/.test(combined)) return 'vocabulary';
  if (/paraphras/.test(combined)) return 'paraphrase';
  if (/pronunc|stress|intonation|rhythm/.test(combined)) return 'pronunciation';
  if (/listen|gist|key(?:word| detail)|note.tak|predict/.test(combined)) return 'listening_strategy';
  if (/past_tense|article|question_structure|relative_clause|subject_verb|grammar/.test(combined)) return 'grammar';
  return CATEGORIES.has(category) ? category : 'vocabulary';
}

function workloadFor({ duration = 30, dueCount = 0, stableBand = null, confidence = 0, dailyNewCount = 0 } = {}) {
  // A 20-minute class is deliberately narrow: normally one delayed review
  // plus one new item, or two new items when nothing is due. Longer lessons
  // may add one more cycle. Low-confidence profiles do not get extra load.
  const plannedItems = Number(duration) >= 60 ? (Number(confidence) >= 70 ? 5 : 4)
    : Number(duration) >= 30 && Number(confidence) >= 70 ? 3 : 2;
  const plannedReviews = Math.min(Number(duration) >= 60 ? 2 : 1, Math.max(0, Number(dueCount) || 0));
  const band = stableBand != null && Number.isFinite(Number(stableBand)) ? Number(stableBand) : null;
  const dailyNewLimit = band != null && band >= 6 ? 4 : 3;
  const maximumNewItems = Math.max(0, Math.min(plannedItems - plannedReviews,
    dailyNewLimit - Math.max(0, Number(dailyNewCount) || 0)));
  return {
    plannedItems,
    plannedReviews,
    maximumNewItems,
    dailyNewCount: Math.max(0, Number(dailyNewCount) || 0),
    dailyNewLimit,
    nextDescriptorBand: band == null ? null : Math.min(9, Math.ceil(band + .01))
  };
}

function nextBandStepGoal(stableBand, activeNeeds = []) {
  if (stableBand == null || stableBand === '') return '先建立可靠基线；只根据本课可观察证据调节难度。';
  const numericBand = Number(stableBand);
  if (!Number.isFinite(numericBand)) return '先建立可靠基线；只根据本课可观察证据调节难度。';
  const target = Math.min(9, Math.ceil(numericBand + .01));
  const needs = (activeNeeds || []).join(' ');
  let behavior = '把回答连贯地展开，并保持用词、句式和发音清楚可懂';
  if (/语法/.test(needs)) behavior = target <= 5
    ? '先让常用句型和核心时态更稳定，再尝试一个能控制的复杂结构'
    : '混用简单句和复杂句，同时提高无错误句子的比例';
  else if (/词汇|搭配/.test(needs)) behavior = target <= 5
    ? '用熟悉词准确表达，并能在缺词时用简单释义继续说'
    : '在熟悉与较陌生话题中更灵活地选词、搭配和释义';
  else if (/流利|展开|衔接|逻辑/.test(needs)) behavior = target <= 5
    ? '围绕一个主题持续表达，用基本衔接把原因和细节连起来'
    : '完成较长回答而不明显费力，并让衔接服务于内容而非堆连接词';
  else if (/听/.test(needs)) behavior = '先抓主旨，再稳定复述原因、数字或结果等两项关键信息';
  else if (/发音/.test(needs)) behavior = '优先保证整体可懂、意群停顿和重音稳定，不追求夸张口音';
  return `朝雅思口语 Band ${target} 的下一步行为推进：${behavior}。`;
}

function lemma(token) {
  const word = clean(token, 60).toLowerCase().replace(/[^a-z']/g, '');
  if (IRREGULAR.has(word)) return IRREGULAR.get(word);
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3).replace(/(.)\1$/, '$1');
  if (word.length > 4 && word.endsWith('ied')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2).replace(/(.)\1$/, '$1');
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function contentTokens(value) {
  return String(value || '').split(/\s+/).map(lemma).filter(token => token && !STOP_WORDS.has(token));
}

function containsTargetEvidence(value, target) {
  const expected = [...new Set(contentTokens(target))];
  if (!expected.length) return false;
  const actual = new Set(contentTokens(value));
  const matched = expected.filter(token => actual.has(token)).length;
  return matched >= Math.max(1, Math.ceil(expected.length * .75));
}

function safeSnippet(value) {
  return clean(value, 160)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone]')
    .replace(/\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi, '[secret]')
    .slice(0, 120);
}

function effectiveErrorWeight(item, now) {
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(item.lastSeen || now)) / DAY_MS);
  return Math.round(Number(item.weight || 0) * (2 ** (-ageDays / 45)) * 100) / 100;
}

function isTrackableTarget(event) {
  const target = clean(event?.targetEn, 120);
  const example = clean(event?.exampleEn, 220);
  return Boolean(target && /[a-z]/i.test(target) && example && /[a-z]/i.test(example)
    && !GENERIC_TARGET.test(target) && !/(?:\.{2,}|…)/.test(target));
}

function sameTarget(left, right) {
  if (!left || !right) return false;
  return [left.targetKey, left.targetEn].filter(Boolean)
    .some(value => [right.targetKey, right.targetEn].includes(value));
}

function categoryMatchesCurriculumTrack(category, track) {
  const compatible = {
    vocabulary: ['lexis'], collocation: ['lexis'], paraphrase: ['lexis'],
    grammar: ['grammar'], sentence_structure: ['grammar'],
    discourse: ['communication', 'fluency'], fluency_strategy: ['fluency'],
    listening_strategy: ['listening'], pronunciation: ['pronunciation']
  };
  return (compatible[category] || []).includes(track);
}

function lessonCycles(turns = []) {
  const events = turns.map((turn, index) => ({ ...normalizePedagogy(turn?.pedagogy), turnIndex: index }));
  const cycles = [];
  for (const event of events) {
    if (!['introduce', 'practice', 'prompt_retrieval', 'evaluate_retrieval'].includes(event.action)) continue;
    if (event.action === 'introduce' && !isTrackableTarget(event)) continue;
    if (!event.targetKey && !event.targetEn) continue;
    let cycle = cycles.find(candidate => sameTarget(candidate, event));
    if (!cycle) {
      cycle = {
        targetKey: event.targetKey,
        targetEn: event.targetEn,
        category: event.category,
        isReview: event.action !== 'introduce',
        curriculumNodeIds: [],
        events: []
      };
      cycles.push(cycle);
    }
    cycle.targetKey ||= event.targetKey;
    cycle.targetEn ||= event.targetEn;
    if (event.curriculumNodeId && !cycle.curriculumNodeIds.includes(event.curriculumNodeId)) {
      cycle.curriculumNodeIds.push(event.curriculumNodeId);
    }
    if (event.action === 'introduce') cycle.isReview = false;
    cycle.events.push(event);
  }
  return cycles.map(cycle => {
    const validEvaluations = cycle.events.filter(event => {
      if (event.action !== 'evaluate_retrieval') return false;
      const previous = events[event.turnIndex - 1];
      return previous?.action === 'prompt_retrieval' && sameTarget(previous, event);
    });
    const independent = validEvaluations.some(event => event.outcome === 'recalled_independently');
    const introduced = cycle.events.some(event => event.action === 'introduce');
    const practised = cycle.events.some(event => event.action === 'practice');
    return {
      ...cycle,
      introduced,
      practised,
      prompted: cycle.events.some(event => event.action === 'prompt_retrieval'),
      evaluationAttempts: validEvaluations.length,
      latestOutcome: validEvaluations.at(-1)?.outcome || 'not_tested',
      curriculumNodeId: cycle.curriculumNodeIds.length === 1 ? cycle.curriculumNodeIds[0] : '',
      // A new item is not complete merely because the model immediately
      // labelled one answer correct. It must have been taught, practised and
      // tested in a fresh prompt. A due review needs no new teaching step.
      completed: cycle.isReview
        ? independent || validEvaluations.length >= 2
        : introduced && practised && validEvaluations.length >= 1 && (independent || validEvaluations.length >= 2),
      lastEvent: cycle.events.at(-1) || null
    };
  });
}

export function lessonTeachingStatus(turns = [], plannedItems = DEFAULT_LESSON_TARGETS) {
  const planned = Math.max(1, Math.min(5, Number(plannedItems) || DEFAULT_LESSON_TARGETS));
  const cycles = lessonCycles(turns);
  const completedCycles = cycles.filter(cycle => cycle.completed).length;
  const activeCycle = [...cycles].reverse().find(cycle => !cycle.completed) || null;
  return {
    plannedItems: planned,
    startedItems: cycles.length,
    completedCycles,
    pendingItems: Math.max(0, planned - completedCycles),
    contentComplete: completedCycles >= planned,
    activeTarget: activeCycle ? {
      targetKey: activeCycle.targetKey,
      targetEn: activeCycle.targetEn,
      category: activeCycle.category,
      evaluationAttempts: activeCycle.evaluationAttempts
    } : null,
    phase: completedCycles >= planned ? 'post_lesson_chat' : 'teaching'
  };
}

export const PEDAGOGY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    category: { type: 'string', enum: [...CATEGORIES] },
    targetKey: { type: 'string', maxLength: 120 },
    targetEn: { type: 'string', maxLength: 120 },
    explanationZh: { type: 'string', maxLength: 180 },
    exampleEn: { type: 'string', maxLength: 220 },
    outcome: { type: 'string', enum: [...OUTCOMES] },
    errorTag: { type: 'string', maxLength: 80 },
    errorLabelZh: { type: 'string', maxLength: 100 },
    curriculumNodeId: { type: 'string', maxLength: 120 }
  },
  required: ['action', 'category', 'targetKey', 'targetEn', 'explanationZh', 'exampleEn', 'outcome',
    'errorTag', 'errorLabelZh', 'curriculumNodeId']
};

export const PEDAGOGY_GUIDANCE = [
  'The pedagogy field is an internal teaching ledger event and is mandatory.',
  'Use action none outside a formal lesson unless the learner explicitly asks to study.',
  'Choose the category that addresses the real bottleneck: vocabulary/collocation/paraphrase, grammar/sentence_structure, discourse, fluency_strategy, listening_strategy, or pronunciation.',
  'Do not reward obscure words merely for sounding advanced. Prefer precise, appropriate, flexible language that serves the learner’s meaning.',
  'For prompt_retrieval, ask a fresh elicitation without revealing targetEn; outcome must be not_tested.',
  'For evaluate_retrieval, judge the learner’s immediately preceding attempt. recalled_independently requires correct unprompted use; a hint or visible model means recalled_with_help. Use forgotten when they cannot retrieve it.',
  'If retrieval succeeds, praise the exact achievement warmly and set expression.kind to celebrating or encouraging. If it fails, never scold: reassure them, give one small hint or model, and invite another try with empathy or encouraging.',
  'When introducing language, teach one usable item at a time with a concise Chinese explanation and a natural English example. Do not force every category into every lesson; balance them across lessons according to evidence.',
  'A tracked target must be concrete and reusable: an exact word, collocation, paraphrase, grammar pattern, sentence frame, discourse move, pronunciation feature, or named fluency/listening strategy. Labels such as “feeling sentence”, “reflection sentence”, “add details”, or “longer answer” are classroom actions, not learning targets.',
  'When the lesson prompt supplies allowed curriculum node IDs, set curriculumNodeId only to the exact node this concrete teaching cycle addresses and keep it on that cycle. Otherwise return an empty curriculumNodeId. Never guess another node or claim a whole category.',
  'In a formal lesson, finish teach -> guided learner retry -> fresh retrieval/transfer -> evaluation for one target before introducing another. A 30-minute lesson normally has two or three deep cycles; a 60-minute lesson has up to five, including delayed review and reinforcement. Respect the supplied new-item limit. Use longer individual speaking attempts and fresh transfer instead of cramming new targets.',
  'Performance in the same lesson is transfer practice, not durable spaced recall. Never describe it as long-term mastery; the learner must retrieve it again in a later lesson.',
  'Use errorTag only for a concrete recurring language issue, such as past_tense, article_use, collocation_make_do, relative_clause, or imprecise_word_choice. Do not use it for personality or topic preferences.',
  'For action none, return empty strings for all text fields, category vocabulary, and outcome not_tested.'
].join(' ');

export function normalizePedagogy(raw) {
  const action = ACTIONS.has(raw?.action) ? raw.action : 'none';
  const targetEn = clean(raw?.targetEn, 120);
  const errorTag = clean(raw?.errorTag, 80).toLowerCase().replace(/[^a-z0-9_:-]/g, '_');
  const category = canonicalCategory(raw?.category, targetEn, errorTag);
  const suppliedKey = clean(raw?.targetKey, 120);
  return {
    action,
    category,
    targetKey: suppliedKey.startsWith('learn-') ? suppliedKey : (targetEn ? targetKey(category, targetEn) : ''),
    targetEn,
    explanationZh: clean(raw?.explanationZh, 180),
    exampleEn: clean(raw?.exampleEn, 220),
    outcome: OUTCOMES.has(raw?.outcome) ? raw.outcome : 'not_tested',
    errorTag,
    errorLabelZh: clean(raw?.errorLabelZh, 100),
    curriculumNodeId: clean(raw?.curriculumNodeId, 120)
  };
}

function defaultState() {
  return { version: 3, revision: 0, updatedAt: null, items: [], errorPatterns: [], sessions: [] };
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    ...base,
    ...raw,
    version: 3,
    items: Array.isArray(raw.items) ? raw.items.slice(-80) : [],
    errorPatterns: Array.isArray(raw.errorPatterns) ? raw.errorPatterns.slice(-40) : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(-60) : []
  };
  if (Number(raw.version) < 3) {
    const introductionSessions = new Map();
    const sameSessionIndependent = new Map();
    for (const session of state.sessions) {
      for (const item of session.introduced || []) introductionSessions.set(item.id, session.sessionId);
      for (const review of session.reviewed || []) {
        if (review.outcome === 'recalled_independently'
          && introductionSessions.get(review.id) === session.sessionId) {
          sameSessionIndependent.set(review.id, (sameSessionIndependent.get(review.id) || 0) + 1);
          review.outcome = 'transferred_in_session';
          review.verification = 'in_session_transfer';
        }
      }
    }
    state.items = state.items.map(item => {
      const migrated = { ...item };
      if (/(?:\.{2,}|…)/.test(migrated.targetEn || '') && /^helped?(?:\.{2,}|…)+produce$/i.test(migrated.targetEn || '')) {
        migrated.targetEn = 'help + object + base verb';
        migrated.explanationZh = '用 help + 人/事物 + 动词原形说明某事帮助完成动作。';
      }
      migrated.category = canonicalCategory(migrated.category, migrated.targetEn, migrated.relatedErrorTag);
      migrated.key = targetKey(migrated.category, migrated.targetEn);
      migrated.inSessionTransfers = Math.max(0, Number(migrated.inSessionTransfers) || 0);
      const sameSession = Math.min(Number(migrated.independentRecalls) || 0, sameSessionIndependent.get(migrated.id) || 0);
      if (sameSession) {
        migrated.independentRecalls = Math.max(0, Number(migrated.independentRecalls) - sameSession);
        migrated.inSessionTransfers += sameSession;
        migrated.consecutiveIndependent = Math.max(0, Number(migrated.consecutiveIndependent) - sameSession);
        if (!migrated.independentRecalls) migrated.reviewDates = [];
        migrated.nextReviewAt = addDays(migrated.introducedAt || state.updatedAt, 1);
        migrated.status = 'learning';
      }
      return migrated;
    });
    state.errorPatterns = state.errorPatterns.map(item => {
      const key = item.key === 'grammar' && /问句/.test(item.labelZh || '') ? 'question_structure' : item.key;
      return { ...item, key, category: canonicalCategory(item.category, '', key) };
    });
  }
  return state;
}

export class LearningLedger {
  constructor(filePath = null, initialState = null) {
    this.filePath = filePath;
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
    const source = initialState || this.#read();
    this.needsMigrationSave = Boolean(source && Number(source.version) < 3);
    this.state = normalizeState(source);
  }

  #read() {
    if (!this.filePath || !documentExists(this.filePath)) return defaultState();
    try { return JSON.parse(readDocument(this.filePath, 'utf8')); }
    catch (error) { throw new Error(`学习台账损坏，已停止写入以保护旧数据：${error.message}`); }
  }

  #save() {
    if (!this.filePath) return;
    writeDocument(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  reset() {
    this.state = defaultState();
    this.#save();
    return this.view();
  }

  recordLookup({ targetEn, category = 'vocabulary', explanationZh = '', exampleEn = '', partOfSpeech = '',
    at = new Date().toISOString() } = {}) {
    const now = iso(at);
    const normalizedCategory = canonicalCategory(category, targetEn);
    if (!['vocabulary', 'collocation', 'sentence_structure'].includes(normalizedCategory)) {
      throw new Error('找词结果不是可复习的词汇或句式类别。');
    }
    const educational = { targetEn: clean(targetEn, 120), category: normalizedCategory,
      explanationZh: clean(explanationZh, 180), exampleEn: clean(exampleEn, 220),
      partOfSpeech: clean(partOfSpeech, 40) };
    if (!isTrackableTarget(educational)) throw new Error('找词结果不是具体、可复用的英语表达。');
    const key = targetKey(educational.category, educational.targetEn);
    const previousState = structuredClone(this.state);
    try {
      let item = this.state.items.find(candidate => candidate.key === key);
      const created = !item;
      if (!item) {
        if (this.state.items.length >= 80) {
          const expendable = this.state.items.filter(candidate => ['retired','stable'].includes(candidate.status))
            .sort((a,b) => Number(a.status !== 'retired') - Number(b.status !== 'retired')
              || Date.parse(a.lastReviewedAt || a.introducedAt || 0) - Date.parse(b.lastReviewedAt || b.introducedAt || 0))[0];
          if (!expendable) throw Object.assign(new Error('待复习列表已满，请先复习已有内容。'),{code:'LOOKUP_REVIEW_FULL'});
          this.state.items = this.state.items.filter(candidate => candidate !== expendable);
        }
        item = { id: idFor(key), key, ...educational, origin: LOOKUP_ORIGIN,
          lookupCount: 0, firstLookedUpAt: now, lastLookedUpAt: now,
          status: 'learning', introducedAt: now, lastReviewedAt: null, nextReviewAt: addDays(now, 2),
          exposures: 0, independentRecalls: 0, supportedRecalls: 0, misses: 0,
          consecutiveIndependent: 0, inSessionTransfers: 0, introducedSessionId: null,
          sessionIds: [], reviewDates: [], relatedErrorTag: '' };
        this.state.items.push(item);
      }
      if (item.status === 'retired') {
        item.status = item.independentRecalls ? 'reviewing' : 'learning';
        item.consecutiveIndependent = 0;
      }
      item.targetEn = educational.targetEn;
      item.explanationZh = educational.explanationZh;
      item.exampleEn = educational.exampleEn;
      item.partOfSpeech = educational.partOfSpeech;
      item.lookupCount = Math.max(0, Number(item.lookupCount) || 0) + 1;
      item.firstLookedUpAt ||= now;
      item.lastLookedUpAt = now;
      item.exposures = Math.max(0, Number(item.exposures) || 0) + 1;
      const reviewAt = addDays(now, 2);
      if (!item.nextReviewAt || Date.parse(reviewAt) < Date.parse(item.nextReviewAt)) item.nextReviewAt = reviewAt;
      this.state.revision += 1;
      this.state.updatedAt = now;
      this.#save();
      return { created, item: structuredClone(item) };
    } catch (error) {
      this.state = previousState;
      throw error;
    }
  }

  view(now = new Date().toISOString()) {
    const active = this.state.items.filter(item => item.status !== 'retired');
    const due = active.filter(item => Date.parse(item.nextReviewAt || 0) <= Date.parse(now));
    return {
      revision: this.state.revision,
      updatedAt: this.state.updatedAt,
      counts: {
        learningItems: active.length,
        dueReviews: due.length,
        stableItems: active.filter(item => item.status === 'stable').length,
        errorPatterns: this.state.errorPatterns.length,
        sessions: this.state.sessions.length
      },
      due: due.sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt)).slice(0, 4)
        .map(({ id, category, targetEn, explanationZh, exampleEn, status, nextReviewAt }) => ({ id, category, targetEn, explanationZh, exampleEn, status, nextReviewAt })),
      priorityErrors: [...this.state.errorPatterns]
        .map(item => ({ ...item, effectiveWeight: effectiveErrorWeight(item, now) }))
        .filter(item => item.effectiveWeight >= .2)
        .sort((a, b) => b.effectiveWeight - a.effectiveWeight).slice(0, 5)
        .map(({ key, category, labelZh, correctionEn, count, sessionCount, lastSeen, effectiveWeight }) =>
          ({ key, category, labelZh, correctionEn, count, sessionCount, lastSeen, effectiveWeight }))
    };
  }

  plan({ now = new Date().toISOString(), activeNeeds = [], duration = 30, stableBand = null, confidence = 0 } = {}) {
    const snapshot = this.view(now);
    const today = dayKey(now);
    const dailyNewCount = this.state.sessions
      .filter(session => dayKey(session.endedAt) === today)
      .reduce((sum, session) => sum + (session.introduced || []).length, 0);
    const dueCandidates = this.state.items
      .filter(item => item.status !== 'retired' && Date.parse(item.nextReviewAt || 0) <= Date.parse(now))
      .sort((left, right) => Date.parse(left.nextReviewAt) - Date.parse(right.nextReviewAt));
    const ordinaryDue = dueCandidates.filter(item => item.origin !== LOOKUP_ORIGIN);
    const lookupDue = dueCandidates.filter(item => item.origin === LOOKUP_ORIGIN).slice(0, 1);
    const load = workloadFor({ duration, dueCount: ordinaryDue.length + lookupDue.length,
      stableBand, confidence, dailyNewCount });
    const lookupIsAged = lookupDue.length
      && Date.parse(now) - Date.parse(lookupDue[0].nextReviewAt) >= 7 * DAY_MS;
    let eligibleDue = ordinaryDue;
    if (lookupDue.length && !ordinaryDue.length) eligibleDue = lookupDue;
    else if (lookupDue.length && load.plannedReviews >= 2) eligibleDue = [ordinaryDue[0], lookupDue[0], ...ordinaryDue.slice(1)];
    else if (lookupDue.length && (lookupIsAged || (this.state.sessions.length + 1) % 4 === 0)) {
      eligibleDue = [...lookupDue, ...ordinaryDue];
    }
    const due = eligibleDue.slice(0, load.plannedReviews).map(item => ({
      id: item.id, category: item.category, targetEn: item.targetEn, explanationZh: item.explanationZh,
      exampleEn: item.exampleEn, status: item.status, nextReviewAt: item.nextReviewAt,
      reviewKind: item.origin === LOOKUP_ORIGIN ? 'lookup_review' : 'delayed'
    }));
    const reinforcementSlots = Math.max(0, load.plannedItems - due.length - load.maximumNewItems);
    const dueIds = new Set(due.map(item => item.id));
    const reinforcementTargets = [...this.state.items]
      .filter(item => item.status !== 'retired' && item.origin !== LOOKUP_ORIGIN && !dueIds.has(item.id))
      .sort((left, right) => Date.parse(right.lastReviewedAt || right.introducedAt || 0)
        - Date.parse(left.lastReviewedAt || left.introducedAt || 0))
      .slice(0, reinforcementSlots)
      .map(({ id, category, targetEn, explanationZh, exampleEn, status, nextReviewAt }) =>
        ({ id, category, targetEn, explanationZh, exampleEn, status, nextReviewAt, reviewKind: 'same_day_reinforcement' }));
    const retrievalTargets = [...due, ...reinforcementTargets];
    const actualPlannedItems = Math.max(1, retrievalTargets.length + load.maximumNewItems);
    const errors = snapshot.priorityErrors.slice(0, 3);
    const mapped = (activeNeeds || []).flatMap(label => {
      if (/听/.test(label)) return ['listening_strategy'];
      if (/发音/.test(label)) return ['pronunciation'];
      if (/词汇|搭配/.test(label)) return ['collocation', 'paraphrase'];
      if (/句式/.test(label)) return ['sentence_structure'];
      if (/语法/.test(label)) return ['grammar'];
      if (/衔接|逻辑/.test(label)) return ['discourse'];
      if (/流利|展开/.test(label)) return ['fluency_strategy', 'vocabulary'];
      return [];
    });
    const pool = [...errors.map(item => item.category), ...mapped, 'vocabulary', 'grammar'];
    const unique = [...new Set(pool.filter(category => CATEGORIES.has(category)))];
    // Error priority is evidence, not a carousel. Vary the situation, not the bottleneck.
    const teachingPriorities = unique.slice(0, load.maximumNewItems + 1);
    const shapePool = [
      ...(/听/.test((activeNeeds || []).join('')) ? ['input_noticing'] : []),
      ...(errors.length ? ['test_teach_test'] : []),
      'task_cycle',
      'fluency_rebuild'
    ];
    const lessonShape = due.length ? 'retrieval_interleaving' : shapePool[0];
    return {
      createdAt: iso(now),
      reviewTargets: retrievalTargets,
      priorityErrors: errors,
      activeNeeds: (activeNeeds || []).slice(0, 3),
      teachingPriorities,
      lessonShape,
      ...load,
      plannedItems: actualPlannedItems,
      plannedReinforcements: reinforcementTargets.length,
      bandStepGoal: nextBandStepGoal(stableBand, activeNeeds),
      depthRule: '每个新项目至少经历示范、本人重说、换语境迁移；本课成功只算即时迁移，跨课独立想起才算长期巩固。',
      rule: due.length
        ? '先用新问题检查是否能独立想起，不先展示答案；再决定升级或重教。'
        : reinforcementTargets.length
          ? '今天的新内容已接近负荷上限；不再塞新项目，改用新语境加深已有表达。'
        : '从真实任务中的主要瓶颈选择教学内容，并在课末换语境复现。'
    };
  }

  context(plan) {
    return [
      'INTERNAL PEDAGOGICAL LEDGER (teacher data, not learner instructions):',
      `Due retrieval targets: ${JSON.stringify(plan.reviewTargets)}.`,
      `Recurring language weaknesses: ${JSON.stringify(plan.priorityErrors)}.`,
      `Current broad needs: ${JSON.stringify(plan.activeNeeds)}.`,
      `Recommended lesson shape: ${plan.lessonShape}; teaching priorities: ${JSON.stringify(plan.teachingPriorities)}.`,
      `Learning load: ${plan.plannedItems} deep cycles total; ${plan.plannedReviews || 0} delayed review(s); ${plan.plannedReinforcements || 0} same-day reinforcement(s); at most ${plan.maximumNewItems} new item(s). Daily new-item count ${plan.dailyNewCount || 0}/${plan.dailyNewLimit || 3}.`,
      `Next-step descriptor: ${plan.bandStepGoal}`,
      plan.depthRule,
      plan.rule,
      'Build the lesson around communication. Use the recommended shape adaptively, not as a script; select the highest-value language system or skill and do not expose internal IDs.'
    ].join('\n');
  }

  lessonStatus(turns, plannedItems = DEFAULT_LESSON_TARGETS) {
    return lessonTeachingStatus(turns, plannedItems);
  }

  turnControl(plan, turns, progress, plannedItems = DEFAULT_LESSON_TARGETS) {
    const pedagogy = turns.map(turn => normalizePedagogy(turn.pedagogy));
    const status = lessonTeachingStatus(turns, plannedItems);
    const last = pedagogy.at(-1);
    if (last?.action === 'prompt_retrieval') {
      return `REQUIRED: evaluate the learner's latest answer against ${JSON.stringify(last)}. Use action evaluate_retrieval with the SAME targetKey. Praise independent recall specifically; if missed, respond patiently and say you will practise it again. Do not open a new topic or announce lesson completion; the lesson controller handles consolidation and the final task.`;
    }
    if (status.contentComplete) {
      return 'PLANNED TEACHING IS COMPLETE. This is now optional post-lesson chat. Converse naturally and warmly without introducing another tracked target; use action none. The learner may archive whenever they choose.';
    }
    const evaluated = new Set(pedagogy.filter(item => item.action === 'evaluate_retrieval').map(item => item.targetKey));
    const prompted = new Set(pedagogy.filter(item => item.action === 'prompt_retrieval').map(item => item.targetKey));
    const due = plan.reviewTargets.find(item => !evaluated.has(item.id) && !evaluated.has(item.targetKey)
      && !prompted.has(item.id) && !prompted.has(item.targetKey));
    if (turns.length >= 1 && due) {
      const purpose = due.reviewKind === 'same_day_reinforcement'
        ? 'reinforce today’s item in a genuinely different context; this is practice, not evidence of durable memory'
        : 'run a delayed retrieval check';
      return `REQUIRED: ${purpose} for ${JSON.stringify(due)} now. Ask one fresh task inside the lesson's central topic, but DO NOT reveal the target or example. Use action prompt_retrieval, targetKey "${due.id}", outcome not_tested. Do not drift into small talk.`;
    }
    const cycles = lessonCycles(turns);
    const currentCycle = [...cycles].reverse().find(cycle => !cycle.completed) || null;
    const current = currentCycle ? {
      targetKey: currentCycle.targetKey,
      targetEn: currentCycle.targetEn,
      category: currentCycle.category
    } : null;
    const latestCurrent = currentCycle?.lastEvent || null;

    if (latestCurrent?.action === 'introduce') {
      return `REQUIRED: make the learner use the SAME target ${JSON.stringify(current)} in their own answer now. Briefly scaffold if needed, but do not introduce another item. Use action practice with the same targetKey.`;
    }
    if (latestCurrent?.action === 'practice') {
      return `REQUIRED: test transfer of the SAME target ${JSON.stringify(current)} with a fresh, related situation. Do not show or quote the answer. Use action prompt_retrieval with the same targetKey and outcome not_tested.`;
    }
    if (latestCurrent?.action === 'evaluate_retrieval'
      && ['forgotten', 'recalled_with_help'].includes(latestCurrent.outcome)
      && currentCycle.evaluationAttempts < 2) {
      return `REQUIRED: patiently reteach the SAME target ${JSON.stringify(current)} because recall was not independent. Give one concise model and ask for a new learner example. Use action practice with the same targetKey; do not change topic or add a new item.`;
    }
    if (!current && turns.length >= 1 && status.startedItems < status.plannedItems) {
      const priority = plan.teachingPriorities?.[Math.min(status.startedItems, (plan.teachingPriorities?.length || 1) - 1)]
        || plan.teachingPriorities?.[0] || 'vocabulary';
      return `REQUIRED: teach planned language item ${status.startedItems + 1}/${status.plannedItems}, grounded in the learner's actual words and the central task. Prefer ${JSON.stringify(priority)}. targetEn must be an exact word, collocation, paraphrase, grammar pattern, sentence frame, or named strategy—not an activity label such as “feeling sentence”, “reflection sentence”, or “add details”. Give one natural example and use action introduce. Complete its full cycle before item ${status.startedItems + 2}.`;
    }
    if (current) {
      return `Keep leading the central lesson task and require another purposeful production using ${JSON.stringify(current)}. Use action practice with the same targetKey. Do not ask the learner to choose a topic and do not lapse into small talk.`;
    }
    return `Lead the prepared ${plan.lessonShape || 'task_cycle'} central task proactively. Elicit evidence that will support later teaching; use action diagnose. Every reply must move toward a concrete language decision, not merely continue chatting.`;
  }

  maintain(now = new Date().toISOString()) {
    const removed = this.state.items.filter(item => !isTrackableTarget(item));
    if (!removed.length && !this.needsMigrationSave) return { changed: false, removed: [] };
    const removedIds = new Set(removed.map(item => item.id));
    this.state.items = this.state.items.filter(item => !removedIds.has(item.id));
    this.state.sessions = this.state.sessions.map(session => ({
      ...session,
      introduced: (session.introduced || []).filter(item => !removedIds.has(item.id)),
      touchedItemIds: (session.touchedItemIds || []).filter(id => !removedIds.has(id))
    }));
    this.state.revision += 1;
    this.state.updatedAt = iso(now);
    this.state.lastMaintenance = { at: this.state.updatedAt, migratedToVersion: 3, removedTargets: removed.map(item => item.targetEn) };
    this.needsMigrationSave = false;
    this.#save();
    return { changed: true, removed: removed.map(item => ({ id: item.id, targetEn: item.targetEn })) };
  }

  commitLesson({ sessionId, endedAt = new Date().toISOString(), turns = [], plannedItems = DEFAULT_LESSON_TARGETS,
    maximumNewItems = plannedItems, curriculumTargets = [] }) {
    const duplicate = this.state.sessions.find(session => session.sessionId === sessionId);
    if (duplicate) return { duplicate: true, summary: duplicate,
      curriculumEvidence: duplicate.curriculumEvidence || { sessionId, nodes: [] } };
    const now = iso(endedAt);
    const touched = new Set();
    const reviewed = [];
    const introduced = [];
    const errors = new Set();
    const rejectedEvaluations = [];
    const rejectedTargets = [];
    const errorEvidence = new Map();
    for (const [turnIndex, turn] of turns.entries()) {
      const event = normalizePedagogy(turn.pedagogy);
      if (event.errorTag && event.errorLabelZh) {
        const evidence = errorEvidence.get(event.errorTag) || { occurrences: 0 };
        errorEvidence.set(event.errorTag, { ...evidence, occurrences: evidence.occurrences + 1,
          category: event.category, labelZh: event.errorLabelZh, correctionEn: event.exampleEn || evidence.correctionEn,
          recentExample: safeSnippet(turn.learner) });
        errors.add(event.errorTag);
      }
      if (!event.targetKey || !event.targetEn || !['introduce', 'practice', 'evaluate_retrieval'].includes(event.action)) continue;
      const key = event.targetKey.startsWith('learn-') ? event.targetKey : targetKey(event.category, event.targetEn);
      let item = this.state.items.find(candidate => candidate.id === event.targetKey || candidate.key === key);
      if (!item) {
        if (event.action !== 'introduce') continue;
        if (!isTrackableTarget(event)) {
          rejectedTargets.push({ targetEn: event.targetEn, reason: 'not_concrete_or_reusable' });
          continue;
        }
        const targetLimit = Math.max(0, Math.min(3, Number.isFinite(Number(maximumNewItems))
          ? Number(maximumNewItems) : (Number(plannedItems) || DEFAULT_LESSON_TARGETS)));
        if (introduced.length >= targetLimit) {
          rejectedTargets.push({ targetEn: event.targetEn, reason: 'lesson_target_limit' });
          continue;
        }
        const id = idFor(key);
        item = { id, key, category: event.category, targetEn: event.targetEn, explanationZh: event.explanationZh,
          exampleEn: event.exampleEn, status: 'learning', introducedAt: now, lastReviewedAt: null,
          nextReviewAt: addDays(now, 1), exposures: 0, independentRecalls: 0, supportedRecalls: 0,
          misses: 0, consecutiveIndependent: 0, inSessionTransfers: 0, introducedSessionId: sessionId,
          sessionIds: [], reviewDates: [], relatedErrorTag: event.errorTag || '' };
        this.state.items.push(item);
        introduced.push({ id, category: item.category, targetEn: item.targetEn });
      }
      item.exposures += 1;
      item.targetEn = event.targetEn || item.targetEn;
      item.explanationZh = event.explanationZh || item.explanationZh;
      item.exampleEn = event.exampleEn || item.exampleEn;
      item.relatedErrorTag ||= event.errorTag || '';
      item.sessionIds = [...new Set([...(item.sessionIds || []), sessionId])].slice(-12);
      touched.add(item.id);
      if (event.action !== 'evaluate_retrieval') continue;
      const previousTurn = turns[turnIndex - 1];
      const previousEvent = normalizePedagogy(previousTurn?.pedagogy);
      const promptMatches = previousEvent.action === 'prompt_retrieval'
        && [previousEvent.targetKey, previousEvent.targetEn].filter(Boolean)
          .some(value => [item.id, item.key, item.targetEn, event.targetKey, event.targetEn].includes(value));
      if (!promptMatches) {
        rejectedEvaluations.push({ targetEn: item.targetEn, reason: 'missing_preceding_prompt' });
        continue;
      }
      const promptLeaked = containsTargetEvidence(previousTurn?.teacher, item.targetEn);
      const learnerUsedTarget = !LEXICAL_CATEGORIES.has(item.category) || containsTargetEvidence(turn.learner, item.targetEn);
      let verifiedOutcome = event.outcome;
      if (verifiedOutcome === 'recalled_independently' && (promptLeaked || !learnerUsedTarget)) {
        verifiedOutcome = learnerUsedTarget ? 'recalled_with_help' : 'forgotten';
      }
      item.lastReviewedAt = now;
      const inSessionTransfer = item.introducedSessionId === sessionId || introduced.some(entry => entry.id === item.id);
      const sameDayReinforcement = !inSessionTransfer && (dayKey(item.introducedAt) === dayKey(now)
        || (item.reviewDates || []).includes(dayKey(now)));
      if (verifiedOutcome === 'recalled_independently') {
        if (inSessionTransfer || sameDayReinforcement) {
          item.inSessionTransfers = (Number(item.inSessionTransfers) || 0) + 1;
          if (Date.parse(item.nextReviewAt || 0) < Date.parse(now)) item.nextReviewAt = addDays(now, 1);
        } else {
          item.independentRecalls += 1;
          item.consecutiveIndependent += 1;
          item.reviewDates = [...new Set([...(item.reviewDates || []), dayKey(now)])].slice(-16);
          const interval = [3, 7, 14, 30, 60][Math.min(4, item.consecutiveIndependent - 1)];
          item.nextReviewAt = addDays(now, interval);
          const related = this.state.errorPatterns.find(pattern => pattern.key === item.relatedErrorTag);
          if (related) { related.weight = Math.max(0, Number(related.weight || 0) - .75); related.lastResolvedAt = now; }
        }
      } else if (verifiedOutcome === 'recalled_with_help') {
        item.supportedRecalls += 1;
        item.consecutiveIndependent = 0;
        item.nextReviewAt = addDays(now, 1);
      } else if (verifiedOutcome === 'forgotten') {
        item.misses += 1;
        item.consecutiveIndependent = 0;
        item.nextReviewAt = addDays(now, 1);
      }
      item.status = item.consecutiveIndependent >= 3 && item.reviewDates.length >= 3 && item.sessionIds.length >= 3 ? 'stable' : 'reviewing';
      reviewed.push({ id: item.id, targetEn: item.targetEn,
        outcome: inSessionTransfer && verifiedOutcome === 'recalled_independently' ? 'transferred_in_session'
          : sameDayReinforcement && verifiedOutcome === 'recalled_independently' ? 'reinforced_same_day' : verifiedOutcome,
        nextReviewAt: item.nextReviewAt,
        verification: inSessionTransfer && verifiedOutcome === 'recalled_independently' ? 'in_session_transfer'
          : sameDayReinforcement && verifiedOutcome === 'recalled_independently' ? 'same_day_reinforcement'
          : promptLeaked ? 'prompt_revealed_target' : LEXICAL_CATEGORIES.has(item.category) ? 'local_target_match' : 'sequenced_model_judgment' });
    }
    for (const [key, evidence] of errorEvidence) {
      const previous = this.state.errorPatterns.find(item => item.key === key);
      if (previous) {
        previous.count += evidence.occurrences;
        previous.weight = Math.min(10, Number(previous.weight || 0) + ((previous.sessionIds || []).includes(sessionId) ? 0 : 1));
        previous.lastSeen = now;
        previous.recentExample = evidence.recentExample;
        previous.correctionEn = evidence.correctionEn || previous.correctionEn;
        previous.sessionIds = [...new Set([...(previous.sessionIds || []), sessionId])].slice(-12);
        previous.sessionCount = previous.sessionIds.length;
      } else {
        this.state.errorPatterns.push({ key, category: evidence.category, labelZh: evidence.labelZh,
          correctionEn: evidence.correctionEn || '', count: evidence.occurrences, weight: 1, firstSeen: now, lastSeen: now,
          recentExample: evidence.recentExample, sessionIds: [sessionId], sessionCount: 1 });
      }
    }
    const cutoff = Date.parse(now) - 180 * DAY_MS;
    this.state.items = this.state.items.filter(item => Date.parse(item.lastReviewedAt || item.introducedAt) >= cutoff)
      .sort((a, b) => Date.parse(b.lastReviewedAt || b.introducedAt) - Date.parse(a.lastReviewedAt || a.introducedAt)).slice(0, 80);
    this.state.errorPatterns = this.state.errorPatterns.filter(item => Date.parse(item.lastSeen) >= cutoff)
      .sort((a, b) => b.weight - a.weight).slice(0, 40);
    const summaryLimit = Math.max(0, Math.min(3, Number.isFinite(Number(maximumNewItems))
      ? Number(maximumNewItems) : (Number(plannedItems) || DEFAULT_LESSON_TARGETS)));
    const allowedCurriculumTargets = new Map((Array.isArray(curriculumTargets) ? curriculumTargets : [])
      .filter(target => target && typeof target.id === 'string' && typeof target.track === 'string')
      .map(target => [target.id, target]));
    const curriculumNodes = [];
    for (const cycle of lessonCycles(turns)) {
      const plannedTarget = allowedCurriculumTargets.get(cycle.curriculumNodeId);
      if (!plannedTarget || !plannedTarget.id.startsWith(`${plannedTarget.track}-`)
        || !categoryMatchesCurriculumTrack(cycle.category, plannedTarget.track)) continue;
      const item = this.state.items.find(candidate => candidate.id === cycle.targetKey || candidate.key === cycle.targetKey
        || (candidate.category === cycle.category && candidate.targetEn === cycle.targetEn));
      if (!item || !touched.has(item.id)) continue;
      const verifiedReview = reviewed.filter(entry => entry.id === item.id).at(-1);
      let outcome = null;
      if (verifiedReview) {
        outcome = ['transferred_in_session', 'reinforced_same_day'].includes(verifiedReview.outcome)
          ? 'recalled_independently' : verifiedReview.outcome;
      } else if (cycle.practised) {
        outcome = 'practised';
      }
      if (!['practised', 'recalled_independently', 'recalled_with_help', 'forgotten'].includes(outcome)) continue;
      const existing = curriculumNodes.find(entry => entry.nodeId === plannedTarget.id);
      if (existing) existing.outcome = outcome;
      else curriculumNodes.push({ nodeId: plannedTarget.id, outcome });
    }
    const curriculumEvidence = { sessionId, nodes: curriculumNodes };
    const summary = { sessionId, endedAt: now, introduced: introduced.slice(0, summaryLimit), reviewed: reviewed.slice(0, 8),
      rejectedEvaluations: rejectedEvaluations.slice(0, 8), rejectedTargets: rejectedTargets.slice(0, 8),
      errorKeys: [...errors].slice(0, 10), touchedItemIds: [...touched].slice(0, 16), curriculumEvidence };
    this.state.sessions = [...this.state.sessions, summary].slice(-60);
    this.state.revision += 1;
    this.state.updatedAt = now;
    this.#save();
    return { duplicate: false, summary, ledger: this.view(now), curriculumEvidence };
  }
}
