import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readDocument, documentExists, writeDocument } from './durable-storage.mjs';
import { dirname } from 'node:path';

const DAY = 86_400_000;
const STAGES = ['teacher', 'familiar_companion', 'trusted_companion', 'mutual_romantic_openness', 'partnered'];
const STANCES = ['professional', 'warming', 'fond', 'open', 'committed'];
const SIGNAL_TYPES = [
  'meaningful_disclosure', 'shared_continuity', 'care_or_appreciation', 'playful_rapport',
  'boundary_respected', 'repair_completed', 'user_romantic_interest', 'user_romantic_boundary', 'mutual_commitment'
];
const QUALITY_SIGNALS = new Set(['meaningful_disclosure', 'shared_continuity', 'care_or_appreciation',
  'playful_rapport', 'boundary_respected', 'repair_completed']);
const ROMANTIC_INTENT = /\b(?:i\s+(?:really\s+)?(?:love|like)\s+you|feelings?\s+for\s+you|be\s+my\s+(?:girlfriend|lover|partner|wife)|date\s+me|marry\s+me|romantic\s+relationship)\b|(?:我爱你|我喜欢你|做我的(?:女朋友|恋人|爱人|对象)|和我谈恋爱|嫁给我)/iu;
const ROMANTIC_BOUNDARY = /\b(?:do(?:n't| not) flirt|only (?:be|as) my teacher|not romantic|no romance|stop (?:the )?romance)\b|(?:不要暧昧|不要调情|只做老师|不谈恋爱|停止恋爱|不要发展关系)/iu;
const COMMITMENT_ACCEPTANCE = /\b(?:yes[,— -]*(?:i'd|i would|let's)|i'd like that|i would like that|i accept|let's be (?:together|partners)|be your (?:girlfriend|partner|lover))\b|(?:我愿意|我答应|那我们就在一起|愿意做你的|接受你的表白)/iu;
const clean = (value, max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
const dateKey = value => new Date(Date.parse(iso(value)) + 8 * 3_600_000).toISOString().slice(0, 10);
const stageAtLeast = (stage, target) => STAGES.indexOf(stage) >= STAGES.indexOf(target);

function emptyState() {
  return {
    version: 1, revision: 0, mode: 'natural', stage: 'teacher', stance: 'professional',
    events: [], milestones: [], sessions: [], updatedAt: null,
    capabilities: { callbacks: false, affectionateLanguage: false, gentlePlayfulness: false,
      proactiveCare: false, personalQuestions: false, intimateQuestions: false,
      subtleRomanticHints: false, classroomFlusteredRedirect: false,
      canAcceptRomanticProposal: false }
  };
}

function normalizeState(raw) {
  const base = emptyState();
  if (!raw || raw.version !== 1) return base;
  return {
    ...base, ...raw,
    mode: ['teacher_only', 'natural', 'close_companion'].includes(raw.mode) ? raw.mode : 'natural',
    stage: STAGES.includes(raw.stage) ? raw.stage : 'teacher',
    stance: STANCES.includes(raw.stance) ? raw.stance : 'professional',
    events: Array.isArray(raw.events) ? raw.events.slice(-180) : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones.slice(-24) : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(-160) : [],
    capabilities: { ...base.capabilities, ...(raw.capabilities || {}) }
  };
}

export const RELATIONSHIP_REFLECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summaryZh: { type: 'string', maxLength: 200 },
    signals: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: SIGNAL_TYPES },
        turnId: { type: 'string', maxLength: 80 },
        learnerQuote: { type: 'string', maxLength: 200 },
        teacherQuote: { type: 'string', maxLength: 200 },
        confidence: { type: 'string', enum: ['medium', 'high'] },
        noteZh: { type: 'string', maxLength: 120 }
      },
      required: ['type', 'turnId', 'learnerQuote', 'teacherQuote', 'confidence', 'noteZh']
    } }
  }, required: ['summaryZh', 'signals']
};

