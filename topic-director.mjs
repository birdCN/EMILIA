// Topic breadth is operational teaching metadata, not autobiographical memory.
// It keeps one familiar interest from taking over every lesson while allowing
// relevant callbacks and natural, nearby transitions.
const TOPICS = [
  {
    id: 'daily_life', labelZh: '日常生活',
    patterns: [/daily|routine|morning|evening|weekend|yesterday|housework|sleep/i, /日常|早上|晚上|周末|昨天|家务|睡眠/],
    title: '讲述最近一个普通但具体的日常片段',
    openingQuestion: 'What is one ordinary moment from the past week that you remember clearly?',
    followUps: ['When did it happen?', 'What made that moment stand out?', 'Would you do anything differently next time?'],
    establish: '选取上周一个真实的日常片段并交代时间地点',
    develop: '补充发生过程、感受和一个具体细节',
    transfer: '换一个日常场景，用同样能力重新表达',
    phrases: ['one thing that stood out was', 'what happened next was']
  },
  {
    id: 'food', labelZh: '饮食与餐馆',
    patterns: [/food|meal|dish|eat|ate|cook|restaurant|breakfast|lunch|dinner|taste/i, /吃|饭|菜|做饭|餐馆|早餐|午餐|晚餐|味道/],
    title: '描述最近吃过的一顿饭及其体验',
    openingQuestion: 'What is one meal you ate recently that you can still remember well?',
    followUps: ['What was in the meal?', 'Who were you with, if anyone?', 'What made it enjoyable or disappointing?'],
    establish: '说明最近一顿真实的饭以及时间和场合',
    develop: '描述食物、同伴和喜欢或不喜欢的原因',
    transfer: '比较另一顿饭或向朋友提出餐饮建议',
    phrases: ['what I liked most was', 'it tasted']
  },
  {
    id: 'travel_places', labelZh: '国家、城市与旅行',
    patterns: [/travel|trip|country|city|place|visit|visited|hometown|abroad|journey|tourist/i, /旅行|国家|城市|地方|参观|家乡|国外|旅程|游客/],
    title: '介绍一个喜欢或想深入了解的国家与地点',
    openingQuestion: 'Which country or city would you genuinely like to know better?',
    followUps: ['What attracts you to it?', 'What would you do there first?', 'How might daily life there differ from yours?'],
    establish: '选择一个真实感兴趣的国家或城市并说明第一印象',
    develop: '说明吸引自己的特点、想做的事情及原因',
    transfer: '把这个地点与自己熟悉的地方作简短比较',
    phrases: ['what attracts me most is', 'compared with']
  },
  {
    id: 'people', labelZh: '人物与关系',
    patterns: [/friend|family|person|people|teacher|colleague|classmate|neighbou?r|parent/i, /朋友|家人|人物|老师|同事|同学|邻居|父母/],
    title: '介绍一个给自己留下深刻印象的人',
    openingQuestion: 'Who is someone you know who has left a strong impression on you?',
    followUps: ['How did you meet this person?', 'What quality do you notice most?', 'Can you remember a moment that shows that quality?'],
    establish: '选择一位真实认识的人并说明关系',
    develop: '用一件具体小事呈现这个人的特点',
    transfer: '比较两个人的不同特点或影响',
    phrases: ['what I admire about them is', 'a good example of this is']
  },
  {
    id: 'study_work', labelZh: '学习与工作',
    patterns: [/study|school|college|university|class|course|learn|job|work|office|career/i, /学习|学校|大学|课堂|课程|工作|办公室|职业/],
    title: '说明最近一次学习或工作上的真实挑战',
    openingQuestion: 'What is one challenge you have faced recently in your studies or work?',
    followUps: ['Why was it difficult?', 'What did you try?', 'What would help you handle it better next time?'],
    establish: '说明一次近期学习或工作挑战',
    develop: '解释困难、采取的办法和结果',
    transfer: '为相似处境中的另一个人提出建议',
    phrases: ['the main difficulty was', 'I dealt with it by']
  },
  {
    id: 'hobbies', labelZh: '兴趣与休闲',
    patterns: [/hobby|game|gaming|rpg|sport|music|read|reading|photograph|free time|leisure/i, /兴趣|爱好|游戏|运动|音乐|阅读|摄影|空闲/],
    title: '解释一项兴趣为什么值得长期保持',
    openingQuestion: 'What is one activity you genuinely enjoy in your free time?',
    followUps: ['How did you become interested in it?', 'What part keeps you engaged?', 'How has your experience of it changed?'],
    establish: '选择一项真实兴趣并说明开始原因',
    develop: '解释持续投入的原因和一次具体体验',
    transfer: '向没接触过这项兴趣的人介绍它',
    phrases: ['what keeps me interested is', 'I first got into it when']
  },
  {
    id: 'culture_media', labelZh: '文化与媒体',
    patterns: [/film|movie|series|book|story|anime|art|museum|festival|culture|media/i, /电影|影视|书|故事|动漫|艺术|博物馆|节日|文化|媒体/],
    title: '谈论一部作品或一次文化体验带来的想法',
    openingQuestion: 'What is a film, book, story, or cultural experience that made you think?',
    followUps: ['What was it mainly about?', 'Which part stayed with you?', 'Did it change your view of anything?'],
    establish: '选择一部作品或一次文化体验并概括内容',
    develop: '说明印象最深的部分及其原因',
    transfer: '向不同偏好的人判断是否值得推荐',
    phrases: ['what stayed with me was', 'it made me think about']
  },
  {
    id: 'health_wellbeing', labelZh: '健康与生活状态',
    patterns: [/health|healthy|exercise|walk|running|rest|relax|stress|tired|energy/i, /健康|锻炼|散步|跑步|休息|放松|压力|疲惫|精力/],
    title: '讨论一种能改善生活状态的小习惯',
    openingQuestion: 'What is one small habit that helps—or could help—you feel better during the week?',
    followUps: ['When is it easiest to do?', 'What usually gets in the way?', 'What realistic change could make it easier?'],
    establish: '选择一个真实习惯并说明目前情况',
    develop: '解释作用、障碍和可行调整',
    transfer: '为另一个生活节奏不同的人调整建议',
    phrases: ['what helps me most is', 'the main obstacle is']
  },
  {
    id: 'city_services', labelZh: '城市、交通与服务',
    patterns: [/transport|traffic|bus|train|subway|shop|shopping|service|library|park|neighborhood|city centre/i, /交通|公交|火车|地铁|购物|商店|服务|图书馆|公园|社区|市中心/],
    title: '评价一个自己经常使用的城市场所或服务',
    openingQuestion: 'What is one place or public service in your area that you use or notice often?',
    followUps: ['What is it useful for?', 'What works well there?', 'What is one realistic improvement you would make?'],
    establish: '选择一个熟悉的公共场所或服务并说明用途',
    develop: '评价优点、问题和一次真实经历',
    transfer: '向访客介绍或提出一项改进建议',
    phrases: ['one thing it does well is', 'it could be improved by']
  },
  {
    id: 'nature_environment', labelZh: '自然与环境',
    patterns: [/nature|environment|weather|river|mountain|animal|pollution|recycle|climate|green space/i, /自然|环境|天气|河流|山|动物|污染|回收|气候|绿地/],
    title: '描述一个自然环境并讨论如何改善它',
    openingQuestion: 'What natural place or environmental issue do you notice in your daily life?',
    followUps: ['What is it like now?', 'Why does it matter to people nearby?', 'What small improvement would be realistic?'],
    establish: '选择一个熟悉的自然地点或环境现象',
    develop: '描述现状、影响和具体例子',
    transfer: '比较另一地点或提出可行改善办法',
    phrases: ['one noticeable change is', 'a practical solution would be']
  },
  {
    id: 'technology', labelZh: '科技与工具',
    patterns: [/technology|computer|phone|software|internet|online|digital|ai|model|video|coding|codex|workflow/i, /科技|电脑|手机|软件|网络|数字|模型|视频|编程|工作流/],
    title: '评价一种科技工具对日常生活的真实影响',
    openingQuestion: 'What is one piece of technology that has genuinely changed how you do something?',
    followUps: ['What did you do before using it?', 'What became easier or harder?', 'Do you depend on it too much?'],
    establish: '选择一种真实使用的科技工具并说明用途',
    develop: '比较使用前后以及优点和限制',
    transfer: '判断它是否适合另一类使用者',
    phrases: ['it has changed the way I', 'the main drawback is']
  },
  {
    id: 'future_choices', labelZh: '选择、变化与未来',
    patterns: [/future|plan|choice|choose|decision|change|hope|expect|goal/i, /未来|计划|选择|决定|改变|希望|目标/],
    title: '解释一个未来选择以及可能带来的变化',
    openingQuestion: 'What is one realistic choice you may need to make in the near future?',
    followUps: ['What options do you have?', 'What matters most in the decision?', 'What might happen after you choose?'],
    establish: '选择一个真实或合理的近期决定',
    develop: '比较选项、标准和可能结果',
    transfer: '面对条件变化时重新作出选择',
    phrases: ['what matters most is', 'if I had to choose']
  }
];

