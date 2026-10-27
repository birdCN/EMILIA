// A long lesson finishes with a connected performance, not just isolated items.
export function integrationStatus(base, direction, turns = [], now = Date.now()) {
  if (direction.pacingVersion === 1 && base.contentComplete) {
    const events = turns.map(turn => turn.integration).filter(Boolean);
    const finalDone = events.some(event => event.kind === 'evaluation' && event.pacingPhase === 'final');
    const pending = events.at(-1)?.kind === 'request' ? events.at(-1) : null;
    const elapsed = Math.max(0, (now - Date.parse(direction.startedAt)) / 1000);
    const reviews = events.filter(event => event.kind === 'evaluation' && event.pacingPhase === 'review').length;
    const minimumReviews = direction.durationSeconds >= 3600 ? 4 : 2;
    const pacingPhase = pending?.pacingPhase || (elapsed < direction.durationSeconds * 2 / 3
      ? 'application' : reviews < minimumReviews || elapsed < direction.durationSeconds - 120 ? 'review' : 'final');
    const candidates = [...(direction.pedagogyPlan?.reviewTargets || []), ...turns.map(t => t.pedagogy)
      .filter(p => p?.targetKey && p?.targetEn)];
    const targets = [...new Map(candidates.map(p => [p.id || p.targetKey, p])).values()];
    return { ...base, contentComplete: finalDone, phase: finalDone ? 'post_lesson_chat' : 'integrated_transfer',
      integrationStep: finalDone ? 'complete' : pending ? 'evaluate' : 'request', pacingPhase,
      completedReviews: reviews, minimumReviews, round: events.filter(e => e.kind === 'evaluation').length,
      reviewTarget: pending?.reviewTarget || targets[reviews % Math.max(1, targets.length)] || null,
      reviewTargets: direction.pedagogyPlan?.reviewTargets || [],
      coreTopic: direction.coreTopic,
      practisedTargets: [...new Set(turns.map(t => t.pedagogy?.targetEn).filter(Boolean))].slice(0, 8) };
  }
  if (!base.contentComplete || direction.durationSeconds < 3600) return base;
  const requested = turns.some(turn => turn.integration?.kind === 'request');
  const evaluated = turns.some(turn => turn.integration?.kind === 'evaluation');
  return { ...base, contentComplete: evaluated, phase: evaluated ? 'post_lesson_chat' : 'integrated_transfer',
    integrationStep: evaluated ? 'complete' : requested ? 'evaluate' : 'request' };
}
export function integrationControl(status) {
  if (status?.phase !== 'integrated_transfer') return '';
  if (status.pacingPhase) {
    const context = `Central task: ${status.coreTopic}. Practised targets: ${JSON.stringify(status.practisedTargets)}. Review candidates: ${JSON.stringify(status.reviewTargets)}.`;
    if (status.pacingPhase === 'review' && status.reviewTarget) {
      const target = status.reviewTarget;
      return `${context} CONSOLIDATION REVIEW ${status.completedReviews + 1}: target ${JSON.stringify(target)}. ${status.integrationStep === 'request'
        ? 'Briefly explain that we are consolidating learning, then ask one new contextual recall task WITHOUT showing the answer. Use action prompt_retrieval.'
        : 'Evaluate the latest answer honestly; praise independent recall specifically, or patiently explain and model the correction if forgotten. Use action evaluate_retrieval with the actual outcome. Do not set another task yet.'} Keep targetKey ${JSON.stringify(target.id || target.targetKey)} and targetEn ${JSON.stringify(target.targetEn)}. Do not announce completion. Same-day recall is practice, not proof of durable mastery.`;
    }
    if (status.integrationStep === 'evaluate') return `${context} REQUIRED: evaluate the learner's answer to the task just requested. Answer clarification and support an actual attempt; agreement alone is not an attempt. Give specific feedback and one usable improvement, without another question or task yet. Use action none. ${status.pacingPhase === 'final' ? 'After a substantive attempt, explicitly announce planned learning is complete and offer archiving or optional chat. Do not announce completion for assent or clarification.' : 'The lesson continues; do not announce completion or drift into small talk.'}`;
    const tasks = status.pacingPhase === 'application'
      ? ['retell the central event with clearer detail', 'adapt the message for a different listener', 'compare two options and justify the choice', 'repair and retell one weak part']
      : ['retrieve an older expression without showing the answer', 'apply a previously difficult pattern in a different situation', 'contrast two meanings in a short explanation', 'retell a past answer with one specific improvement'];
    return `${context} REQUIRED ${status.pacingPhase.toUpperCase()} TASK: ${status.pacingPhase === 'final' ? 'Invite a connected 1–2 minute answer combining the skills in a fresh situation.' : tasks[status.round % tasks.length]}. ${status.pacingPhase === 'review' ? 'Prioritize older review candidates; if none exist, revisit today’s targets without calling this delayed recall. Tell the learner briefly that this is consolidation, not casual chat.' : ''} Respond to meaning first, then set one concrete task tied to an actual target and a new situation. Do not supply the answer. Adapt length to ability; do not invent more vocabulary to fill time or repeat an already answered question. Use action none. Do not announce completion; the learner can still choose to archive at any time.`;
  }
  return status.integrationStep === 'request'
    ? 'LONG-LESSON FINAL TASK: the individual learning cycles are complete, but the lesson is not finished. Invite a connected 1–2 minute learner answer in a fresh situation related to the central task, integrating today’s skills. Give a purpose and listener, not model sentences or target answers. Use action none. Do not announce completion yet.'
    : 'LONG-LESSON FINAL EVALUATION: evaluate the learner’s response to the final integrated task. If they only agree, ask for clarification, or give no substantive attempt, help them attempt it; do not claim completion. Otherwise give specific evidence of what worked and one next step, then say the planned learning is complete and archiving or optional chat is available. Use action none; an attempt is not proof of mastery.';
}
export function integrationEvidence(status, learnerText, observation, metadataAvailable) {
  if (status?.phase !== 'integrated_transfer' || !metadataAvailable) return null;
  if (status.integrationStep === 'request') return { kind:'request', ...(status.pacingPhase ? {pacingPhase:status.pacingPhase, reviewTarget:status.reviewTarget} : {}) };
  const words = String(learnerText).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  // This threshold only rejects assent such as "yes, sure", never assigns a score.
  if (words.length < 12 || observation?.evidenceQuality === 'low'
    || !['strength','weakness'].includes(observation?.signal)) return null;
  return {kind:'evaluation', ...(status.pacingPhase ? {pacingPhase:status.pacingPhase} : {})};
}