export const RELATIONSHIP_REVIEW_SCHEMA = {
  type: 'array', maxItems: 8, items: {
    type: 'object', additionalProperties: false,
    properties: { index: { type: 'integer', minimum: 0, maximum: 7 }, keep: { type: 'boolean' } },
    required: ['index', 'keep']
  }
};

export const RELATIONSHIP_CURATION_INSTRUCTIONS = `Also return a relationship reflection. This is evidence collection, not a romance simulator.
Keep at most a few meaningful signals. Ordinary greetings, lesson completion, usage count, praise written by the teacher, and the learner merely answering an exercise are not relationship evidence.
A meaningful disclosure is a voluntary, personally meaningful disclosure rather than routine task content. Shared continuity requires a genuine callback or follow-through across conversations. Care/appreciation must be expressed by the learner, not invented from the teacher's warmth. Repair requires an actual misunderstanding or boundary issue followed by repair.
Choosing not to answer a personal question, asking to change topic, or setting a privacy boundary is neutral and must never be treated as rejection, relationship loss, or evidence against trust. Respecting that boundary may count only when the cited exchange shows it was actually respected.
user_romantic_interest requires explicit learner-authored romantic intent. A language exercise, quotation, hypothetical, joke with unclear intent, or uncertain ASR never counts. user_romantic_boundary requires an explicit request to stop or avoid romance. mutual_commitment requires BOTH an explicit learner proposal and a clearly accepting teacher reply in the same turn.
Every signal must cite one exact contiguous learner quote and its turnId. teacherQuote must be an exact contiguous teacher quote when relevant, otherwise empty. Emilia may gradually form warmth from varied, repeated meaningful interaction, but do not infer love, commitment, or compatibility from politeness or session count.`;

export const RELATIONSHIP_REVIEW_INSTRUCTIONS = `Independently audit every proposed relationship signal against exact learner and teacher turns.
Return one relationshipDecisions item for every signal index. Keep only if the type is directly supported by the cited exchange.
Reject ordinary lesson answers, generic thanks, model-authored claims, fictional or practice sentences, uncertain transcripts, and exaggerated interpretations.
Explicit romantic interest must genuinely be directed from the learner to Emilia. Mutual commitment requires a proposal plus a clearly accepting Emilia reply. Do not upgrade politeness into intimacy.`;

export function reviewRelationshipReflection(reflection, decisions) {
  const signals = Array.isArray(reflection?.signals) ? reflection.signals : [];
  if (!Array.isArray(decisions)) throw new Error('关系复核格式错误。');
  const seen = new Set();
  const kept = [];
  for (const decision of decisions) {
    if (!Number.isInteger(decision.index) || decision.index < 0 || decision.index >= signals.length || seen.has(decision.index)
      || typeof decision.keep !== 'boolean') throw new Error('关系复核索引无效。');
    seen.add(decision.index);
    if (decision.keep) kept.push(signals[decision.index]);
  }
  if (seen.size !== signals.length) throw new Error('关系复核未覆盖全部信号。');
  return { summaryZh: clean(reflection?.summaryZh, 200), signals: kept };
}

function publicSummary(state) {
  const labels = {
    teacher: '以老师身份认真了解你', familiar_companion: '已经是熟悉的聊天伙伴',
    trusted_companion: '把你视为值得信赖、愿意更坦率相处的人',
    mutual_romantic_openness: '双方已经对进一步的感情持开放态度', partnered: '已经互相确认了亲密关系'
  };
  const stance = { professional: '温和而克制', warming: '正在逐渐亲近', fond: '有稳定的在意与好感',
    open: '愿意回应明确的感情表达', committed: '以稳定、亲密而不依赖的方式相处' };
  const capabilities = structuredClone(state.capabilities);
  // Migrate existing v1 relationship files without making the user archive
  // another session first. These permissions are derived from the already
  // established stage/stance; they are not new relationship evidence.
  capabilities.personalQuestions = state.mode !== 'teacher_only'
    && stageAtLeast(state.stage, 'familiar_companion');
  capabilities.intimateQuestions = state.mode !== 'teacher_only'
    && ['fond', 'open', 'committed'].includes(state.stance);
  return { stage: state.stage, stance: state.stance, stageZh: labels[state.stage], stanceZh: stance[state.stance],
    mode: state.mode, capabilities, revision: state.revision, updatedAt: state.updatedAt,
    lastMilestone: state.milestones.at(-1) || null,
    note: '关系变化来自跨日、跨会话的多类可靠证据，不是好感度分数；不会影响英语评分。' };
}