const BY_ID = new Map(TOPICS.map(topic => [topic.id, topic]));
const NEIGHBORS = {
  daily_life: ['food', 'people', 'health_wellbeing', 'city_services'],
  food: ['daily_life', 'travel_places', 'culture_media', 'health_wellbeing'],
  travel_places: ['culture_media', 'food', 'city_services', 'nature_environment'],
  people: ['daily_life', 'study_work', 'hobbies', 'future_choices'],
  study_work: ['people', 'daily_life', 'technology', 'future_choices'],
  hobbies: ['people', 'culture_media', 'health_wellbeing', 'travel_places'],
  culture_media: ['hobbies', 'travel_places', 'people', 'future_choices'],
  health_wellbeing: ['daily_life', 'food', 'nature_environment', 'city_services'],
  city_services: ['daily_life', 'travel_places', 'nature_environment', 'study_work'],
  nature_environment: ['travel_places', 'health_wellbeing', 'city_services', 'future_choices'],
  technology: ['study_work', 'daily_life', 'people', 'future_choices'],
  future_choices: ['study_work', 'people', 'technology', 'travel_places']
};

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

export function topicById(id) {
  return BY_ID.get(id) || null;
}

export function detectTopicDomain(value) {
  const text = clean(value);
  if (!text) return null;
  let best = null;
  for (const topic of TOPICS) {
    const score = topic.patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
    if (score > (best?.score || 0)) best = { id: topic.id, score };
  }
  return best?.id || null;
}

