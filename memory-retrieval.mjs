// Small bilingual lexical index. No embeddings, network calls or recursive activation.
const STOP = new Set('the and that this with have has had you your yours what when where why how about just really some much like likes enjoy enjoys remember recall told said learner user prefer prefers want wants wanted know knows make makes own can could would should did does not my me our'.split(' '));
const GROUPS = [
  ['drink', /\b(?:drinks?|juice|milk|coffee|tea|beverages?)\b|饮料|果汁|牛奶|咖啡|喝|茶/giu],
  ['food', /food|cook|dinner|lunch|breakfast|meal|吃|做饭|晚餐|午餐|早餐|食物/giu],
  ['game', /games?|rpg|gaming|游戏/giu], ['travel', /travel|countr(?:y|ies)|trip|visit|旅行|国家|旅游/giu],
  ['work', /work|jobs?|career|工作|职业/giu], ['video', /videos?|editing|视频|剪辑/giu],
  ['nickname', /nickname|call me|address|称呼|昵称/giu],
  ['learning', /\b(?:learn(?:ing)?|english|practi[cs](?:e|ing)|speaking|pronunciation)\b|学习(?!者)|英语|口语|发音|练习/giu]
];
function tokens(value) {
  const text=String(value || '').toLowerCase();
  const result=new Set((text.match(/[a-z]{3,}|[\u3400-\u9fff]{2,}/gu)||[]).filter(word=>!STOP.has(word)));
  for(const [key,pattern] of GROUPS) { pattern.lastIndex=0; if(pattern.test(text)) result.add('@'+key); }
  return result;
}

export function isMemoryRecall(value) {
  const text=String(value||'');
  const historicalChinese=/昨天|前天|昨晚|上周|上个月|去年|那天|当时|上次|之前/u.test(text)
    &&/我|咱/u.test(text)&&/什么|怎么|怎样|哪|多少|多久|如何|谁|几点|吗|[?？]/u.test(text);
  return historicalChinese||/\b(?:remember|recall|told you|mentioned before|did I (?:tell|say|ask))\b|\b(?:what|where|when|why|how|who)\b.{0,45}\b(?:did I|did my|was my|were my|was I|were we)\b|\b(?:do you know|you know)\b.*\b(?:why I|my (?:reason|goal|preference))\b|\bwhat (?:is|was|are|were) my\b|\bwhat (?:made|makes) me\b|\bwhy (?:do|did) I (?:want|choose|learn|practi[cs]e)\b|记得|还记得|之前说|知道我为什么|我的.*(?:目标|原因|偏好)/iu.test(text);
}

export function memoryScopesForTurn({text='',explicitRecall=false}={}){
  const continuity=/\b(?:again|last time|earlier|as before)\b|上次|之前|先前|又发生|又遇到|昨天那件/iu.test(text);
  return explicitRecall||isMemoryRecall(text)||continuity?['teacher','companion','episode']:['teacher','companion'];
}

export function memoryRelevanceSignals(query, row) {
  const queryTerms=tokens(query);
  const content=`${String(row.key||'').replace(/[_.-]/g,' ')} ${row.text||''} ${(row.evidence||[]).slice(-2).map(e=>e.quote).join(' ')}`;
  const indexed=tokens(content);
  const shared=[...queryTerms].filter(term=>indexed.has(term));
  const sharedTopics=shared.filter(term=>term.startsWith('@')).length;
  const lexicalMatches=shared.length-sharedTopics;
  const asksReason=/\b(?:why|reason|motivat\w*|goals?)\b|为什么|原因|目的|目标/iu.test(query);
  const hasReason=/\b(?:because|reasons?|goals?|motivat\w*)\b|\bso (?:that|I can)\b|因为|为了|原因|目的|目标/iu.test(content);
  return {sharedTopics,lexicalMatches,reasonMatch:asksReason&&hasReason&&sharedTopics>0};
}

export function requiresRecallLead(query,sources=[]) {
  if(!isMemoryRecall(query)||/\b(?:not|never|no longer|don.t|do not|changed?|new|instead)\b|不再|不是|改了|新的/iu.test(query))return false;
  return sources.some(row=>row.kind!=='hypothesis'&&row.status!=='tentative'
    &&memoryRelevanceSignals(query,{...row,evidence:row.quote?[{quote:row.quote}]:row.evidence}).reasonMatch);
}

export function recallLeadDecision(english,{complete=false}={}) {
  const text=String(english||'').trim().replace(/[’‘]/gu,"'").replace(/^(?:honestly|actually|well)[,\s]+/iu,'');
  const first=text.match(/^[\s\S]*?[.!?](?=\s|$)/u)?.[0];
  if(/^no[,\s.!?]/iu.test(text)||complete&&/^no$/iu.test(text)
    ||/^I (?:don.t|do not|cannot|can.t) (?:know|remember|recall|think you)/iu.test(text)
    ||/^I(?:'m| am) not (?:sure|certain)/iu.test(text)
    ||/^you (?:have not|haven.t|never) (?:told|said|shared)/iu.test(text)
    ||/^you(?:'ve| have) mentioned .{0,100}\bbut not (?:this|that)/iu.test(first||text)
    ||first&&!/\b(?:because|so (?:that|you|I)|in order to)\b/iu.test(first)
      &&/\b(?:not sure|don.t know|do not know|not why|not this one|not that part)\b/iu.test(first))return 'reject';
  return first||complete&&/[A-Za-z]/u.test(text)||text.length>=180?'accept':'wait';
}
export function selectMemories(records, {query='',limit=6,now=new Date().toISOString(),allowSingleMatch=false}={}) {
  const terms=tokens(query);
  const overview=/\b(?:what|anything).*\b(?:remember|know)\b.*\bme\b|记得我|了解我/iu.test(query);
  return records.map(row=>{
    const indexed=tokens(`${row.key} ${row.text} ${(row.evidence||[]).slice(-2).map(e=>e.quote).join(' ')}`);
    const matchedTerms=[...terms].filter(term=>indexed.has(term));
    const matches=matchedTerms.length;
    const sharedGroup=matchedTerms.some(term=>term.startsWith('@'));
    const boundary=row.kind==='boundary';
    const age=Math.max(0,(Date.parse(now)-Date.parse(row.lastSeen))/86400000);
    // One ordinary word such as “school” is not enough to turn an old event
    // into the current topic. A single match is reserved for an explicit
    // request to recall something; shared topic groups remain useful signals.
    const eligible=boundary||overview||sharedGroup||matches >= (allowSingleMatch ? 1 : 2);
    return {row,eligible,score:(boundary?10000:0)+matches*100+(row.userEdited?15:0)+Math.max(0,10-age/10)};
  }).filter(item=>item.eligible).sort((a,b)=>b.score-a.score).slice(0,limit).map(item=>item.row);
}
