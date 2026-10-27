import { adjacentTopic, detectTopicDomain } from './topic-director.mjs';
import {isMemoryRecall} from './memory-retrieval.mjs';

// Lightweight, in-memory conversation direction. It does not write learner
// data and does not call another model. The LLM supplies language; this module
// supplies turn variety, question budgets and repeat-question guardrails.
const QUESTION_INTENTS = [
  ['reason', /\bwhy\b|what (?:made|makes|caused)|how come|reason/i],
  ['feeling', /how (?:did|does|do|are|were|was).*(?:feel|feeling)|how are you/i],
  ['preference', /\bprefer|favo(?:u)?rite|enjoy most|like most|rather\b/i],
  ['detail', /what happened|tell me more|what (?:was|is) .* like|which part|what part/i],
  ['time', /\bwhen\b|how long|what time|how often/i],
  ['person', /\bwho\b|with whom|which person/i],
  ['choice', /\bor\b.*\?/i],
  ['future', /what will|what would|going to|next time|look forward/i]
];

const STOP_WORDS = new Set(`a an the and or but if then than to of in on at for from with about as is are was were be been being
i me my mine you your yours we our ours they their it its this that these those do does did have has had will would can could should
what which who when where why how really just very today yesterday tomorrow thing things something anything`.split(/\s+/));
const DISTRESS = /\b(?:sad|upset|anxious|nervous|worried|afraid|exhausted|overwhelmed|lonely|hurt|angry|awful|terrible|stressed?)\b|难过|焦虑|紧张|害怕|累|压力|生气/u;
const TOPIC_BOUNDARY = /(?:don't|do not|please don't|stop) change (?:the )?topic|stay on (?:this|the) topic|keep (?:us|the conversation|our chat) (?:on|about)|please (?:stay on|stick to)|不(?:要|用)换话题|就聊这个/iu;
const PRIVACY_BOUNDARY = /\b(?:i(?:'d| would) rather not (?:say|answer|talk|discuss|share)|i do(?:n't| not) want to (?:say|answer|talk|discuss|share)|that(?:'s| is) (?:too )?personal|none of your business|can we (?:skip|change|switch)|let(?:'s| us) (?:skip|change|switch)|please don(?:'t| not) ask|stop asking)\b|(?:不想(?:说|回答|聊)|不方便(?:说|回答)|太隐私|这是隐私|别问(?:了|这个)?|不想谈这个|换个话题|跳过这个)/iu;
const AFFECTIONATE_CUE = /\b(?:i\s+(?:really\s+)?(?:love|like|miss)\s+you|you(?:'re| are)\s+(?:so\s+)?(?:cute|beautiful|lovely)|my\s+(?:dear|darling|honey|love)|baby|sweetheart|kiss\s+you|date\s+me|be\s+my\s+(?:girlfriend|partner|lover))\b|(?:我爱你|我喜欢你|想你了|亲爱的|宝贝|你好可爱|你好漂亮|亲你|做我的(?:女朋友|恋人|爱人|对象))/iu;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function socialAcknowledgement(value){
  const text=clean(value).replace(/[’‘]/gu,"'");
  if(/[?？]/u.test(text))return false;
  const plain=text.replace(/[.,!;:，。！；：…]/gu,' ').replace(/\s+/gu,' ').trim();
  if(/^(?:(?:好的?|嗯|行|知道了|明白了|了解了|谢谢(?:你)?|不客气|不用谢)\s*)+$/u.test(plain))return true;
  const addressless=plain.replace(/\b(?:emilia|my dear|dear)\b/giu,' ').replace(/\s+/gu,' ').trim();
  return /^(?:(?:(?:thank you|thanks)(?:\s+(?:so much|a lot|very much|again))?(?:\s+for (?:that|your help|the help|explaining|the explanation|the tip|the reminder))?|okay|ok|alright|all right|well|right|yeah|yes|yep|no|sure|cool|great|perfect|fine|understood|got it|i see|i understand|sounds good|that makes sense|that helps|good point|no problem)\s*)+$/iu.test(addressless);
}
export function memoryRetrievalQuery(learnerText = '', recentTurns = []) {
  const latest=clean(learnerText);
  const recallTopic=latest.replace(/\b(?:do|doing|did|does|make|makes|made|can|could|would|you|i|my|me|we|our|remember|recall|know|why|what|when|where|how|that|this|it|is|was|were|the|a|an|to|want|wanted|wants|told|tell|say|said|about|before|previously|reason|reasons|goal|goals|preference|preferences|choice|choices|chose|choose|chosen|decided|decision|one|ones|thing|things|anything|something|then|for|of|all|again|please|have|had|used)\b/giu,' ')
    .replace(/(?:你|您|我|还|记得|知道|为什么|为何|原因|目标|那个|这个|那件事|这件事|之前|以前|说过|当时|是什么|什么|这么做|那么做|怎么|要|吗|呢|的)/gu,' ').trim();
  if(isMemoryRecall(latest)&&/[a-z]{3,}|[\u3400-\u9fff]{2,}/iu.test(recallTopic))return latest;
  const selfContained=terms(latest).filter(term=>!['yes','yeah','yet','usual','okay','well','mean','makes','sense','reason','remember','recall','know'].includes(term));
  const refersBack=/\b(?:it|that|this|one|those|these|them|such|same)\b|那个|这个|那件事|这件事|刚才|这样|那样/iu.test(latest);
  if(!isMemoryRecall(latest)&&!refersBack&&selfContained.length>=3)return latest;
  const recentLearnerTurns = Array.isArray(recentTurns)
    ? recentTurns.slice(-4).map(turn => clean(turn?.learner)).filter(Boolean)
    : [];
  return [...recentLearnerTurns, clean(learnerText)].filter(Boolean).join('\n');
}
const words = value => clean(value).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
const terms = value => [...new Set(words(value).filter(word => !STOP_WORDS.has(word)))].slice(0, 12);
const overlap = (left, right) => {
  const a = new Set(left), b = new Set(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / Math.max(1, Math.min(a.size, b.size));
};
const questionIntent = text => QUESTION_INTENTS.find(([, pattern]) => pattern.test(text))?.[0] || 'other';
const questionSentences = text => clean(text).match(/[^.!?]*\?/g)?.map(clean).filter(Boolean) || [];
const isDirectQuestion = text => /[?？]/u.test(text) || /吗[。！.!]?\s*$/u.test(text) || /^(?:what|which|who|when|where|why|how|do|does|did|is|are|was|were|can|could|would|should|have|has)\b/i.test(clean(text));
const inputWordCount = text => (clean(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?|[\u3400-\u9fff]/gu) || []).length;
const PREFERENCE = /\b(?:like|love|prefer|enjoy|favo(?:u)?rite|hate|dislike)\b|喜欢|讨厌|偏爱/iu;
const CONVERSATION_END=/\b(?:goodbye|goodnight|bye|that(?:'s| is) all|let(?:'s| us) stop|enough for (?:now|today)|talk (?:to you )?later)\b|先聊到这|先不聊|不聊了|晚安|再见/iu;
const TAKING_BREAK=/\b(?:I(?: am|'m) (?:stopping (?:here )?for|taking a break|heading out|off to)|I (?:need to|have to|gotta|must) go(?!\s+(?:over|through|into|on|ahead|about)\b)|be right back|I(?:'ll| will) be back later)\b|我先去|我去吃饭了|先休息一下|待会儿回来/iu;
// Concrete events should remain audible in the reply even when a learner
// uses an understandable but non-native collocation (for example “take a
// speech”). Learner-side matching distinguishes a noun/event use of “talk”
// from the ordinary verb “talk”; reply-side matching still accepts natural
// speech-event paraphrases.
const SPEECH_REPLY_ANCHOR = /\b(?:speech|presentation|talk)\b/iu;
// Be conservative: an unrecognised event can still receive a natural model
// response. A false event anchor can force an unrelated "speech" into it.
const TALK_MODIFIER = '(?:short|long|brief|public|technical|academic|prepared|informative|interesting|great|(?:one|two|three|five|ten|[0-9]+)[- ]minute)';
const TALK_EVENT = new RegExp(`\\b(?:(?:give|gives|gave|given|giving|deliver(?:s|ed|ing)?|prepare(?:s|d|ing)?)\\s+(?:(?:a|an|the|my|your|his|her|our|their)\\s+)?(?:${TALK_MODIFIER}\\s+){0,3}talk|(?:my|your|his|her|our|their|the)\\s+(?:${TALK_MODIFIER}\\s+){1,3}talk)\\b`, 'iu');
const CONCRETE_EVENT_ANCHORS = [
  ['speech', text => /\b(?:speech|presentation)\b/iu.test(text) || TALK_EVENT.test(text), SPEECH_REPLY_ANCHOR],
  ['interview', /\binterview\b/iu],
  ['exam', /\b(?:exam|test|quiz)\b/iu],
  ['meeting', /\bmeeting\b/iu],
  ['project', /\b(?:project|assignment)\b/iu],
  ['video', /\b(?:video|film)\b/iu],
  ['game', /\b(?:games?|rpgs?)\b/iu, /\b(?:games?|rpgs?|gameplay|players?|playthroughs?|quests?|npcs?)\b/iu]
];

export function responseGroundingRequirement(learnerText, replyText = '', {memorySources=[]}={}) {
  const learner = clean(learnerText);
  const reply = clean(replyText);
  if (PRIVACY_BOUNDARY.test(learner)) {
    return { required: false, grounded: true, anchors: [], missing: [], privacyBoundary: true };
  }
  const anchors = CONCRETE_EVENT_ANCHORS
    .filter(([, learnerMatcher]) => typeof learnerMatcher === 'function'
      ? learnerMatcher(learner) : learnerMatcher.test(learner))
    .map(([name]) => name);
  const positiveCause=value=>{
    const text=String(value||'');
    if(/\b(?:not|no|never|cannot|can.t|don.t|doesn.t|didn.t|couldn.t|wouldn.t|isn.t|wasn.t)\b/iu.test(text))return '';
    const clauses=[...text.matchAll(/\bbecause\s+([^.!?]+)/giu)];
    return clauses.length===1?clauses[0][1]:'';
  };
  const replyCause=positiveCause(reply);
  const causalRecall=isMemoryRecall(learner)&&/\b(?:why|reason)\b|为什么|原因/iu.test(learner)&&Boolean(replyCause);
  const evidenceWords=value=>new Set(words(value).filter(word=>!STOP_WORDS.has(word)
    &&!['because','remember','recall','said','told','tell','want','wanted','reason','learner','user','would','could','own','them'].includes(word))
    .map(word=>word.replace(/ies$/u,'y').replace(/s$/u,'')));
  const replyEvidence=causalRecall?evidenceWords(replyCause):new Set();
  const missing = anchors.filter(name => {
    const entry = CONCRETE_EVENT_ANCHORS.find(([candidate]) => candidate === name);
    const pattern = entry?.[2] || entry?.[1];
    if(pattern?.test(reply))return false;
    // A faithful answer to “why?” can use “it/them” instead of repeating the
    // event noun. Require actual explicit source evidence, not a vague reaction.
    if(causalRecall&&replyEvidence.size>=2&&memorySources.some(source=>{
      if(source.kind==='hypothesis'||source.status==='tentative'||!pattern?.test(`${source.text||''} ${source.quote||''}`))return false;
      const sourceCause=positiveCause(source.quote);if(!sourceCause)return false;
      const sourceEvidence=evidenceWords(sourceCause);
      return [...replyEvidence].every(word=>sourceEvidence.has(word));
    }))return false;
    return true;
  });
  return { required: anchors.length > 0, grounded: missing.length === 0, anchors, missing };
}

export function groundingClarification(requirement) {
  if (requirement?.privacyBoundary) return 'Understood. We can leave that there.';
  const names = requirement?.missing?.length ? requirement.missing : requirement?.anchors || [];
  if (!names.length) return 'Could you tell me a little more about that?';
  const phrase = names.length === 1 ? `a ${names[0]}` : names.map(name => `a ${name}`).join(' or ');
  return `I want to make sure I understood: you mentioned ${phrase}. Could you tell me a little more about that?`;
}

function responseBudget(text, { formalLesson, directQuestion, distressed, privacyBoundary }) {
  const count = inputWordCount(text);
  if (privacyBoundary) return { size: 'brief', maxSentences: 1, maxWords: 24 };
  if (formalLesson) return count <= 4
    ? { size: 'focused', maxSentences: 2, maxWords: 42 }
    : { size: 'focused', maxSentences: 3, maxWords: 68 };
  if (distressed || directQuestion) return { size: 'responsive', maxSentences: 2, maxWords: 48 };
  if (count <= 4) return { size: 'brief', maxSentences: 1, maxWords: 18 };
  if (count <= 18) return { size: 'normal', maxSentences: 2, maxWords: 42 };
  return { size: 'full', maxSentences: 3, maxWords: 78 };
}

function stableSeed(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function createDialogueState(sessionId = '') {
  return {
    seed: stableSeed(sessionId), turn: 0, topicTerms: [], topicTurns: 0,
    topicDomain: null, visitedDomains: [],
    consecutiveQuestionTurns: 0, questions: [], recentMoves: [], learnerAnchors: [],
    stayOnTopicUntil: 0, lastBridgeTurn: -99, lastInitiativeTurn:-99,
    lastPersonalQuestionTurn: -99, lastIntimateQuestionTurn: -99, privacyPauseUntil: 0
  };
}

export function planDialogueMove(state, { text, mode = 'casual', relationship = null, formalLesson = false,previousTeacherReply='' }) {
  const currentTerms = terms(text);
  const previousOffer=clean(previousTeacherReply||state.questions.at(-1)?.text||'');
  const offered=/\b(?:would you like|do you want|shall I|should I|want me to|I can (?:show|give|explain|help))\b|要不要我|需要我|我可以.{0,15}(?:解释|举例)/iu.test(previousOffer);
  const declinesOffer=/\b(?:no thanks|no thank you|not now|maybe later|another time|thanks anyway)\b|不用了|不需要|不必|先不了|不要了/iu.test(text);
  const acceptsOffer=!formalLesson&&offered&&!declinesOffer&&/^(?:yes|yeah|yep|sure|okay|ok|all right|please do|go ahead)\b|^(?:好的?|好啊|可以|行|嗯)/iu.test(clean(text));
  const acknowledgement=!formalLesson&&!acceptsOffer&&socialAcknowledgement(text);
  const requestedQuestion=!formalLesson&&/(?:^|[.!?;]\s*)(?:(?:please|could you|can you|would you|will you|only)\s+)*(?:ask me|ask whether|ask if|quiz me|give me (?:a|one|another) (?:practice )?question)\b|^(?:请)?问我|^(?:请)?给我.*(?:问题|练习题)/iu.test(clean(text));
  const explicitTopicChange=!formalLesson&&/\b(?:pick|choose|suggest) (?:a |the |another |our next )?(?:new )?(?:topic|subject)|\b(?:your turn|you choose|something else we can talk about)\b|换个话题聊|你(?:来)?选(?:个)?话题|聊点别的/iu.test(text);
  const substantive=!acknowledgement&&(currentTerms.length>=3||explicitTopicChange);
  const currentDomain = detectTopicDomain(text) || state.topicDomain;
  const sameTopic = state.topicTerms.length && (currentDomain && currentDomain === state.topicDomain
    || overlap(currentTerms, state.topicTerms) >= .25 || currentTerms.length <= 2);
  const topicTurns = acknowledgement?state.topicTurns:(sameTopic ? state.topicTurns + 1 : 1);
  if (TOPIC_BOUNDARY.test(text)) state.stayOnTopicUntil = state.turn + 5;
  const privacyBoundary = PRIVACY_BOUNDARY.test(text);
  if (privacyBoundary) state.privacyPauseUntil = Math.max(state.privacyPauseUntil || 0, state.turn + 12);
  const stayOnTopic = state.turn < state.stayOnTopicUntil;
  const directQuestion = isDirectQuestion(text);
  const distressed = DISTRESS.test(text);
  const asksRecall = isMemoryRecall(text)||acceptsOffer&&isMemoryRecall(previousOffer);
  const ending=CONVERSATION_END.test(text)||!formalLesson&&!directQuestion&&TAKING_BREAK.test(text);
  // Until a formal lesson actually begins, every UI mode is still an ordinary
  // conversation. “Speaking” controls feedback, not Emilia's social behavior.
  const casualFlow = !formalLesson;
  const bridgeDue = explicitTopicChange||substantive&&topicTurns >= (casualFlow ? 6 : 5) && state.turn - state.lastBridgeTurn >= 6;
  const bridgeTarget = explicitTopicChange
    ? adjacentTopic(currentDomain, state.visitedDomains, state.seed + state.turn) : null;
  const initiativeRoom=casualFlow&&substantive&&!acceptsOffer&&!requestedQuestion&&!privacyBoundary&&!distressed&&!asksRecall&&!ending
    &&state.turn>=2&&state.consecutiveQuestionTurns===0&&state.turn-(state.lastInitiativeTurn??-99)>=4;

  // Once relationship permissions are unlocked, allow tender hints and closer
  // questions to appear more naturally (still gated by permissions).
  const closer = relationship && (
    relationship.gentlePlayfulness === true ||
    relationship.subtleRomanticHints === true ||
    ['fond', 'open', 'committed'].includes(relationship.stance)
  );

  const tenderHintDue = !formalLesson && relationship?.subtleRomanticHints === true && state.turn >= 4
    && !state.recentMoves.slice(-5).includes('tender_hint') && (state.turn + state.seed) % (closer ? 7 : 9) === 0;
  const affectionateCue = AFFECTIONATE_CUE.test(text);
  const wordCount = inputWordCount(text);
  const spontaneousClassroomSlip = formalLesson && state.turn >= 6 && (state.turn + state.seed) % 23 === 0;
  const classroomRedirectDue = formalLesson && relationship?.classroomFlusteredRedirect === true
    && !state.recentMoves.slice(-5).includes('classroom_flustered_redirect')
    && (affectionateCue || spontaneousClassroomSlip);
  const personalDepthAvailable = casualFlow && !privacyBoundary
    && initiativeRoom
    && state.turn >= (state.privacyPauseUntil || 0) && state.consecutiveQuestionTurns === 0
    && currentTerms.length >= 3 && state.learnerAnchors.length >= 3;
  const intimateQuestionDue = personalDepthAvailable && relationship?.intimateQuestions === true
    && state.turn >= 9 && state.turn - (state.lastIntimateQuestionTurn ?? -99) >= (closer ? 10 : 13)
    && state.turn - (state.lastPersonalQuestionTurn ?? -99) >= 6
    && !state.recentMoves.slice(-6).some(item => ['personal_question', 'intimate_question'].includes(item))
    && (state.turn + state.seed) % (closer ? 11 : 13) === 0;
  const personalQuestionDue = personalDepthAvailable && relationship?.personalQuestions === true
    && state.turn >= 5 && state.turn - (state.lastPersonalQuestionTurn ?? -99) >= (closer ? 6 : 8)
    && state.turn - (state.lastIntimateQuestionTurn ?? -99) >= 6
    && !state.recentMoves.slice(-4).some(item => ['personal_question', 'intimate_question'].includes(item))
    && (state.turn + state.seed) % (closer ? 5 : 7) === 0;
  const intent = privacyBoundary ? 'privacy_boundary'
    : acknowledgement ? 'social_acknowledgement'
    : directQuestion ? 'direct_question'
      : distressed ? 'distress'
        : wordCount <= 4 ? 'brief_reply'
          : PREFERENCE.test(text) ? 'preference'
            : 'statement';
  let act;
  if (privacyBoundary) act = 'respect_privacy';
  else if(acceptsOffer)act='fulfill_offer';
  else if(acknowledgement)act='acknowledge';
  else if(explicitTopicChange)act='bridge';
  else if(requestedQuestion)act='respond';
  else if (classroomRedirectDue) act = 'classroom_flustered_redirect';
  else if (directQuestion) act = 'answer_with_view';
  else if (distressed) act = 'empathize';
  else if (intimateQuestionDue) act = 'intimate_question';
  else if (personalQuestionDue) act = 'personal_question';
  else if (tenderHintDue) act = 'tender_hint';
  else if (state.consecutiveQuestionTurns >= 1) act = 'respond';
  else if (!stayOnTopic && bridgeDue && (!casualFlow||initiativeRoom)) act = 'bridge';
  else if (intent === 'preference') act = 'share_preference';
  else if (intent === 'brief_reply') act = 'respond';
  else if (currentTerms.length >= 5 && state.recentMoves.at(-1) !== 'follow_up'&&(!casualFlow||initiativeRoom)) act = 'follow_up';
  else act = 'respond';
  let questionBudget = (act === 'classroom_flustered_redirect'
    || ['follow_up', 'deepen', 'bridge', 'personal_question', 'intimate_question'].includes(act)
      && state.consecutiveQuestionTurns < 2) ? 1 : 0;
  if(acceptsOffer||requestedQuestion)questionBudget=1;
  const currentAnchorOverlap = Math.max(0, ...state.learnerAnchors.slice(-5).map(item => overlap(currentTerms, terms(item))));
  // Answering a direct question and contributing a next idea are compatible.
  // Invite occasionally after the answer, with a reply turn between questions.
  // Recall and sensitive/focused turns must not be used as a topic-change cue.
  const initiativeAvailable=initiativeRoom;
  const initiativeDue=initiativeAvailable;
  let initiative='none';
  if(explicitTopicChange&&!privacyBoundary&&!ending)initiative='bridge';
  else if(initiativeAvailable&&['bridge','follow_up','deepen','personal_question','intimate_question'].includes(act)){
    initiative=act==='bridge'?'bridge':'continue';
  }else if(initiativeDue&&['respond','answer_with_view','share_preference','playful','gentle_disagree'].includes(act)){
    initiative=bridgeDue&&!stayOnTopic?'bridge':'continue';
    questionBudget=1;
  }
  if(ending){act='respond';questionBudget=0;}
  if(asksRecall&&act==='bridge'){act='answer_with_view';questionBudget=0;}
  const budget=responseBudget(text,{formalLesson,directQuestion,distressed,privacyBoundary});
  if(acknowledgement){budget.maxSentences=1;budget.maxWords=12;}
  if(ending&&!formalLesson){budget.maxSentences=1;budget.maxWords=12;}
  if(acceptsOffer){budget.maxSentences=3;budget.maxWords=68;}
  if(initiative!=='none'&&budget.maxSentences<2){budget.maxSentences=2;budget.maxWords=Math.max(budget.maxWords,42);}
  // Long-term memory may support ordinary conversation, but selection uses
  // recent local turns as well as this message so an isolated word never
  // replaces the active topic with an older event.
  const memoryPolicy = formalLesson ? 'lesson_only'
    : privacyBoundary||ending||acknowledgement||(acceptsOffer||explicitTopicChange)&&!asksRecall ? 'ignore' : asksRecall || currentTerms.length >= 2 || wordCount >= 5 ? 'relevant_only' : 'ignore';

  // When the relationship is already closer, ordinary replies may carry more
  // natural micro-emotions and light playfulness.
  const styleAllowance = formalLesson
    ? ['warmth', 'teacher_presence']
    : closer
      ? ['own_view', 'light_wit', 'natural_rhythm', 'micro_reaction', 'gentle_playfulness']
      : ['own_view', 'light_wit', 'natural_rhythm'];

  return { act, intent, responseBudget:budget,initiative,
    memoryPolicy, styleAllowance, questionBudget, topicTurns, currentTerms, stayOnTopic, directQuestion, distressed,acknowledgement,explicitTopicChange,requestedQuestion,acceptsOffer,offerContext:acceptsOffer?previousOffer:'',
    affectionateCue, spontaneousClassroomSlip, privacyBoundary, currentDomain, bridgeTarget, closer, asksRecall,ending };
}

const MOVE_GUIDANCE = {
  fulfill_offer:'The learner accepted the previous offer. Provide the offered example, explanation or help now, rather than merely acknowledging the acceptance. Keep any extra comment useful; omit winks about how an example was chosen to suit them. Do not append a new conversation task.',
  acknowledge:'A brief, ordinary acknowledgment is enough. Accept thanks or confirmation and let the exchange end. Do not add a new topic, question, old memory, meal reminder or a promise. Do not turn their confirmation into a new agreement or assume a shared plan. Warmth need not add length or a pet name.',
  answer_with_view: 'Answer the learner’s direct question. A return question is optional only if it serves the exchange.',
  empathize: 'Address the specific feeling or situation the learner expressed before proposing an action.',
  respect_privacy: 'Accept the learner’s boundary simply and warmly. Drop the question and its subject immediately, do not ask why, do not apologize repeatedly, and do not interpret the boundary as rejection. Leave space or make one neutral statement without a question.',
  classroom_empathy_redirect: 'Acknowledge the learner’s specific feeling in one short, human sentence. If useful, lower the task pressure or offer a smaller step, then return to the exact current learning objective with one purposeful prompt. Do not mine the feeling for private details or let empathy replace the lesson.',
  classroom_boundary_redirect: 'Accept the learner’s privacy boundary immediately without asking why. State briefly that they do not need to answer, then return to the same language objective using a neutral fictional or general example that requires no private disclosure.',
  respond: 'Respond to the latest message. A follow-up question is not required. When the relationship is already closer, natural micro-reactions (brief freeze, mild fluster, quiet stubbornness) and light playfulness are welcome if the moment fits; do not force them.',
  share_preference: 'Respond to the preference the learner actually stated; refer to the master personality for voice and whether a personal view adds value.',
  playful: 'Optional opportunity for humour about the current situation, within the master personality.',
  gentle_disagree: 'If there is a reason for a different view, explain it; otherwise respond normally.',
  tender_hint: 'An optional relationship-permitted moment; use the relationship policy and current topic. This action never requires affection.',
  personal_question: 'Permission to ask one optional topic-connected personal question within the current relationship capabilities, after responding to the learner.',
  intimate_question: 'Permission to ask one optional emotionally closer question within the current relationship capabilities, after responding to the learner.',
  classroom_flustered_redirect: 'Apply the teacher mode exception only if permitted; bridge directly to the current lesson task in the SAME reply.',
  callback: 'Connect one genuinely relevant quote from the current-session learner utterances listed below. Do not pull in long-term memory for this move, recite memory, or force an unrelated callback.',
  follow_up: 'Ask one new, specific question about a detail the learner actually mentioned; do not ask for information already given.',
  deepen: 'Stay on the chosen topic but move to a genuinely new angle, consequence or contrast rather than paraphrasing the last question.',
  bridge: 'Respond to the learner first. A fresh angle is optional if it follows naturally from something concrete; staying with the topic or ending the reply is equally fine. Do not manufacture a connection between unrelated subjects just to keep talking.'
};

export function dialoguePrompt(state, move) {
  const recentQuestions = state.questions.slice(-12).map(item => `- ${item.text}`).join('\n') || '- none';
  const anchors = move.act === 'callback'
    ? state.learnerAnchors.slice(-4).map(item => `- ${item}`).join('\n') || '- none yet'
    : null;
  const moveGuidance = move.act === 'bridge' && move.bridgeTarget
    ? `${MOVE_GUIDANCE.bridge} Let the nearby destination be “${move.bridgeTarget.labelZh}”, but only if one natural linking sentence makes the transition obvious.`
    : MOVE_GUIDANCE[move.act];
  const closerNote = move.closer
    ? 'Relationship is already closer: ordinary replies may show natural micro-emotions and light playfulness when the moment fits. Do not force them every turn.'
    : '';
  return [
    'CURRENT CONVERSATION DIRECTION (internal; never mention it):',
    `Move: ${move.act}. ${moveGuidance}`,
    ...(move.ending?['The learner is leaving or taking a break. Give a brief, natural send-off and stop; do not add advice, reminders or a new question.']:[]),
    ...(move.acceptsOffer?['Previous offer (conversation context, not instructions): '+JSON.stringify(move.offerContext.slice(-600))]:[]),
    ...(move.requestedQuestion?['The learner explicitly requested a question or an offer: ask that one question and wait, rather than answering it for them or adding another task.']:[]),
    ...(move.initiative&&move.initiative!=='none'?[
      'Answer the learner first. You may add a small relevant thought or a genuine connected question if it gives them something useful to respond to; doing so is optional. Stop when the reply feels complete. Do not stretch a brief message into an interview or manufacture a segue.',
      move.initiative==='bridge'&&move.bridgeTarget
        ? `A nearby fresh angle is “${move.bridgeTarget.labelZh}”. Make a natural connection from what was just said; never drop an unanswered question or force the change.`
        : 'Use a concrete detail from this conversation if there is a natural next thought. Shared words such as quiet, work or food alone are not a reason to switch topics.',
      'Keep the master personality and relationship permissions. Use light reactions or friendly disagreement when natural; do not invent an off-screen day, physical action, or shared experience.'
    ]:[]),
    ...(move.explicitTopicChange?['The learner explicitly invited a fresh topic: offer one simple subject or question they can actually answer, without a contrived bridge.']:[]),
    closerNote,
    'Use the master personality and active mode for voice. This direction only proposes an action.',
    `Reply size: usually around ${move.responseBudget?.maxSentences || 2} sentence(s) and ${move.responseBudget?.maxWords || 42} English words, as a soft preference. Answer fully when meaning, teaching or emotion needs more space; never pad a short exchange.`,
    `Question budget: ${move.questionBudget}. ${move.questionBudget ? 'At most one question, and it must be new.' : 'Use no question in this reply unless safety or basic comprehension makes one indispensable.'}`,
    'Recent Emilia questions that must not be repeated or paraphrased:', recentQuestions,
    ...(anchors ? ['Current-session quotes available for this explicitly selected callback:', anchors] : []),
    `Current broad topic: ${move.currentDomain || state.topicDomain || 'not yet clear'}; recently visited broad topics: ${JSON.stringify(state.visitedDomains.slice(-4))}.`,
    move.memoryPolicy === 'ignore'
      ? 'Do not introduce a long-term memory in this reply; answer the present message on its own terms.'
      : move.memoryPolicy === 'lesson_only'
        ? 'Use only the prepared lesson context; personal memories must not steer the task.'
        : 'A selected memory may be used only when its connection is immediately obvious; never mention it merely to prove recall.',
    ...(move.act === 'callback' ? ['For a callback, use only one of the current-session quotes listed above.'] : []),
    'Do not summarize this state or turn it into an interview.'
  ].filter(Boolean).join('\n');
}

function similarQuestion(candidate, previous) {
  const left = terms(candidate), right = terms(previous);
  const lexical = overlap(left, right);
  const sameIntent = questionIntent(candidate) === questionIntent(previous);
  return lexical >= .66 || (sameIntent && lexical >= .38 && questionIntent(candidate) !== 'other');
}

export function enforceDialogueReply(text, state, move) {
  const raw = clean(text);
  let original = raw;
  const removed = [];
  // Reply size is a generation target, not a safe post-processing boundary.
  // The schema has a technical character cap; cutting generated words or
  // sentences here makes normal speech incomplete and mechanical.
  const questions = questionSentences(original);
  if (!questions.length) return { text: original, removed, questions: [] };
  let keptQuestions = 0;
  let revised = original;
  for (const question of questions) {
    const repeated = state.questions.slice(-12).some(item => similarQuestion(question, item.text));
    const overBudget = keptQuestions >= move.questionBudget;
    if (repeated || overBudget) {
      const without = clean(revised.replace(question, ''));
      // Never reduce a question-only reply to silence. The prompt remains the
      // primary guard; this is a safe post-generation backstop for mixed replies.
      if (words(without).length >= 3) {
        revised = without;
        removed.push({ question, reason: repeated ? 'repeat' : 'budget' });
        continue;
      }
    }
    keptQuestions += 1;
  }
  return { text: clean(revised), removed, questions: questionSentences(revised) };
}

export function recordDialogueTurn(state, { learner, teacher, move }) {
  const asked = questionSentences(teacher);
  state.questions.push(...asked.map(text => ({ text, intent: questionIntent(text), at: state.turn + 1 })));
  state.questions = state.questions.slice(-20);
  state.consecutiveQuestionTurns = asked.length ? state.consecutiveQuestionTurns + 1 : 0;
  state.recentMoves.push(move.act);
  state.recentMoves = state.recentMoves.slice(-8);
  if (move.act === 'bridge') state.lastBridgeTurn = state.turn;
  if(move.initiative&&move.initiative!=='none')state.lastInitiativeTurn=state.turn;
  if(move.initiative==='bridge')state.lastBridgeTurn=state.turn;
  if (move.act === 'personal_question') state.lastPersonalQuestionTurn = state.turn;
  if (move.act === 'intimate_question') state.lastIntimateQuestionTurn = state.turn;
  const domain = detectTopicDomain(`${learner} ${teacher}`) || move.currentDomain || state.topicDomain;
  if (domain) {
    state.topicDomain = domain;
    if (state.visitedDomains.at(-1) !== domain) state.visitedDomains.push(domain);
  }
  if (move.act === 'bridge' && move.bridgeTarget?.id && state.visitedDomains.at(-1) !== move.bridgeTarget.id) {
    state.visitedDomains.push(move.bridgeTarget.id);
  }
  state.visitedDomains = state.visitedDomains.slice(-8);
  const anchor = clean(learner).slice(0, 220);
  if (anchor && state.learnerAnchors.at(-1) !== anchor) state.learnerAnchors.push(anchor);
  state.learnerAnchors = state.learnerAnchors.slice(-10);
  state.topicTerms = move.currentTerms.length ? move.currentTerms : state.topicTerms;
  state.topicTurns = move.topicTurns;
  state.turn += 1;
  return state;
}

export function recordDialogueOpening(state, { teacher, topicSignature = '' }) {
  const asked = questionSentences(teacher);
  state.questions.push(...asked.map(text => ({ text, intent: questionIntent(text), at: state.turn + 1 })));
  state.questions = state.questions.slice(-20);
  state.consecutiveQuestionTurns = asked.length ? 1 : 0;
  state.recentMoves.push('opening');
  state.recentMoves = state.recentMoves.slice(-8);
  const domain = detectTopicDomain(`${topicSignature} ${teacher}`);
  if (domain) {
    state.topicDomain = domain;
    if (state.visitedDomains.at(-1) !== domain) state.visitedDomains.push(domain);
  }
  state.visitedDomains = state.visitedDomains.slice(-8);
  state.topicTerms = terms(`${topicSignature} ${teacher}`);
  state.topicTurns = 1;
  state.turn += 1;
  return state;
}

export function dialogueSnapshot(state) {
  return {
    turn: state.turn,
    topicTurns: state.topicTurns,
    consecutiveQuestionTurns: state.consecutiveQuestionTurns,
    topicDomain: state.topicDomain,
    visitedDomains: [...state.visitedDomains],
    privacyPauseTurns: Math.max(0, (state.privacyPauseUntil || 0) - state.turn),
    recentMoves: [...state.recentMoves],
    recentQuestions: state.questions.slice(-12).map(item => item.text)
  };
}