export function topicMatches(value, id) {
  const topic = topicById(id);
  return Boolean(topic && topic.patterns.some(pattern => pattern.test(clean(value))));
}

function numericSeed(value) {
  let seed = 0;
  for (const char of String(value)) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return seed;
}

export function planLessonTopic(profile, now = new Date().toISOString(), memoryRecords = []) {
  const summaries = Array.isArray(profile?.sessionSummaries) ? profile.sessionSummaries.slice(-12) : [];
  const history = summaries.map(summary => summary.topicDomain || detectTopicDomain((summary.focus || []).join(' ')))
    .filter(Boolean);
  const recentDomains = history.slice(-2);
  const counts = Object.fromEntries(TOPICS.map(topic => [topic.id, history.filter(id => id === topic.id).length]));
  const memoryDomains = (memoryRecords || []).map(record => detectTopicDomain(`${record.key || ''} ${record.text || ''}`))
    .filter(Boolean);
  const memoryCounts = Object.fromEntries(TOPICS.map(topic =>
    [topic.id, memoryDomains.filter(id => id === topic.id).length]));
  const offset = numericSeed(`${String(now).slice(0, 10)}:${summaries.length}`) % TOPICS.length;
  const ranked = TOPICS.map((topic, index) => ({ topic, index,
    score: counts[topic.id] * 10 + Math.min(8, memoryCounts[topic.id] * 2)
      + (recentDomains.includes(topic.id) ? 100 : 0)
      + ((index - offset + TOPICS.length) % TOPICS.length) / TOPICS.length
  })).sort((left, right) => left.score - right.score);
  const selected = ranked[0].topic;
  const recentLabels = [...new Set(recentDomains.map(id => topicById(id)?.labelZh).filter(Boolean))];
  return {
    ...selected,
    recentDomains,
    memoryHeavyDomains: Object.entries(memoryCounts).filter(([, count]) => count > 0).map(([id]) => id),
    recentTitles: summaries.slice(-3).map(summary => (summary.focus || [])[0]).filter(Boolean),
    avoidAsMain: [...new Set(recentDomains)],
    reasonZh: recentLabels.length
      ? `避开最近主话题 ${recentLabels.join('、')}，用新语境检验迁移。`
      : '建立新的雅思口语话题覆盖。'
  };
}

export function adjacentTopic(currentId, visited = [], seed = 0) {
  const candidates = (NEIGHBORS[currentId] || TOPICS.map(topic => topic.id))
    .filter(id => id !== currentId);
  const recent = new Set((visited || []).slice(-4));
  const fresh = candidates.filter(id => !recent.has(id));
  const pool = fresh.length ? fresh : candidates;
  return topicById(pool[Math.abs(Number(seed) || 0) % Math.max(1, pool.length)]) || null;
}

export function topicCatalog() {
  return TOPICS.map(({ id, labelZh }) => ({ id, labelZh }));
}
