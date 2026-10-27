// Original diagnostic material shaped around the official IELTS three-part
// Speaking format. These are not copied past-paper questions.

const speaking = (id, section, prompt, instructionZh, targetSeconds, minimumWords, spokenText = prompt) => ({
  id,
  kind: "speaking",
  section,
  displayPrompt: prompt,
  spokenText,
  instructionZh,
  targetSeconds,
  minimumWords
});

const listening = (id, spokenText, question, expectedEvidence, answerChecks) => ({
  id,
  kind: "listening",
  section: "听力细节",
  displayPrompt: `Listening: ${question}`,
  spokenText: `${spokenText} Now answer this question: ${question}`,
  instructionZh: "只播放一次；字幕会暂时隐藏。请用英语回答两个信息点。",
  targetSeconds: 24,
  minimumWords: 4,
  expectedEvidence,
  answerChecks
});

const form = (id, tier, title, tasks) => ({
  id,
  tier,
  title,
  bandRange: [[2.5, 4], [3.5, 5], [4.5, 6], [5.5, 7.5]][tier],
  tasks
});

export const ASSESSMENT_FORMS = [
  form("foundation-routine-01", 0, "Daily routine", [
    speaking("f01-p1", "口语 Part 1", "What part of your day do you enjoy most?", "自然回答 20–30 秒，并给一个简单原因。", 25, 6),
    speaking("f01-p2", "口语 Part 2", "Describe a meal you enjoyed recently. Say where you had it, who was with you, what you ate, and why you remember it.", "准备后连续说 45–75 秒；尽量覆盖提示点。", 60, 14),
    speaking("f01-p3", "口语 Part 3", "Why do families sometimes choose to eat together?", "给出观点、原因和一个具体说明。", 45, 10),
    listening("f01-l", "Nora planned to meet her cousin at the small cafe beside the station at half past three. The cafe was closed for repairs, so they met in the station library instead, at four o'clock.", "Where did Nora finally meet her cousin, and at what time?", "She met her cousin in the station library at four o'clock.", ["station library|library in the station", "four o'?clock|4:00|four"])
  ]),
  form("foundation-place-02", 0, "Home and places", [
    speaking("f02-p1", "口语 Part 1", "Is there a quiet place near your home?", "自然回答 20–30 秒，并说明你是否常去。", 25, 6),
    speaking("f02-p2", "口语 Part 2", "Describe a place in your town that you like visiting. Say where it is, what you do there, who you go with, and why you like it.", "准备后连续说 45–75 秒；按清楚顺序描述。", 60, 14),
    speaking("f02-p3", "口语 Part 3", "What makes a public place comfortable for visitors?", "至少提出两个因素并解释其中一个。", 45, 10),
    listening("f02-l", "The community garden opens at nine each morning. On Saturday, visitors should use the east gate because workers will be repairing the main entrance. Entry is free, but the guided walk costs five pounds.", "Which gate should Saturday visitors use, and how much is the guided walk?", "They should use the east gate, and the guided walk costs five pounds.", ["east gate|eastern gate", "five pounds|£5|5 pounds"])
  ]),
  form("foundation-study-03", 0, "Study habits", [
    speaking("f03-p1", "口语 Part 1", "Do you prefer studying in the morning or in the evening?", "直接回答并解释一个原因。", 25, 6),
    speaking("f03-p2", "口语 Part 2", "Describe something useful you learned outside school. Say what it was, who helped you, how you learned it, and why it was useful.", "准备后连续说 45–75 秒；讲清学习过程。", 60, 14),
    speaking("f03-p3", "口语 Part 3", "Should children learn practical skills at school?", "表达立场，并用一个例子支持。", 45, 10),
    listening("f03-l", "Leo's computer class was moved from room twelve to room twenty-one. It still begins at six fifteen, but students are asked to arrive ten minutes early to collect a headset.", "What is the new room number, and when should students arrive?", "The new room is twenty-one, and students should arrive at six oh five.", ["room (?:twenty[- ]?one|21)|(?:twenty[- ]?one|21)", "six (?:oh )?five|6:05|ten minutes early"])
  ]),
  form("foundation-weekend-04", 0, "Weekends", [
    speaking("f04-p1", "口语 Part 1", "What do you usually do at weekends?", "自然回答 20–30 秒，并补充一个细节。", 25, 6),
    speaking("f04-p2", "口语 Part 2", "Describe a simple activity that helps you relax. Say what it is, when you do it, whether you do it alone, and how it helps you.", "准备后连续说 45–75 秒。", 60, 14),
    speaking("f04-p3", "口语 Part 3", "Why do some people find it difficult to relax?", "给出一个原因和可能的结果。", 45, 10),
    listening("f04-l", "The swimming pool usually closes at eight, but this Friday it will close at seven because of staff training. The children's class is unchanged and starts at five thirty.", "Why will the pool close early, and what time does the children's class start?", "It will close early for staff training, and the children's class starts at five thirty.", ["staff training|training for (?:the )?staff", "five thirty|5:30|half past five"])
  ]),

  form("developing-travel-05", 1, "Travel changes", [
    speaking("d05-p1", "口语 Part 1", "How do you normally travel around your city?", "自然回答 25–35 秒，解释选择这种方式的原因。", 30, 8),
    speaking("d05-p2", "口语 Part 2", "Describe a journey that did not go as planned. Say where you were going, what went wrong, what you did next, and how you felt about it.", "准备后连续说 60–90 秒；交代经过与结果。", 75, 18),
    speaking("d05-p3", "口语 Part 3", "How could cities persuade more people to use public transport?", "提出措施，解释原因，并考虑实际影响。", 55, 14),
    listening("d05-l", "Maya intended to take the bus to a job interview, but the service was cancelled because of heavy rain. She borrowed her neighbour's bicycle instead. Despite the busy roads, she reached the office ten minutes early.", "Why did Maya change her travel plan, and did she arrive late?", "The bus was cancelled because of heavy rain; she did not arrive late and was ten minutes early.", ["bus.*cancel|cancel.*bus|heavy rain", "ten minutes early|not late|wasn'?t late|did not arrive late"])
  ]),
  form("developing-learning-06", 1, "Learning preferences", [
    speaking("d06-p1", "口语 Part 1", "What helps you concentrate when you are studying?", "回答 25–35 秒，说明一个有效做法。", 30, 8),
    speaking("d06-p2", "口语 Part 2", "Describe a person who taught you something valuable. Say who the person was, what they taught you, how they taught it, and why it mattered.", "准备后连续说 60–90 秒；用细节说明影响。", 75, 18),
    speaking("d06-p3", "口语 Part 3", "Do people learn more effectively alone or with others?", "比较两种方式，再说明你的判断。", 55, 14),
    listening("d06-l", "The evening language workshop begins on the fourteenth of October, not the tenth as first advertised. Classes take place in the science building, and participants need to bring a notebook but not a laptop.", "When does the workshop begin, and what should participants bring?", "It begins on the fourteenth of October, and participants should bring a notebook.", ["fourteenth (?:of )?october|october (?:the )?fourteenth|14(?:th)? october", "notebook|note book"])
  ]),
  form("developing-technology-07", 1, "Everyday technology", [
    speaking("d07-p1", "口语 Part 1", "Which piece of technology do you use most often?", "回答 25–35 秒，说明用途和原因。", 30, 8),
    speaking("d07-p2", "口语 Part 2", "Describe a time when technology made a task easier for you. Say what the task was, what technology you used, what happened, and why it helped.", "准备后连续说 60–90 秒。", 75, 18),
    speaking("d07-p3", "口语 Part 3", "What problems can arise when people depend too much on technology?", "讨论至少一个问题，并说明可能后果。", 55, 14),
    listening("d07-l", "Customers collecting repaired phones should go to desk seven on the first floor. The shop originally promised collection on Tuesday, but a delayed delivery means the phones will be ready on Thursday afternoon.", "Where should customers collect their phones, and when will they be ready?", "They should go to desk seven on the first floor, and the phones will be ready on Thursday afternoon.", ["desk seven|desk 7|first floor", "thursday afternoon"])
  ]),
  form("developing-community-08", 1, "Community life", [
    speaking("d08-p1", "口语 Part 1", "Do you know many people in your neighbourhood?", "自然回答 25–35 秒，并补充互动方式。", 30, 8),
    speaking("d08-p2", "口语 Part 2", "Describe a local event you attended or would like to attend. Say what the event is, where it happens, who goes there, and why it interests you.", "准备后连续说 60–90 秒。", 75, 18),
    speaking("d08-p3", "口语 Part 3", "Why is a sense of community important in large cities?", "说明重要性，并给出一个现实例子。", 55, 14),
    listening("d08-l", "Volunteers will meet outside the town hall at eight forty-five on Sunday. The river clean-up starts at nine. Gloves are provided, but everyone should bring their own bottle of drinking water.", "Where and when should volunteers meet, and what must they bring?", "They should meet outside the town hall at eight forty-five and bring drinking water.", ["outside (?:the )?town hall|town hall", "eight forty[- ]?five|8:45", "water|drinking water|water bottle"])
  ]),

  form("competent-work-09", 2, "Work and motivation", [
    speaking("c09-p1", "口语 Part 1", "What kind of task gives you the greatest sense of achievement?", "回答 30–40 秒，用具体经历解释。", 35, 10),
    speaking("c09-p2", "口语 Part 2", "Describe a challenging goal you worked towards. Say what the goal was, why it was difficult, what steps you took, and what you learned from the experience.", "准备后连续说 75–105 秒；清楚组织过程与反思。", 90, 24),
    speaking("c09-p3", "口语 Part 3", "To what extent should employers be responsible for keeping their staff motivated?", "权衡个人与雇主责任，并给出有条件的结论。", 65, 18),
    listening("c09-l", "The careers talk has moved to Lecture Theatre B because the main hall's projector failed. It will begin at a quarter past two, fifteen minutes later than planned, and the networking session will still finish at four thirty.", "Why was the talk moved, and how has its starting time changed?", "It was moved because the main hall's projector failed, and it will start fifteen minutes later at two fifteen.", ["projector.*fail|failed projector|projector (?:was|is) broken", "fifteen minutes later|quarter past two|two fifteen|2:15"])
  ]),
  form("competent-environment-10", 2, "Environment and habits", [
    speaking("c10-p1", "口语 Part 1", "Have you changed any habit to reduce waste?", "回答 30–40 秒，说明改变前后。", 35, 10),
    speaking("c10-p2", "口语 Part 2", "Describe an environmental improvement you noticed in a place you know. Say what changed, who was involved, how people reacted, and why the change was useful.", "准备后连续说 75–105 秒。", 90, 24),
    speaking("c10-p3", "口语 Part 3", "Are individual choices or government policies more effective in protecting the environment?", "比较两者作用，并说明它们如何配合。", 65, 18),
    listening("c10-l", "Residents can leave small electrical items at the recycling centre from Monday to Saturday. Large appliances are accepted only on Wednesdays and must be booked online at least two days in advance. There is no charge for either service.", "When are large appliances accepted, and what must residents do first?", "Large appliances are accepted on Wednesdays, and residents must book online at least two days in advance.", ["wednesday", "book online.*two days|two days.*book online|online booking"])
  ]),
  form("competent-culture-11", 2, "Culture and change", [
    speaking("c11-p1", "口语 Part 1", "Do you enjoy learning about traditions from other places?", "回答 30–40 秒，并举一个具体例子。", 35, 10),
    speaking("c11-p2", "口语 Part 2", "Describe a tradition that has changed over time. Say what the tradition is, how it was practised before, how it is practised now, and how you feel about the change.", "准备后连续说 75–105 秒；包含比较与评价。", 90, 24),
    speaking("c11-p3", "口语 Part 3", "Can traditions remain meaningful when they are adapted for modern life?", "分析利弊并作出有依据的判断。", 65, 18),
    listening("c11-l", "The museum's evening tour focuses on local music rather than painting. It lasts ninety minutes and includes a short live performance. Places cost twelve pounds, although students who book before Friday pay nine.", "What is the tour mainly about, and how can students pay the lower price?", "It is mainly about local music, and students must book before Friday to pay nine pounds.", ["local music|music", "book before friday|before friday"])
  ]),
  form("competent-education-12", 2, "Education choices", [
    speaking("c12-p1", "口语 Part 1", "Is there a subject you would like to understand better?", "回答 30–40 秒，解释用途和学习难点。", 35, 10),
    speaking("c12-p2", "口语 Part 2", "Describe an important decision you made about learning. Say what the decision was, what alternatives you considered, who influenced you, and whether it was the right choice.", "准备后连续说 75–105 秒；展示比较和反思。", 90, 24),
    speaking("c12-p3", "口语 Part 3", "Should universities focus more on employment skills or broad academic knowledge?", "讨论两方价值，并给出平衡结论。", 65, 18),
    listening("c12-l", "Applicants for the design course must submit a portfolio by midday on the third of May. Interviews take place the following week. The reference letter is optional, but a two-hundred-word personal statement is required.", "What is the portfolio deadline, and which written document is required?", "The portfolio is due by midday on the third of May, and a two-hundred-word personal statement is required.", ["midday.*third (?:of )?may|third (?:of )?may.*midday|may (?:the )?third", "personal statement"])
  ]),

  form("proficient-media-13", 3, "Media and trust", [
    speaking("p13-p1", "口语 Part 1", "How has the way you get news changed in recent years?", "回答 35–45 秒，具体比较过去与现在。", 40, 12),
    speaking("p13-p2", "口语 Part 2", "Describe a piece of information that changed your opinion. Say what it concerned, where you encountered it, why it was convincing, and how your behaviour or thinking changed.", "准备后连续说 90–120 秒；体现转变与评价。", 105, 30),
    speaking("p13-p3", "口语 Part 3", "How should societies balance freedom of expression with the need to limit harmful misinformation?", "界定冲突、权衡风险，并提出可执行原则。", 75, 24),
    listening("p13-l", "The media seminar begins with a case study led by Professor Ahmed. The panel discussion has been brought forward to eleven twenty because one speaker must leave early. Participants should email questions by six o'clock this evening, although late questions may be taken if time allows.", "Why was the panel moved, and what is the preferred deadline for questions?", "The panel was moved because a speaker must leave early, and questions should be emailed by six o'clock this evening.", ["speaker.*leave early|leave early.*speaker", "six o'?clock.*(?:this )?evening|6(?:\.00|:00)?.*evening"])
  ]),
  form("proficient-cities-14", 3, "Cities and identity", [
    speaking("p14-p1", "口语 Part 1", "What change would most improve the area where you live?", "回答 35–45 秒，并解释影响对象。", 40, 12),
    speaking("p14-p2", "口语 Part 2", "Describe a building or public space that represents a city's identity. Say what it looks like, how people use it, what it represents, and whether it should be preserved.", "准备后连续说 90–120 秒；结合描述与论证。", 105, 30),
    speaking("p14-p3", "口语 Part 3", "Can rapid urban development strengthen a city's identity, or does it usually weaken it?", "分析不同情形并避免绝对化结论。", 75, 24),
    listening("p14-l", "The planning exhibition remains at the civic centre until the twenty-eighth, two days longer than announced. The afternoon consultation is fully booked, so additional appointments are available online on Tuesday evening. Written comments close at noon on Friday.", "How long has the exhibition been extended, and when can people attend an additional consultation?", "It has been extended by two days, and additional online consultations are available on Tuesday evening.", ["two days|2 days", "tuesday evening.*online|online.*tuesday evening"])
  ]),
  form("proficient-science-15", 3, "Science and decisions", [
    speaking("p15-p1", "口语 Part 1", "When do you find expert advice most useful?", "回答 35–45 秒，用具体决策说明。", 40, 12),
    speaking("p15-p2", "口语 Part 2", "Describe a scientific or technological development that may affect everyday decisions. Say what it is, how people might use it, what benefits it offers, and what concerns it raises.", "准备后连续说 90–120 秒；平衡机会与风险。", 105, 30),
    speaking("p15-p3", "口语 Part 3", "Who should bear responsibility when expert advice influences a public decision that later proves harmful?", "区分责任主体、条件和证据标准。", 75, 24),
    listening("p15-l", "The research briefing will present preliminary findings, not the final report. Journalists may quote the lead researcher, but the graphs remain confidential until Monday. A revised data table will be distributed after the session because two figures were corrected this morning.", "Which material must remain confidential, and why will a revised table be issued?", "The graphs must remain confidential until Monday, and a revised table will be issued because two figures were corrected.", ["graphs?.*confidential|confidential.*graphs?", "two figures.*correct|corrected.*two figures"])
  ]),
  form("proficient-workfuture-16", 3, "Future of work", [
    speaking("p16-p1", "口语 Part 1", "What makes a working environment productive for you?", "回答 35–45 秒，区分环境与个人习惯。", 40, 12),
    speaking("p16-p2", "口语 Part 2", "Describe a change in working life that you think will become common. Say what the change is, what is driving it, who may benefit, and what difficulties it could create.", "准备后连续说 90–120 秒；包含预测依据。", 105, 30),
    speaking("p16-p3", "口语 Part 3", "If technology makes some occupations unnecessary, what obligations do governments and employers have to affected workers?", "权衡经济效率、公平与可行性。", 75, 24),
    listening("p16-l", "The remote-work trial covers the customer support team but excludes new employees during their first month. Staff may work from home on two days each week, provided that one of those days is Friday. The trial will be reviewed after twelve weeks rather than the originally planned eight.", "Who is excluded from the trial, and how has the review period changed?", "New employees in their first month are excluded, and the review has moved from eight weeks to twelve weeks.", ["new employees?.*(?:first|1st) month|first month.*new employees?", "eight.*twelve weeks|8.*12 weeks|twelve rather than eight"])
  ])
];

