// Coordinates stay in the character's source space. Text never controls bones.
export const GESTURES = ['wave', 'explain', 'think', 'comfort', 'encourage', 'celebrate', 'listen'];
export const GESTURE_LABELS = { wave: '抬手问候', explain: '摊手讲解', think: '思考示意', comfort: '手抚胸前', encourage: '鼓励回应', celebrate: '开心招手', listen: '倾身倾听' };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x, 0, 1); return x*x*(3-2*x); };
const REST = [18, 14, -12, 18, 14, 12];
// For each side: upper arm angle, absolute forearm angle, wrist angle.
const POSES = {
  wave: [25, 166, -8, 18, 14, 12],
  explain: [18, 14, -12, 34, 114, 20],
  think: [18, 14, -12, 8, -135, -20],
  comfort: [18, 14, -12, 10, -134, -30],
  encourage: [30, 155, -8, 18, 14, 12],
  celebrate: [36, 158, -8, 18, 14, 12],
  listen: [13, 18, -10, 13, 18, 10]
};
export function createGestureDirector() {
  let time = 0, active = null, pending = null, lastCue = null, lastPreview = null;
  let greeted = false, wasSpeaking = false, thinkingSince = null, lastActivity = 0;
  let joints = [...REST], kind = 'idle', phase = 'idle', enabled = true;
  let lastSemantic = -100, serial = 0;
  function request(name, priority = 1, intensity = .65) {
    if (!GESTURES.includes(name) || !enabled) return;
    if (active) {
      if (priority < active.priority) return;
      pending = { name, priority, intensity };
      if (!active.releaseAt) active.releaseAt = time;
    } else {
      active = { name, priority, intensity, start: time, releaseAt: null, serial: ++serial };
      kind = name;
    }
  }
  function step(dt, state = {}) {
    const isEnabled = state.motion !== false && state.visible !== false && !state.reducedMotion;
    enabled = isEnabled;
    if (!isEnabled) { active = null; pending = null; kind = 'idle'; phase = 'paused'; }
    time += Math.min(.05, Math.max(0, dt));
    if (isEnabled) {
      const expression = state.expression || {};
      if (state.previewId != null && state.previewId !== lastPreview) {
        lastPreview = state.previewId;
        request(state.previewGesture, 4, .75);
      }
      if (state.cueId != null && state.cueId !== lastCue) {
        lastCue = state.cueId;
        const mapping = { empathy: 'comfort', encouraging: 'encourage', celebrating: 'celebrate', curious: 'explain' };
        if (mapping[expression.kind]) { request(mapping[expression.kind], 3, expression.intensity); lastSemantic = time; }
      }
      if (state.speaking && !wasSpeaking) {
        if (!greeted && state.greeting && time-lastSemantic > 2) { greeted = true; request('wave', 1); }
        else if (time-lastSemantic > 6 && time-lastActivity > 7) request('explain', 1, .55);
        lastActivity = time;
      }
      if (state.recording) {
        thinkingSince = null;
        if (time-lastActivity > 9 && !active) { request('listen', 1); lastActivity = time; }
      } else if (state.performance === 'thinking') {
        thinkingSince ??= time;
        if (time-thinkingSince > 1.8 && time-lastActivity > 7 && !active) {
          request('think', 1, .5); lastActivity = time;
        }
      } else thinkingSince = null;
      // Quiet attention, not repeated waving or celebrating while the user thinks.
      if (!state.speaking && !state.recording && !active && time-lastActivity > 24) {
        request('listen', 0, .4); lastActivity = time;
      }
    }
    wasSpeaking = Boolean(state.speaking);
    let weight = 0;
    if (active) {
      const age = time-active.start;
      if (age > 4.4 && !active.releaseAt) active.releaseAt = time;
      weight = ease(age/.85) * (active.releaseAt ? 1-ease((time-active.releaseAt)/.85) : 1);
      phase = active.releaseAt ? 'settle' : age < .85 ? 'prepare' : age < 2.5 ? 'perform' : 'hold';
      if (active.releaseAt && time-active.releaseAt >= .85 && joints.every((v,i)=>Math.abs(v-REST[i])<2)) {
        active = null; kind = 'idle'; phase = 'idle'; lastActivity = time;
        const next = pending; pending = null;
        if (next) request(next.name, next.priority, next.intensity);
        weight = 0;
      }
    }
    const pose = POSES[active?.name] || REST;
    for (let i=0;isEnabled && i<joints.length;i++) {
      let target = REST[i]+(pose[i]-REST[i])*weight;
      if (active?.name === 'wave' && i===2 && phase !== 'prepare') target += Math.sin((time-active.start)*6)*14*weight;
      if (active?.name === 'celebrate' && (i===0 || i===3)) target += Math.sin((time-active.start)*4)*3*weight;
      const step = (target-joints[i]) * (1-Math.exp(-dt/.16));
      joints[i] += clamp(step, -110*dt, 110*dt);
    }
    // One anatomically reviewed hand, no instantaneous finger-pose swaps.
    const hand = 'open';
    return { name: kind, phase, serial: active?.serial || serial, weight, joints: [...joints],
      hand: weight>.12 ? hand : 'open', lean: active?.name === 'listen' ? weight : 0,
      headTilt: active?.name === 'comfort' ? 1.3*weight : active?.name === 'listen' ? -1.2*weight : 0 };
  }
  return { step, request, snapshot: () => ({ name: kind, phase, joints: [...joints], serial }) };
}