export class RelationshipEngine {
  constructor(path, initialState = null) {
    this.path = path;
    if (path) mkdirSync(dirname(path), { recursive: true });
    let stored = null;
    if (!initialState && path && documentExists(path)) stored = JSON.parse(readDocument(path, 'utf8'));
    this.state = normalizeState(initialState || stored);
  }

  #save() {
    if (!this.path) return;
    writeDocument(this.path, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  bootstrap(memoryRecords = [], now = new Date().toISOString()) {
    if (this.state.revision || this.state.events.length) return this.view();
    const sources = memoryRecords.filter(row => row.scope === 'companion' && /teacher_relationship|relationship\./.test(row.key));
    for (const source of sources) {
      for (const proof of source.evidence || []) {
        this.state.events.push({ id: randomUUID(), type: 'care_or_appreciation', sessionId: proof.sessionId,
          turnId: proof.turnId, at: iso(proof.at || now), learnerQuote: clean(proof.quote, 200), teacherQuote: '',
          confidence: 'medium', noteZh: '由既有、经复核的伙伴记忆迁入。' });
      }
    }
    if (this.state.events.length) {
      this.#derive([], now, 'bootstrap');
      this.state.revision = 1;
      this.state.updatedAt = iso(now);
      this.#save();
    }
    return this.view();
  }

  #derive(externalBoundaries, now, reason) {
    const oldStage = this.state.stage;
    const events = this.state.events;
    const quality = events.filter(event => QUALITY_SIGNALS.has(event.type));
    const sessions = new Set(quality.map(event => event.sessionId));
    const dates = new Set(quality.map(event => dateKey(event.at)));
    const types = new Set(quality.map(event => event.type));
    const romantic = events.filter(event => event.type === 'user_romantic_interest');
    const romanticSessions = new Set(romantic.map(event => event.sessionId));
    const romanticDates = new Set(romantic.map(event => dateKey(event.at)));
    const storedBoundary = [...events].reverse().find(event => event.type === 'user_romantic_boundary');
    const externalBoundary = externalBoundaries.some(row => row.kind === 'boundary' && ROMANTIC_BOUNDARY.test(row.text));
    const romanceBlocked = Boolean(storedBoundary || externalBoundary || this.state.mode === 'teacher_only');

    let stage = this.state.stage;
    // Declining romance is not declining friendship or a warm teaching relationship.
    // High thresholds intentionally kept: English learning is a long-term activity.
    if (stage === 'teacher' && sessions.size >= 2 && dates.size >= 2 && types.size >= 2) stage = 'familiar_companion';
    if (stage === 'familiar_companion' && sessions.size >= 4 && dates.size >= 3 && types.size >= 3) stage = 'trusted_companion';
    if (!romanceBlocked && stage === 'trusted_companion' && romanticSessions.size >= 2 && romanticDates.size >= 2) stage = 'mutual_romantic_openness';
    const commitment = [...events].reverse().find(event => event.type === 'mutual_commitment');
    if (!romanceBlocked && oldStage === 'mutual_romantic_openness' && commitment) stage = 'partnered';
    if (romanceBlocked && stageAtLeast(stage, 'mutual_romantic_openness')) stage = 'trusted_companion';

    const fond = stageAtLeast(stage, 'trusted_companion') && sessions.size >= 6 && dates.size >= 5 && types.size >= 4;
    this.state.stage = stage;
    this.state.stance = stage === 'partnered' ? 'committed'
      : stage === 'mutual_romantic_openness' ? 'open'
        : fond ? 'fond' : stage === 'teacher' ? 'professional' : 'warming';
    this.state.capabilities = {
      callbacks: stageAtLeast(stage, 'familiar_companion'),
      affectionateLanguage: !romanceBlocked && stageAtLeast(stage, 'familiar_companion'),
      gentlePlayfulness: !romanceBlocked && stageAtLeast(stage, 'familiar_companion'),
      proactiveCare: stageAtLeast(stage, 'trusted_companion'),
      personalQuestions: this.state.mode !== 'teacher_only' && stageAtLeast(stage, 'familiar_companion'),
      intimateQuestions: this.state.mode !== 'teacher_only' && fond,
      subtleRomanticHints: !romanceBlocked && fond,
      classroomFlusteredRedirect: !romanceBlocked && fond && romanticSessions.size >= 1,
      canAcceptRomanticProposal: !romanceBlocked && stageAtLeast(stage, 'mutual_romantic_openness')
    };
    if (stage !== oldStage) this.state.milestones.push({ at: iso(now), from: oldStage, to: stage, reason });
    this.state.milestones = this.state.milestones.slice(-24);
  }