export const ASSESSMENT_TASKS = ASSESSMENT_FORMS.flatMap(item => item.tasks);

const clampTier = value => Math.max(0, Math.min(3, Number(value) || 0));

export function assessmentTaskById(taskId) {
  return ASSESSMENT_TASKS.find(task => task.id === taskId) || null;
}

function baseTierForBand(band) {
  if (band == null || !Number.isFinite(Number(band))) return 1;
  if (band < 3.5) return 0;
  if (band < 4.75) return 1;
  if (band < 5.75) return 2;
  return 3;
}

export function recommendedAssessmentTier(profile) {
  const history = Array.isArray(profile.assessmentHistory) ? profile.assessmentHistory : [];
  const base = baseTierForBand(profile.stableBand);
  if (history.length < 2) return base;
  const recent = history.slice(-2).filter(item => Number.isFinite(Number(item.observedBand)));
  if (recent.length < 2) return base;
  const currentRange = [[2.5, 4], [3.5, 5], [4.5, 6], [5.5, 7.5]][base];
  if (recent.every(item => item.observedBand >= currentRange[1] - 0.25)) return clampTier(base + 1);
  if (recent.every(item => item.observedBand <= currentRange[0] + 0.25)) return clampTier(base - 1);
  return base;
}

export function selectAssessmentForm(profile, random = Math.random) {
  const tier = recommendedAssessmentTier(profile);
  const seen = new Set((profile.assessmentHistory || []).slice(-12).map(item => item.formId).filter(Boolean));
  const tierForms = ASSESSMENT_FORMS.filter(item => item.tier === tier);
  const unseen = tierForms.filter(item => !seen.has(item.id));
  const candidates = unseen.length ? unseen : tierForms;
  const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * candidates.length));
  return candidates[index];
}
