// The model chooses a conversational intent, never arbitrary rig coordinates.
export const EXPRESSION_KINDS = ["neutral", "curious", "empathy", "encouraging", "celebrating"];
export const expressionSchema = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: EXPRESSION_KINDS },
    intensity: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["kind", "intensity"]
};
export function normalizeExpression(value) {
  const kind = EXPRESSION_KINDS.includes(value?.kind) ? value.kind : "neutral";
  const number = Number(value?.intensity);
  return { kind, intensity: kind === "neutral" ? 0 : Math.max(.35, Math.min(.9, Number.isFinite(number) ? number : .6)) };
}
export function inferExpression({ learnerText = '', teacherText = '', act = '' } = {}) {
  const text = `${learnerText} ${teacherText}`.toLowerCase();
  const distress = /\b(?:sad|upset|worried|anxious|afraid|exhausted|overwhelmed|lonely|hurt|failed?|did not pass|didn't pass)\b|难过|焦虑|担心|害怕|累|失败/u;
  const achievement = /\b(?:finally|passed|succeeded|finished|completed|won|got it|managed to|proud of)\b|终于|通过|成功|完成|做到了/u;
  const effort = /\b(?:i(?:'ll| will) try|try again|keep trying|practised?|working on it|not sure|maybe i can)\b|再试|努力|练习|不确定/u;
  if (act === 'empathize' || distress.test(text)) return { kind: 'empathy', intensity: .62 };
  if (achievement.test(text)) return { kind: 'celebrating', intensity: .72 };
  if (effort.test(text)) return { kind: 'encouraging', intensity: .58 };
  if (['follow_up', 'deepen', 'bridge', 'personal_question', 'intimate_question'].includes(act)) {
    return { kind: 'curious', intensity: .5 };
  }
  return { kind: 'neutral', intensity: 0 };
}
export const EXPRESSION_GUIDANCE = [
  "The ONLY valid expression.kind values are neutral, curious, empathy, encouraging, celebrating. Warm/playful/shy are tones, not valid animation IDs; use neutral for gentle affection unless another supported intent actually fits.",
  "In expression, choose your visible reaction from the MEANING of the current exchange, not isolated keywords.",
  "Use empathy for distress, disappointment or fatigue; encouraging for effort, uncertainty or a supported improvement; celebrating for an explicitly positive event or achievement; curious for genuine interest or a relevant invitation to elaborate; neutral otherwise.",
  "Choose the response to the learner's emotional focus BEFORE considering the follow-up question: comforting a learner who failed is empathy even when en ends with a question, not curious or neutral. Supporting 'I will try again even though it is difficult' is encouraging. A joyful achievement is celebrating. Routine factual exchanges may be neutral.",
  "Respect negation, irony and whose experience is described. 'I did not pass' is not an achievement. Do not celebrate distress, invent progress, or use curiosity for every question.",
  "Intensity is normally 0.45 to 0.7; reserve stronger reactions for clear evidence. The expression is your teaching response, not a diagnosis of the learner's emotions.",
  "Produce expression in this same response; never mention it aloud."
].join(" ");