  apply(reflection, { sessionId, turns = [], externalBoundaries = [], now = new Date().toISOString() }) {
    if (this.state.sessions.includes(sessionId)) return { duplicate: true, accepted: 0, rejected: 0, relationship: this.view() };
    let accepted = 0, rejected = 0;
    for (const raw of reflection?.signals || []) {
      const type = SIGNAL_TYPES.includes(raw.type) ? raw.type : '';
      const turn = turns.find(item => item.id === raw.turnId);
      const learnerQuote = clean(raw.learnerQuote, 200);
      const teacherQuote = clean(raw.teacherQuote, 200);
      if (!type || !turn || turn.uncertain || learnerQuote.length < 4 || !clean(turn.learner, 500).includes(learnerQuote)
        || (teacherQuote && !clean(turn.teacher, 700).includes(teacherQuote))) { rejected++; continue; }
      if (type === 'user_romantic_interest' && !ROMANTIC_INTENT.test(learnerQuote)) { rejected++; continue; }
      if (type === 'user_romantic_boundary' && !ROMANTIC_BOUNDARY.test(learnerQuote)) { rejected++; continue; }
      if (type === 'mutual_commitment' && (!ROMANTIC_INTENT.test(learnerQuote) || !COMMITMENT_ACCEPTANCE.test(teacherQuote))) {
        rejected++; continue;
      }
      const duplicate = this.state.events.some(event => event.sessionId === sessionId && event.turnId === turn.id && event.type === type);
      if (duplicate) continue;
      this.state.events.push({ id: randomUUID(), type, sessionId, turnId: turn.id, at: iso(turn.at || now),
        learnerQuote, teacherQuote, confidence: raw.confidence, noteZh: clean(raw.noteZh, 120) });
      accepted++;
    }
    const cutoff = Date.parse(now) - 730 * DAY;
    this.state.events = this.state.events.filter(event => Date.parse(event.at) >= cutoff).slice(-180);
    this.state.sessions = [...this.state.sessions, sessionId].slice(-160);
    this.#derive(externalBoundaries, now, 'cross-session evidence gate');
    this.state.revision += 1;
    this.state.updatedAt = iso(now);
    this.#save();
    return { duplicate: false, accepted, rejected, relationship: this.view() };
  }

  view() { return publicSummary(this.state); }

  context() {
    const view = this.view();
    const arcLabels = {
      repair_completed: 'A misunderstanding was repaired.',
      boundary_respected: 'A stated boundary was respected.',
      care_or_appreciation: 'Care or appreciation was expressed.',
      meaningful_disclosure: 'The learner shared something personally meaningful.'
    };
    const recentArc = [...new Set(this.state.events.slice(-16).map(event => event.type))]
      .filter(type => arcLabels[type]).slice(-2).map(type => arcLabels[type]).join(' ');
    return [
      'CURRENT RELATIONSHIP CAPSULE (application data; permissions follow the master personality and active mode, including formal lesson):',
      `Current relationship: ${view.stageZh}.`,
      `Available behaviours: ${JSON.stringify(view.capabilities)}.`,
      recentArc ? `Recent corroborated interaction categories (not a requested topic): ${recentArc}` : ''
    ].join('\n');
  }
}
