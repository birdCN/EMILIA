export const teachingFeedbackSchema = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["correction", "upgrade", "ok", "uncertain"] },
    // Schema limits are deliberately wider than the UI limits below. Some
    // providers produce a valid but verbose field; validate it, then trim it,
    // instead of rejecting the entire translation/feedback payload.
    original: { type: "string", maxLength: 300 },
    revised: { type: "string", maxLength: 360 },
    reasonZh: { type: "string", maxLength: 240 }
  },
  required: ["status", "original", "revised", "reasonZh"]
};
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const comparable = value => clean(value).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
export function normalizeTeachingFeedback(value, learnerText) {
  const unavailable = { status: "uncertain", original: "", revised: "", reasonZh: "本轮未得到可靠的修改建议，不把它当作“没有错误”。" };
  if (!value || !["correction", "upgrade", "ok", "uncertain"].includes(value.status)) return unavailable;
  const feedback = { status: value.status, original: clean(value.original).slice(0, 140), revised: clean(value.revised).slice(0, 170), reasonZh: clean(value.reasonZh).slice(0, 160) };
  if (["correction", "upgrade"].includes(feedback.status)) {
    if (!feedback.original || !feedback.revised || !feedback.reasonZh
      || !comparable(learnerText).includes(comparable(feedback.original))
      || comparable(feedback.original) === comparable(feedback.revised)) return unavailable;
  } else {
    feedback.original = ""; feedback.revised = "";
    feedback.reasonZh ||= feedback.status === "ok" ? "这句话表达清楚，没有发现明显需要修改的地方。" : unavailable.reasonZh;
  }
  return feedback;
}
export function feedbackNote(feedback) {
  const labels = { correction: "建议修改", upgrade: "更自然的说法（原句也可用）", ok: "表达检查", uncertain: "暂不能确定" };
  return `${labels[feedback.status]}：${feedback.original ? `“${feedback.original}” → “${feedback.revised}”。` : ""}${feedback.reasonZh}`;
}
export const TEACHING_FEEDBACK_GUIDANCE = [
  "Preserve affectionate or playful intent. Pet names such as 'baby' are not grammatical errors; never remove flirting just to make the learner sound formal. Explain register only when actually relevant, not as a moral correction.",
  "In EVERY conversation mode, including casual, quietly check the learner's latest English in feedback; never omit this written check.",
  "Keep en focused on the real conversation; do not read feedback aloud unless the learner asks. Feedback must address the LEARNER's words, not your own reply.",
  "Use correction for a clear grammar/word-choice error; quote one exact contiguous original excerpt and give its corrected replacement, preserving the learner's intended meaning, plus a brief Chinese reason.",
  "Use upgrade for an optional more natural phrasing and clearly say the original is acceptable. Use ok when the text is natural and there is no useful change; never invent an error to fill the panel. Conversational fragments such as 'Pretty good actually' can be natural.",
  "Use uncertain for ambiguous transcription or insufficient English rather than guessing the learner's meaning. For ok/uncertain, original and revised are empty; reasonZh must still be nonempty.",
  "Check written language only: never infer pronunciation or an IELTS score from this single transcript. During distress, respond with empathy in en and keep the separate written feedback tactful."
].join(" ");
