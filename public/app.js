import { normalizeExpression } from "/avatar-director.js";
import { createActivityIndicator, createActivityFetch } from "/ui-activity.js";
import { readChatResponse } from "/chat-stream.js?v=50-latency-1";
import { normalizeTeachingFeedback } from "/teaching-feedback.js?v=31";
import { GREETING_TEXT, GREETING_VOICE_URL } from "/voice-config.js";
import { SpeechEnvelope } from "/speech-envelope.js?v=1";
import { attachVoicePlaylist } from '/voice-playlist.js?v=50-latency-1';
import { initModelSettings } from '/model-settings-ui.js?v=49-model-picker-1';
import { initMemoryUI } from '/memory-ui.js?v=52';
import { initVocabularyHelper } from '/vocabulary-helper.js?v=49';
import { LESSON_DURATIONS, lessonTiming } from '/lesson-policy.js?v=41';
import {acquireChatSession} from '/chat-session.js';
import {UI_REVISION} from '/build-version.js';
const $ = selector => document.querySelector(selector);

const elements = {
  avatarStage: $("#avatarStage"),
  avatarRig: $("#avatarRig"),
  live2dFrame: $("#live2dFrame"),
  stateBadge: $("#stateBadge"),
  subtitleCard: $("#subtitleCard"),
  subtitleEn: $("#subtitleEn"),
  subtitleZh: $("#subtitleZh"),
  subtitleToggle: $("#subtitleToggle"),
  translationToggle: $("#translationToggle"),
  motionToggle: $("#motionToggle"),
  themeToggle: $("#themeToggle"),
  chat: $("#chat"),
  quickReplies: $("#quickReplies"),
  micButton: $("#micButton"),
  discardSpeechButton: $("#discardSpeechButton"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
  sessionTitle: $("#sessionTitle"),
  lessonClock: $("#lessonClock"),
  lessonCoreTitle: $("#lessonCoreTitle"),
  lessonElapsed: $("#lessonElapsed"),
  lessonRemaining: $("#lessonRemaining"),
  lessonClockFinish: $("#lessonClockFinish"),
  sessionMode: $("#sessionMode"),
  progressWarmup: $("#progressWarmup"),
  progressAssessment: $("#progressAssessment"),
  progressPractice: $("#progressPractice"),
  bandScore: $("#bandScore"),
  bandRange: $("#bandRange"),
  bandTarget: $("#bandTarget"),
  assessmentButton: $("#assessmentButton"),
  assessmentReportButton: $("#assessmentReportButton"),
  resetProfileButton: $("#resetProfileButton"),
  assessmentStatus: $("#assessmentStatus"),
  lessonDuration: $("#lessonDuration"),
  lessonPlan: $("#lessonPlan"),
  lessonSource: $("#lessonSource"),
  codexStatus: $("#codexStatus"),
  codexLessonButton: $("#codexLessonButton"),
  startLesson: $("#startLesson"),
  finishLesson: $("#finishLesson"),
  sessionBrief: $("#sessionBrief"),
  lessonRecoveryNotice: $("#lessonRecoveryNotice"),
  lessonRecoveryDescription: $("#lessonRecoveryDescription"),
  recoverInterruptedLesson: $("#recoverInterruptedLesson"),
  discardInterruptedLesson: $("#discardInterruptedLesson"),
  memoryInfo: $("#memoryInfo"),
  memoryTitle: $("#memoryTitle"),
  memoryList: $("#memoryList"),
  toolDrawer: $("#toolDrawer"),
  drawerBackdrop: $("#drawerBackdrop"),
  drawerClose: $("#drawerClose"),
  drawerTitle: $("#drawerTitle"),
  toolTriggers: [...document.querySelectorAll(".tool-trigger[data-tool]")],
  toolPanels: [...document.querySelectorAll("[data-tool-panel]")],
  pronunciationConfidence: $("#pronunciationConfidence"),
  pronunciationPassageTitle: $("#pronunciationPassageTitle"),
  pronunciationPassage: $("#pronunciationPassage"),
  pronunciationTimerBar: $("#pronunciationTimerBar"),
  pronunciationTimer: $("#pronunciationTimer"),
  pronunciationRecordButton: $("#pronunciationRecordButton"),
  pronunciationDiscardButton: $("#pronunciationDiscardButton"),
  pronunciationAnalyzeButton: $("#pronunciationAnalyzeButton"),
  pronunciationReport: $("#pronunciationReport"),
  toast: $("#toast"),
  voiceRetryButton: $("#voiceRetryButton")
};

const activity = createActivityIndicator([...document.querySelectorAll("[data-activity-view]")], elements.stateBadge);
const apiFetch = createActivityFetch(activity);
const avatarLoadActivity = activity.begin("正在加载人物", "正在准备表情与动作。");
const avatarLoadTimeout = setTimeout(() => avatarLoadActivity.end("人物动作暂未加载成功，请刷新页面重试。"), 20_000);

const normalizeSpeech = text => text
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/…/g, "...")
  .replace(/\s+/g, " ")
  .trim();

const voiceAudioByText = new Map();
const voiceJobsByText = new Map();
const chatSessionId = await acquireChatSession();
// A deadline is an error boundary, never permission to substitute another voice.
const VOICE_START_DEADLINE_MS = 8_000;
// Voice assets are synthesized on demand.

const localPlans = Object.fromEntries(LESSON_DURATIONS.map(duration => [duration, {
  title: '根据你的学习进度备课',
  segments: lessonTiming(duration).map((minutes, index) => ({
    minutes,
    title: ['诊断与复习', '核心任务与示范', '重说与针对练习', '独立迁移与回顾'][index],
    activity: ['用新问题检查旧知识；不先给答案', '围绕本课主线选择有用的词汇或句式', '更长的本人表达；检查并重说', '换情境运用，整理下次复习'][index]
  })),
  openingQuestion: 'What would you like to express more clearly in English?',
  followUps: [], naturalPhrases: [], successCriteria: ['完成目标练习并在新情境尝试', '已学内容安排跨课复习']
}]));

const state = {
  motion: true,
  speaking: false,
  recordingPhase: "idle",
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null,
  recordingGeneration: 0,
  transcriptionAbort: null,
  inputMeta: { source: "typed", durationSeconds: null, asrConfidence: null },
  turn: 0,
  evidence: [],
  learnerProfile: null,
  learnerSnapshot: null,
  lessonActive: false,
  lessonClock: null,
  assessment: { active: false, currentTask: null, restoreSubtitles: true },
  avatarPerformance: "listening",
  avatarExpression: { kind: "neutral", intensity: 0 },
  avatarExpressionId: 0,
  previewGesture: null,
  previewId: 0,
  activeTool: "profile",
  pronunciation: {
    passage: null,
    phase: "idle",
    mediaRecorder: null,
    mediaStream: null,
    chunks: [],
    recording: null,
    generation: 0,
    startedAt: 0,
    timer: null,
    tick: null
  },
  plan: localPlans[30],
  replyPending: false,
  speechTimer: null,
  speechGeneration: 0,
  activeReplayButton: null,
  activeSpeechToken: null,
  pendingVoiceRetry: null,
  activeAudio: null,
  playbackActivity: null,
  activeUtterance: null,
  audioContext: null,
  audioAnalyser: null,
  audioNodes: [],
  mouthFrame: null,
  rigParameters: {
    ParamAngleX: 0,
    ParamAngleY: 0,
    ParamAngleZ: 0,
    ParamBodyAngleX: 0,
    ParamBodyAngleY: 0,
    ParamBodyAngleZ: 0,
    ParamEyeBallX: 0,
    ParamEyeBallY: 0,
    ParamEyeLOpen: 1,
    ParamEyeROpen: 1,
    ParamMouthOpenY: 0,
    ParamMouthForm: 0.08,
    ParamArmLA: 0,
    ParamArmRA: 0,
    ParamBreath: 0.5
  }
};

function sendRigState(patch = {}) {
  Object.assign(state.rigParameters, patch);
  elements.live2dFrame?.contentWindow?.postMessage({
    type: "auto-live2d:state",
    parameters: { ...state.rigParameters },
    expressionState: { active: { performance: state.avatarPerformance, expression: state.avatarExpression, cueId: state.avatarExpressionId } },
    speaking: state.speaking,
    recording: state.recordingPhase === 'recording',
    greeting: state.speaking && state.greeting === true,
    previewGesture: state.previewGesture,
    previewId: state.previewId,
    motion: state.motion,
    stageBackground: "transparent",
    tracking: { enabled: false }
  }, location.origin);
}

function toast(message, duration = 3200) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), duration);
}

const drawerNames = {
  profile: "动态能力画像",
  lesson: "本节课程",
  memory: "长期记忆",
  pronunciation: "长文本发音体检",
  performance: "人物动作与表情"
};

function openTool(tool) {
  elements.toolDrawer.inert = false;
  state.activeTool = tool;
  elements.toolTriggers.forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
  elements.toolPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.toolPanel === tool));
  elements.drawerTitle.textContent = drawerNames[tool] || "学习工具";
  elements.toolDrawer.classList.add("open");
  elements.drawerBackdrop.classList.add("open");
  elements.toolDrawer.setAttribute("aria-hidden", "false");
  elements.drawerClose.focus({ preventScroll: true });
}

function closeTools() {
  elements.toolDrawer.inert = true;
  elements.toolDrawer.classList.remove("open");
  elements.drawerBackdrop.classList.remove("open");
  elements.toolDrawer.setAttribute("aria-hidden", "true");
  elements.toolTriggers.find(button => button.dataset.tool === state.activeTool)?.focus({ preventScroll: true });
}

function setAvatarState(name, label) {
  elements.avatarRig.classList.remove("speaking", "thinking", "encouraging", "celebrating", "listening");
  elements.avatarRig.classList.add(name);
  elements.stateBadge.classList.toggle("is-thinking", name === "thinking");
  state.avatarPerformance = name;
  sendRigState();
  elements.stateBadge.innerHTML = `<span>●</span> ${label}`;
}

function syncSubtitleVisibility() {
  elements.subtitleCard.classList.toggle("hidden", !elements.subtitleToggle.checked);
  elements.subtitleZh.hidden = !elements.translationToggle.checked || !elements.subtitleZh.textContent.trim();
}

function setSubtitles(en, zh = "") {
  elements.subtitleEn.textContent = en;
  elements.subtitleZh.textContent = zh;
  syncSubtitleVisibility();
}

function animateMouth(active) {
  clearInterval(state.speechTimer);
  cancelAnimationFrame(state.mouthFrame);
  if (!active) {
    sendRigState({ ParamMouthOpenY: 0, ParamMouthForm: 0.08 });
    return;
  }
  let phase = 0;
  state.speechTimer = setInterval(() => {
    phase += 0.78;
    const syllable = Math.abs(Math.sin(phase)) * (0.34 + Math.abs(Math.sin(phase * .37)) * .2);
    sendRigState({ ParamMouthOpenY: Math.min(.62, .08 + syllable), ParamMouthForm: .1 });
  }, 72);
}

function finishSpeech(token) {
  if (token !== state.speechGeneration) return;
  state.speaking = false;
  cancelAnimationFrame(state.mouthFrame);
  state.mouthFrame = null;
  state.activeAudio = null;
  state.activeUtterance = null;
  state.audioNodes.forEach(node => node.disconnect());
  state.audioNodes = [];
  state.audioAnalyser = null;
  animateMouth(false);
  state.activeReplayButton?.classList.remove("playing");
  state.activeReplayButton = null;
  setAvatarState("listening", "在听你说");
}

function beginSpeech(token, text, translation, replayButton) {
  if (token !== state.speechGeneration) return;
  state.speaking = true;
  state.greeting = replayButton?.dataset.greeting === "true"
    || normalizeSpeech(text) === normalizeSpeech(GREETING_TEXT);
  state.activeReplayButton?.classList.remove("playing");
  state.activeReplayButton = replayButton || null;
  state.activeReplayButton?.classList.add("playing");
  let expression;
  try { expression = JSON.parse(replayButton?.dataset.expression || "null"); } catch { expression = null; }
  // Buffering can emit 'playing' more than once. Resume lip sync without
  // restarting a semantic nod or replacing a later expression cue.
  if (state.activeSpeechToken !== token) {
    state.avatarExpression = normalizeExpression(expression);
    state.avatarExpressionId = token;
    state.activeSpeechToken = token;
  }
  setAvatarState("speaking", reactionLabel(state.avatarExpression));
  setSubtitles(text, translation);
}

function reactionLabel(expression) {
  return { empathy: "安慰回应", encouraging: "鼓励回应", celebrating: "为你开心", curious: "认真追问" }[expression?.kind] || "正在说话";
}

function stopCurrentSpeech() {
  // Invalidate callbacks before pausing: a previous onplay/onend or TTS promise
  // must never restart the mouth after a different reply has taken over.
  state.speechGeneration += 1;
  state.speaking = false;
  state.pendingVoiceRetry = null;
  if (elements.voiceRetryButton) elements.voiceRetryButton.hidden = true;
  state.playbackActivity?.end();
  state.playbackActivity = null;
  state.avatarExpression = normalizeExpression(null);
  clearInterval(state.speechTimer);
  cancelAnimationFrame(state.mouthFrame);
  state.mouthFrame = null;
  if (state.activeAudio) {
    state.activeAudio.onplay = null;
    state.activeAudio.onplaying = null;
    state.activeAudio.onwaiting = null;
    state.activeAudio.onpause = null;
    state.activeAudio.onended = null;
    state.activeAudio.onerror = null;
    state.activeAudio.pause();
    state.activeAudio = null;
  }
  if (state.activeUtterance && "speechSynthesis" in window) {
    state.activeUtterance.onstart = null;
    state.activeUtterance.onend = null;
    state.activeUtterance.onerror = null;
    window.speechSynthesis.cancel();
    state.activeUtterance = null;
  }
  state.activeReplayButton?.classList.remove("playing");
  state.activeReplayButton = null;
  state.audioNodes.forEach(node => node.disconnect());
  state.audioNodes = [];
  state.audioAnalyser = null;
  sendRigState({ ParamMouthOpenY: 0, ParamMouthForm: .08 });
}

function driveAudioMouth(analyser, token) {
  cancelAnimationFrame(state.mouthFrame);
  const samples = new Float32Array(analyser.fftSize);
  const envelope = new SpeechEnvelope();
  let lastUpdate = 0;
  const tick = now => {
    if (token !== state.speechGeneration || !state.speaking) return;
    analyser.getFloatTimeDomainData(samples);
    if (now - lastUpdate > 24) {
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      sendRigState(envelope.step(rms, lastUpdate ? (now - lastUpdate) / 1000 : .025));
      lastUpdate = now;
    }
    state.mouthFrame = requestAnimationFrame(tick);
  };
  state.mouthFrame = requestAnimationFrame(tick);
}

async function playRecordedVoice(url, text, translation, replayButton, onStarted = null, throwOnStartFailure = false) {
  stopCurrentSpeech();
  const token = ++state.speechGeneration;
  const playbackActivity = activity.begin("正在加载语音", "准备播放 Emilia 的回复。");
  state.playbackActivity = playbackActivity;
  const audio = new Audio();
  audio.preload = "auto";
  state.activeAudio = audio;
  let analyser = null;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      state.audioContext ||= new AudioContext();
      let resumeTimer;
      try {
        await Promise.race([state.audioContext.resume(), new Promise((_, reject) => {
          resumeTimer = setTimeout(() => reject(new Error("浏览器尚未允许音频处理")), 900);
        })]);
      } finally { clearTimeout(resumeTimer); }
      if (token !== state.speechGeneration) { playbackActivity.end(); return; }
      const source = state.audioContext.createMediaElementSource(audio);
      analyser = state.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      analyser.connect(state.audioContext.destination);
      state.audioNodes = [source, analyser];
      state.audioAnalyser = analyser;
    }
  } catch {
    state.audioAnalyser = null;
  }
  if (token !== state.speechGeneration) { playbackActivity.end(); return; }

  let didStart = false;
  let voiceLoadRetries = 0;
  let voiceRetryTimer = null, voiceRetryPending = false, playbackClosed = false, audioLoadAttempt = 0;
  let startTimer;
  let resolveAudioStart;
  let rejectAudioStart;
  const audioStart = new Promise((resolve, reject) => {
    resolveAudioStart = resolve;
    rejectAudioStart = reject;
  });
  audio.onplaying = () => {
    if (token !== state.speechGeneration) { audio.pause(); resolveAudioStart(); return; }
    clearTimeout(voiceRetryTimer);voiceRetryPending=false;
    if (!didStart) {
      didStart = true;
      replayButton = onStarted?.() || replayButton;
    }
    beginSpeech(token, replayButton?.dataset.speech || text, replayButton?.dataset.translation || translation, replayButton);
    playbackActivity.end();
    if (analyser) driveAudioMouth(analyser, token);
    else animateMouth(true);
    resolveAudioStart();
  };
  audio.onwaiting = audio.onpause = () => {
    if (token !== state.speechGeneration) return;
    cancelAnimationFrame(state.mouthFrame);
    clearInterval(state.speechTimer);
    sendRigState({ ParamMouthOpenY: 0 });
  };
  attachVoicePlaylist(audio, url, {
    isCurrent: () => token === state.speechGeneration && !playbackClosed,
    onEnded: () => finishSpeech(token),
    onError: () => audio.onerror?.(),
    play: attemptPlay
  });
  function attemptPlay() {
    if(playbackClosed || token!==state.speechGeneration)return Promise.resolve();
    const attempt=++audioLoadAttempt;
    return audio.play().catch(error=>{
      if(attempt===audioLoadAttempt)retryAudio(error);
    });
  }
  function retryAudio(error) {
    if (token !== state.speechGeneration) { resolveAudioStart(); return; }
    if(playbackClosed || voiceRetryPending)return;
    if(error?.name==='NotAllowedError'){
      playbackClosed=true;clearTimeout(voiceRetryTimer);
      if(didStart){
        finishSpeech(token);
        if(replayButton && elements.voiceRetryButton){
          state.pendingVoiceRetry={text:replayButton.dataset.speech||text,translation,replayButton,token};
          elements.voiceRetryButton.textContent='▶ 点击重播 Emilia 的声音';elements.voiceRetryButton.hidden=false;
        }
        toast('浏览器暂时拦截了后续语音，请点击重播。',5000);
      }else rejectAudioStart(error);
      return;
    }
    if(voiceLoadRetries<2 && audio.src) {
      const segment=audio.voiceSegmentIndex,retry=new URL(audio.src,location.href);
      retry.searchParams.set('voiceRetry',String(++voiceLoadRetries));
      voiceRetryPending=true;
      audio.onwaiting?.();
      voiceRetryTimer=window.setTimeout(()=>{
        voiceRetryPending=false;
        if(playbackClosed || token!==state.speechGeneration || audio.voiceSegmentIndex!==segment)return;
        audio.src=retry.href;void attemptPlay();
      },80*voiceLoadRetries);
      return;
    }
    playbackClosed=true;clearTimeout(voiceRetryTimer);audioLoadAttempt++;
    voiceAudioByText.delete(normalizeSpeech(text));
    if(didStart){finishSpeech(token);toast("音频加载失败，点击 ▶ 会重新生成并播放。", 4500);}
    rejectAudioStart(new Error("本地生成的语音加载失败"));
  }
  audio.onerror=()=>retryAudio(new Error('本地生成的语音加载失败'));
  try {
    void attemptPlay();
    await Promise.race([
      audioStart,
      new Promise((_, reject) => { startTimer = window.setTimeout(() => reject(new Error("Emilia 音频加载超时")), VOICE_START_DEADLINE_MS); })
    ]);
    if (token !== state.speechGeneration) return;
    return didStart;
  } catch (error) {
    if (token !== state.speechGeneration) return;
    if (!didStart) {
      playbackClosed=true;clearTimeout(voiceRetryTimer);voiceRetryPending=false;audioLoadAttempt++;
      audio.onplay = audio.onplaying = audio.onwaiting = audio.onpause = audio.onended = audio.onerror = null;
      audio.pause();
      finishSpeech(token);
      const blocked = error.name === 'NotAllowedError';
      const explanation = blocked ? '浏览器需要你点击一次才能播放 Emilia 的声音。' : `${error.message}；保留 Emilia 声线，不切换系统声音。`;
      if (replayButton && elements.voiceRetryButton) {
        state.pendingVoiceRetry = { text, translation, replayButton, token };
        elements.voiceRetryButton.textContent = blocked ? '▶ 点击播放 Emilia 的声音' : '▶ 重试 Emilia 的声音';
        elements.voiceRetryButton.hidden = false;
      }
      toast(explanation, 6000);
      playbackActivity.end(blocked ? '' : explanation);
      if (throwOnStartFailure) throw error;
      return false;
    }
  } finally {
    clearTimeout(startTimer);
    playbackActivity.end();
    if (state.playbackActivity === playbackActivity) state.playbackActivity = null;
  }
}

function streamingVoiceUrl(text) {
  const normalized = normalizeSpeech(text);
  const url = `/api/tts/stream?text=${encodeURIComponent(normalized)}`;
  voiceAudioByText.set(normalized, url);
  return url;
}

async function ensureRecordedVoice(text, force = false) {
  const normalized = normalizeSpeech(text);
  if (!force && voiceAudioByText.has(normalized)) return voiceAudioByText.get(normalized);
  if (!force && voiceJobsByText.has(normalized)) return voiceJobsByText.get(normalized);

  const job = apiFetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: normalized })
  }).then(async response => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) throw new Error(payload.error || "语音生成失败");
    voiceAudioByText.set(normalized, payload.url);
    return payload.url;
  }).finally(() => voiceJobsByText.delete(normalized));

  voiceJobsByText.set(normalized, job);
  return job;
}

async function speak(text, translation = "", replayButton = null) {
  stopCurrentSpeech();
  const requestedAtGeneration = state.speechGeneration;
  setAvatarState("thinking", "正在准备语音");
  try {
    const recorded = await ensureRecordedVoice(text);
    if (requestedAtGeneration !== state.speechGeneration) return false;
    return await playRecordedVoice(recorded, text, translation, replayButton);
  } catch (error) {
    if (requestedAtGeneration !== state.speechGeneration) return false;
    setAvatarState("listening", "在听你说");
    toast(`语音生成失败：${error.message}。请点击 ▶ 重试。`, 6000);
    return false;
  }
}

function addMessage(role, english, note = "", chip = "") {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "coach-message"}`;
  article.innerHTML = `
    <div class="mini-avatar">${role === "user" ? "你" : "E"}</div>
    <div>
      <span class="speaker">${role === "user" ? "You" : "Emilia"} · 刚刚</span>
      <div class="bubble">
        ${role === "coach" ? "<button class=\"replay-speech\" type=\"button\" aria-label=\"重新朗读\">▶</button>" : ""}
        <p></p>
        ${note ? "<small></small>" : ""}
        ${chip ? "<span class=\"feedback-chip\"></span>" : ""}
      </div>
    </div>`;
  article.querySelector("p").textContent = english;
  const replayButton = article.querySelector(".replay-speech");
  if (replayButton) replayButton.dataset.speech = english;
  if (note) article.querySelector("small").textContent = note;
  if (chip) article.querySelector(".feedback-chip").textContent = chip;
  elements.chat.append(article);
  elements.chat.scrollTop = elements.chat.scrollHeight;
  return article;
}

function renderTurnFeedback(article, reply, learnerText, pending = false) {
  if (!article) return;
  const bubble = article.querySelector(".bubble");
  let note = bubble.querySelector(":scope > small");
  if (!note) { note = document.createElement("small"); bubble.append(note); }
  note.className = "teaching-feedback";
  note.replaceChildren();
  note.setAttribute("aria-live", "polite");
  if (reply.feedback) {
    const feedback = normalizeTeachingFeedback(reply.feedback, learnerText);
    note.dataset.feedback = feedback.status;
    const label = document.createElement("strong");
    label.textContent = { correction: "建议修改", upgrade: "更自然的说法 · 原句也可用", ok: "表达检查", uncertain: "暂不能确定" }[feedback.status];
    note.append(label);
    if (feedback.original) {
      const change = document.createElement("span"); change.className = "feedback-change";
      const before = document.createElement("span"), after = document.createElement("span");
      before.className = "feedback-before"; before.textContent = feedback.original;
      after.className = "feedback-after"; after.textContent = feedback.revised;
      change.append(before, document.createTextNode(" → "), after); note.append(change);
    }
    const reason = document.createElement("span"); reason.className = "feedback-reason"; reason.textContent = feedback.reasonZh;
    note.append(reason);
    bubble.querySelector(".feedback-chip")?.remove();
  } else {
    note.dataset.feedback = pending ? "pending" : "uncertain";
    note.textContent = reply.note || (pending ? "正在检查你这句话的表达…" : "本轮后台没有提供修改建议，不代表你的表达没有问题。");
    let chip = bubble.querySelector(".feedback-chip");
    if (reply.chip) {
      if (!chip) { chip = document.createElement("span"); chip.className = "feedback-chip"; bubble.append(chip); }
      chip.textContent = reply.chip;
    } else chip?.remove();
  }
}

function setLearningStage(stage) {
  const steps = [elements.progressWarmup, elements.progressAssessment, elements.progressPractice];
  steps.forEach((step, index) => step?.classList.toggle("active", index === stage));
}

function displayBand(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
}

function englishFocusLabel(label) {
  return {
    "回答展开与流利度": "developing longer, more fluent answers",
    "衔接与逻辑": "organising ideas more clearly",
    "词汇准确与自然搭配": "using more precise and natural vocabulary",
    "句式范围": "using a wider range of sentence structures",
    "语法准确度": "improving grammatical accuracy",
    "听取关键信息": "catching key listening details",
    "发音仍需专门采样": "building a reliable speaking baseline"
  }[label] || "building a stronger speaking baseline";
}

function renderAssessmentFeedback(items) {
  for (const [index, item] of (items || []).entries()) {
    const note = `做得好的地方：${item.whatWorkedZh} 修改重点：${item.changeZh}`;
    const article = addMessage(
      "coach",
      item.revisedAnswerEn,
      note,
      `回答 ${index + 1} · ${item.section || "逐段修改"}`
    );
    const replayButton = article.querySelector(".replay-speech");
    replayButton.dataset.speech = item.revisedAnswerEn;
    replayButton.dataset.translation = item.changeZh;
  }
}

function renderPronunciationReport(report, profile = state.learnerProfile?.pronunciationProfile) {
  const target = report || profile?.lastReport;
  if (!target) {
    elements.pronunciationReport.hidden = true;
    return;
  }
  const coverage = Math.round(Number(target.wordCoverage || 0) * 100);
  const scores = [
    ["文本一致性", `${coverage}%`],
    ["清晰度证据", `${Math.round(target.clarityScore || 0)}`],
    ["语速", `${Math.round(target.wordsPerMinute || 0)} wpm`],
    ["停顿占比", `${Math.round(Number(target.pauseRatio || 0) * 100)}%`],
    ["语调跨度", `${Number(target.intonationRangeSemitones || 0).toFixed(1)} st`]
  ];
  elements.pronunciationReport.hidden = false;
  elements.pronunciationReport.innerHTML = `
    <div class="pronunciation-metrics">${scores.map(([label, value]) => `<span><b>${value}</b><em>${label}</em></span>`).join("")}</div>
    <ul>${(target.suggestionsZh || ["换一篇文本继续复测稳定性。"]).map(item => `<li>${item}</li>`).join("")}</ul>
    <small>${target.boundaryZh || "这是朗读诊断，不等同于官方雅思发音分。"}</small>`;
}

function renderMemory(profile) {
  const liveSignals = Object.values(profile.skillMemory || {})
    .sort((left, right) => Date.parse(right.lastSeen || 0) - Date.parse(left.lastSeen || 0))
    .map(item => ({
      type: item.status === "active" ? "active" : item.status === "mastered" ? "mastered" : "watch",
      label: item.status === "active" ? "练习中" : item.status === "mastered" ? "已掌握" : "观察中",
      text: item.note ? `${item.label}：${item.note}` : item.label
    }));
  const seen = new Set(liveSignals.map(item => item.text.split("：")[0]));
  const items = [
    ...liveSignals,
    ...(profile.activeNeeds || []).filter(text => !seen.has(text)).map(text => ({ type: "active", label: "练习中", text })),
    ...(profile.masteredItems || []).filter(text => !seen.has(text)).map(text => ({ type: "mastered", label: "已掌握", text }))
  ].slice(0, 3);
  if (!items.length) items.push({ type: "watch", label: "待建立", text: "完成入门测评后只保留必要证据" });
  elements.memoryTitle.textContent = "当前教学重点";
  elements.memoryList.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("li");
    row.className = item.type;
    row.innerHTML = "<span></span><p></p>";
    row.querySelector("span").textContent = item.label;
    row.querySelector("p").textContent = item.text;
    elements.memoryList.append(row);
  }
}

function renderSessionBrief(brief) {
  if (state.previewOnly) brief = null;
  state.lessonActive = Boolean(brief);
  elements.lessonDuration.disabled = Boolean(brief) || state.previewOnly;
  elements.finishLesson.hidden = !brief;
  elements.startLesson.hidden = Boolean(brief);
  elements.startLesson.innerHTML = "读取记忆并开始 <span>→</span>";
  elements.sessionBrief.hidden = !brief;
  elements.sessionBrief.innerHTML = "";
  if (!brief) {
    stopLessonClock();
    if (!state.assessment.active) elements.sessionMode.disabled = false;
    return;
  }
  elements.sessionMode.disabled = true;
  const heading = document.createElement("strong");
  heading.textContent = `本课课题 · ${(brief.focus || [])[0] || "本节口语任务"}`;
  const focus = document.createElement("p");
  focus.textContent = `训练重点：${(brief.focus || [])[1] || (brief.focus || [])[0] || "自然表达"} · 当前策略：${brief.nextMove}`;
  const route = document.createElement("p");
  route.textContent = (brief.route || []).join("；");
  const review = document.createElement("p");
  const delayedTargets = (brief.reviewTargets || []).filter(item => item.reviewKind !== "same_day_reinforcement")
    .map(item => item.targetEn).filter(Boolean);
  const reinforcementTargets = (brief.reviewTargets || []).filter(item => item.reviewKind === "same_day_reinforcement")
    .map(item => item.targetEn).filter(Boolean);
  review.textContent = delayedTargets.length
    ? `本节跨课抽查：${delayedTargets.join("、")}（先尝试回忆，不先展示答案）`
    : reinforcementTargets.length
      ? `本节同日加深：${reinforcementTargets.join("、")}（换语境练习，不当作长期记住）`
      : "本节没有到期旧知识；会从真实表达中建立新语言点，并在课末换语境复现。";
  const load = document.createElement("p");
  const loadPlan = brief.learningLoad || {};
  load.textContent = loadPlan.totalCycles
    ? `本节负荷：${loadPlan.delayedReviews || 0} 个跨课复习 + ${loadPlan.sameDayReinforcements || 0} 个同日加深 + 最多 ${loadPlan.maximumNewItems ?? loadPlan.totalCycles} 个新重点；每个重点都要重说并换语境使用。`
    : "本节负荷会按现有证据控制，先练深再加新内容。";
  const topicRotation = document.createElement("p");
  topicRotation.textContent = brief.topicRotationReason
    ? `话题安排：${brief.topicLabel || "新话题"}。${brief.topicRotationReason}`
    : "话题会兼顾自然承接与跨领域迁移。";
  elements.sessionBrief.append(heading, focus, topicRotation, route, review, load);
}

function formatLessonTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function stopLessonClock() {
  if (state.lessonClock?.timer) window.clearInterval(state.lessonClock.timer);
  state.lessonClock = null;
  elements.lessonClock.hidden = true;
  elements.lessonClock.classList.remove("is-ending", "is-complete");
  elements.lessonClockFinish.hidden = true;
  elements.lessonClockFinish.disabled = false;
  for (const row of elements.lessonPlan.children) row.classList.remove("active", "complete");
}

function renderLessonClock() {
  const clock = state.lessonClock;
  if (!clock) return;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - clock.startedAt) / 1000));
  const remainingSeconds = Math.max(0, clock.durationSeconds - elapsedSeconds);
  let boundary = 0, timeSegmentIndex = Math.max(0, clock.plan.segments.length - 1);
  for (const [index, segment] of clock.plan.segments.entries()) {
    boundary += Number(segment.minutes || 0) * 60;
    if (elapsedSeconds < boundary) { timeSegmentIndex = index; break; }
  }
  const segmentIndex = Math.min(
    Math.max(0, clock.plan.segments.length - 1),
    Math.max(timeSegmentIndex, Number(clock.segmentFloor) || 0)
  );
  elements.lessonClock.hidden = false;
  elements.lessonCoreTitle.textContent = clock.coreTopic;
  elements.lessonElapsed.textContent = `已上课 ${formatLessonTime(elapsedSeconds)}`;
  const teaching = clock.teaching || { completedCycles: 0, plannedItems: 2, contentComplete: false };
  const integrationActive = teaching.phase === 'integrated_transfer';
  if (teaching.contentComplete) {
    elements.lessonRemaining.textContent = "本节内容已完成 · 现在是课后闲聊";
  } else if (remainingSeconds) {
    elements.lessonRemaining.textContent = `剩余 ${formatLessonTime(remainingSeconds)} · ${integrationActive ? '综合表达与反馈' : `教学 ${teaching.completedCycles}/${teaching.plannedItems}`}`;
  } else {
    elements.lessonRemaining.textContent = `计划时间已到 · 教学 ${teaching.completedCycles}/${teaching.plannedItems}（可继续或归档）`;
  }
  elements.lessonClockFinish.hidden = false;
  elements.lessonClockFinish.textContent = teaching.contentComplete ? "总结并归档" : "现在结束并归档";
  elements.lessonClock.classList.toggle("is-ending", !teaching.contentComplete && remainingSeconds <= 120);
  elements.lessonClock.classList.toggle("is-complete", teaching.contentComplete);
  [...elements.lessonPlan.children].forEach((row, index) => {
    row.classList.toggle("complete", teaching.contentComplete || index < segmentIndex);
    row.classList.toggle("active", !teaching.contentComplete && index === segmentIndex);
  });
  setLearningStage(segmentIndex === 0 ? 0 : segmentIndex === 1 ? 1 : 2);
  if (!remainingSeconds && !clock.expiredNotified) {
    clock.expiredNotified = true;
    toast("计划时间已到，但不代表内容已经学完。你可以继续完成教学目标，也可以现在结束并归档。", 8000);
  }
}

function startLessonClock(currentSession, plan, serverLesson = null) {
  stopLessonClock();
  const startedAt = Date.parse(serverLesson?.startedAt || currentSession?.startedAt || "");
  const durationSeconds = Number(serverLesson?.durationSeconds)
    || Math.max(1, Number(currentSession?.duration || elements.lessonDuration.value) || 30) * 60;
  state.lessonClock = {
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    durationSeconds,
    coreTopic: serverLesson?.coreTopic || currentSession?.brief?.focus?.[0] || plan.title,
    plan,
    segmentFloor: Number(serverLesson?.segmentIndex) || 0,
    teaching: serverLesson?.teaching || { completedCycles: 0, plannedItems: 2, contentComplete: false },
    expiredNotified: false,
    contentCompleteNotified: Boolean(serverLesson?.teaching?.contentComplete),
    timer: null
  };
  elements.finishLesson.textContent = "结束并归档";
  elements.lessonClockFinish.hidden = true;
  state.lessonClock.timer = window.setInterval(renderLessonClock, 1000);
  elements.sessionTitle.textContent = `本节课 · ${state.lessonClock.coreTopic}`;
  renderLessonClock();
}

function syncLessonClockProgress(progress) {
  if (!state.lessonClock || !progress) return;
  state.lessonClock.segmentFloor = Math.max(state.lessonClock.segmentFloor, Number(progress.segmentIndex) || 0);
  const wasComplete = Boolean(state.lessonClock.teaching?.contentComplete);
  state.lessonClock.teaching = progress.teaching || state.lessonClock.teaching;
  if (!wasComplete && progress.teaching?.contentComplete && !state.lessonClock.contentCompleteNotified) {
    state.lessonClock.contentCompleteNotified = true;
    toast("本节计划内容已经全部讲完。你现在可以总结归档，也可以留下来和 Emilia 闲聊。", 9000);
  }
  renderLessonClock();
}

function renderLessonRecovery(snapshot) {
  const interrupted = Boolean(snapshot?.interruptedLesson && !state.previewOnly);
  const checkpoint = interrupted && snapshot.recoverableLesson;
  elements.lessonRecoveryNotice.hidden = !interrupted;
  elements.recoverInterruptedLesson.hidden = !checkpoint;
  elements.discardInterruptedLesson.hidden = !interrupted;
  elements.discardInterruptedLesson.textContent = checkpoint ? '放弃恢复记录' : '清除旧课堂标记';
  if (!interrupted) return;
  const savedAt = Date.parse(checkpoint?.savedAt || '');
  const savedTime = Number.isFinite(savedAt) ? `（${new Date(savedAt).toLocaleString('zh-CN')}）` : '';
  elements.lessonRecoveryDescription.textContent = checkpoint
    ? `已保留“${checkpoint.title || '上次课堂'}”的 ${Math.max(0, Number(checkpoint.turnCount) || 0)} 轮已完成对话${savedTime}。继续后恢复文字和课堂进度，不会自动朗读；这些临时记录在归档或明确放弃后删除。`
    : '旧版本只留下了未结束标记，没有恢复记录，无法恢复未整理的对话，也不会补造总结。已保存的能力与长期记忆仍保留。';
  stopLessonClock();
  state.lessonActive = false;
  elements.finishLesson.hidden = true;
  elements.startLesson.hidden = true;
  elements.sessionBrief.hidden = false;
  elements.sessionBrief.textContent = `${elements.lessonRecoveryDescription.textContent} 请在对话区处理上次课堂，再开始新课。`;
}

function restoreLessonHistory(history = [],label='上次课堂') {
  elements.chat.replaceChildren();
  for (const turn of history) {
    for (const [role, text] of [['user', turn.learner], ['coach', turn.teacher]]) {
      if (typeof text !== 'string' || !text.trim()) continue;
      const article = addMessage(role, text);
      article.dataset.restored = 'true';
      article.querySelector('.speaker').textContent = `${role === 'user' ? 'You' : 'Emilia'} · ${label}`;
    }
  }
  elements.quickReplies.style.display = 'none';
  state.turn = Math.max(3, history.length + 3);
}

async function recoverInterruptedLesson(action) {
  if (state.replyPending || state.assessment.active || state.previewOnly) return;
  if (['recording', 'transcribing'].includes(state.recordingPhase)) {
    toast('请先完成或删除当前语音输入，再处理上次课堂。');
    return;
  }
  const checkpoint = state.learnerSnapshot?.recoverableLesson;
  if (!state.learnerSnapshot?.interruptedLesson || action === 'resume' && !checkpoint) return;
  if (action === 'discard' && !confirm(checkpoint
    ? '放弃上次未归档课堂？临时恢复记录将删除，无法再继续该课或补做归档。已保存的能力和长期记忆会保留。'
    : '清除旧版本留下的未结束标记？已保存的能力和长期记忆会保留，不会补造缺失的课堂内容。')) return;
  state.replyPending = true;
  elements.recoverInterruptedLesson.disabled = true;
  elements.discardInterruptedLesson.disabled = true;
  const composer = [elements.sendButton, elements.messageInput, elements.micButton];
  const previouslyDisabled = composer.map(element => element.disabled);
  composer.forEach(element => { element.disabled = true; });
  stopCurrentSpeech();
  try {
    const response = await apiFetch('/api/lesson/recover', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, action, sessionId: chatSessionId }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '课堂恢复未完成');
    if (action === 'resume') {
      const currentSession = result.profile?.currentSession;
      const recoveredBrief = result.sessionBrief || result.brief || currentSession?.brief;
      if (!result.resumed || !currentSession || !result.plan?.segments?.length || !recoveredBrief) {
        throw new Error('恢复结果缺少课堂进度，请刷新页面重新读取。');
      }
      const duration = String(currentSession.duration || Math.round(result.lesson?.durationSeconds / 60) || 30);
      if (![...elements.lessonDuration.options].some(option => option.value === duration)) {
        elements.lessonDuration.add(new Option(`${duration} 分钟 · 恢复课堂`, duration));
      }
      elements.lessonDuration.value = duration;
      document.querySelector('.lesson-card h2').textContent = `今天的 ${duration} 分钟`;
      if (currentSession.mode) elements.sessionMode.value = currentSession.mode;
      renderPlan(result.plan, '已恢复上次教案与课堂进度');
      renderLearnerSnapshot({ ...result, sessionBrief: recoveredBrief }, false);
      restoreLessonHistory(Array.isArray(result.history) ? result.history : []);
      startLessonClock(currentSession, result.plan, result.lesson);
      setSubtitles('', '');
      toast('已恢复上次课堂，可以接着回答或结束并归档。历史对话不会自动朗读。', 6500);
    } else {
      renderLearnerSnapshot(result);
      elements.sessionTitle.textContent = '先聊两句，再开始训练';
      toast(checkpoint ? '已删除上次课堂的临时恢复记录；已保存档案保留，现在可以开始新课。'
        : '旧课堂标记已清除；已保存档案保留，现在可以开始新课。', 6500);
    }
  } catch (error) {
    toast(`上次课堂处理未完成：${error.message}`, 7000);
  } finally {
    state.replyPending = false;
    elements.recoverInterruptedLesson.disabled = false;
    elements.discardInterruptedLesson.disabled = false;
    composer.forEach((element, index) => { element.disabled = previouslyDisabled[index]; });
    setAvatarState('listening', '在听你说');
  }
}

function renderLearnerSnapshot(snapshot, updatePlan = true) {
  if (!snapshot?.profile) return;
  const profile = snapshot.profile;
  state.learnerSnapshot = snapshot;
  state.learnerProfile = profile;
  state.assessment.currentTask = snapshot.currentTask || null;
  elements.bandScore.textContent = displayBand(profile.stableBand);
  elements.bandTarget.textContent = displayBand(profile.targetBand);
  elements.bandRange.textContent = profile.stableRange
    ? `当前区间 ${displayBand(profile.stableRange[0])}–${displayBand(profile.stableRange[1])}`
    : "等待测评";

  for (const row of document.querySelectorAll("[data-dimension]")) {
    const key = row.dataset.dimension;
    const value = profile.dimensions?.[key];
    const bar = row.querySelector("b");
    const label = row.querySelector("em");
    if (key === "listening") {
      bar.style.setProperty("--value", value == null ? "0%" : `${Math.max(0, Math.min(100, value))}%`);
      label.textContent = value == null ? "—" : `${Math.round(value)}%`;
    } else {
      bar.style.setProperty("--value", value == null ? "0%" : `${Math.max(0, Math.min(100, value / 9 * 100))}%`);
      label.textContent = value == null ? (key === "pronunciationIntelligibility" ? "待采样" : "—") : displayBand(value);
    }
  }

  const pronunciation = profile.pronunciationProfile || {};
  elements.pronunciationConfidence.textContent = pronunciation.status === "stable" ? "已完成跨日复测" : "仍需后续采样";
  if (pronunciation.lastReport && state.pronunciation.phase === "idle") {
    renderPronunciationReport(null, pronunciation);
  }

  const assessment = profile.assessment || {};
  elements.assessmentReportButton.hidden = !profile.latestAssessmentReport?.items?.length;
  if (assessment.status === "in_progress") {
    elements.assessmentButton.textContent = `继续测评 ${assessment.currentTaskIndex + 1}/4`;
    elements.assessmentStatus.textContent = `已记录 ${assessment.answerEvidenceIds?.length || 0} 条有效证据；完成前不生成稳定分。`;
    if (!state.assessment.active) setLearningStage(1);
  } else if (assessment.status === "completed") {
    elements.assessmentButton.textContent = "重新测评";
    elements.assessmentStatus.textContent = "当前为保守估计，会根据后续课堂和复测缓慢调整。";
    setLearningStage(2);
  } else {
    elements.assessmentButton.textContent = "开始入门测评";
    elements.assessmentStatus.textContent = "尚未建立能力证据";
    setLearningStage(0);
  }
  renderMemory(profile);
  renderSessionBrief(snapshot.sessionBrief || profile.currentSession?.brief || null);
  renderLessonRecovery(snapshot);
  if (updatePlan && snapshot.recommendedPlan) {
    const evidenceCount = profile.evidence?.filter(item => item.kind === "assessment").length || 0;
    renderPlan(snapshot.recommendedPlan, evidenceCount ? `本地画像生成 · ${evidenceCount} 条有效证据` : "待测评 · 基线计划");
  }
}

async function loadLearnerProfile() {
  try {
    const response = await apiFetch('/api/learner/profile?sessionId='+encodeURIComponent(chatSessionId), { cache: "no-store" });
    const snapshot = await response.json();
    if (!response.ok || !snapshot.ok) throw new Error(snapshot.error || "画像读取失败");
    renderLearnerSnapshot(snapshot);
    renderTemporaryRecovery(snapshot.recoverableChat&&!snapshot.profile?.currentSession&&!snapshot.interruptedLesson);
    return snapshot;
  } catch (error) {
    toast(`本地学习档案未载入：${error.message}`, 4800);
    return null;
  }
}

async function loadSpontaneousOpening(snapshot) {
  const article = $('#openingMessage');
  if (!article) return;
  if (!snapshot || snapshot.profile?.currentSession || snapshot.interruptedLesson || snapshot.recoverableChat) {
    article.remove();
    elements.quickReplies.style.display = 'none';
    return;
  }
  state.replyPending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.micButton.disabled = true;
  setAvatarState('thinking', '正在想和你聊什么');
  try {
    const response = await apiFetch('/api/opening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: chatSessionId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'AI 开场没有生成');
    if (result.skip) { article.remove(); return; }
    const paragraph = article.querySelector('p');
    const note = article.querySelector('small');
    const replayButton = article.querySelector('.replay-speech');
    paragraph.textContent = result.en;
    note?.remove();
    replayButton.disabled = false;
    replayButton.dataset.speech = result.en;
    replayButton.dataset.translation = result.zh;
    replayButton.dataset.expression = JSON.stringify(normalizeExpression(result.expression));
    replayButton.dataset.greeting = 'true';
    article.removeAttribute('aria-busy');
    voiceAudioByText.set(normalizeSpeech(result.en), result.voiceUrl);
    elements.quickReplies.style.display = 'none';
    setSubtitles(result.en, result.zh);
    await playRecordedVoice(result.voiceUrl, result.en, result.zh, replayButton);
  } catch (error) {
    article.remove();
    elements.quickReplies.style.display = 'none';
    setSubtitles('', '');
    setAvatarState('listening', '在听你说');
    toast(`这次开场没有生成：${error.message}。你可以先说第一句，刷新页面会重新生成。`, 7000);
  } finally {
    state.replyPending = false;
    elements.sendButton.disabled = false;
    elements.messageInput.disabled = false;
    elements.micButton.disabled = false;
  }
}

function renderTemporaryRecovery(available){
  state.temporaryRecovery=Boolean(available)&&!state.previewOnly;
  $('#temporaryChatRecovery').hidden=!state.temporaryRecovery;
  for(const button of [elements.sendButton,elements.micButton,elements.startLesson,elements.assessmentButton,elements.codexLessonButton,$('#finishCompanionChat')])button.disabled=state.temporaryRecovery;
}
async function recoverTemporaryChat(action){
  if(state.replyPending||!state.temporaryRecovery)return;
  if(action==='discard'&&!confirm('放弃这段未整理的聊天并删除临时恢复记录？'))return;
  state.replyPending=true;
  try{
    const response=await apiFetch('/api/memory/recover-chat',{method:'POST',headers:{'Content-Type':'application/json','X-Emilia-Memory':'1'},body:JSON.stringify({sessionId:chatSessionId,action,confirm:true})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'聊天恢复失败');
    if(result.resumed)restoreLessonHistory(result.history,'上次聊天');
    renderTemporaryRecovery(false);
    toast(result.resumed?'已继续上次聊天，不会自动重播。':'临时聊天已放弃。');
  }catch(error){toast(error.message);}finally{state.replyPending=false;}
}

async function initializeConversation() {
  const snapshot = await loadLearnerProfile();
  await loadSpontaneousOpening(snapshot);
}

async function presentAssessmentTask(task, feedback = "") {
  if (!task) return;
  state.assessment.active = true;
  state.assessment.currentTask = task;
  elements.sessionMode.disabled = true;
  elements.sessionTitle.textContent = `入门测评 · ${task.index}/${task.total} · ${task.section}`;
  setLearningStage(1);
  elements.quickReplies.style.display = "none";
  if (task.kind === "listening") {
    elements.subtitleToggle.checked = false;
    elements.subtitleToggle.disabled = true;
    elements.subtitleCard.classList.add("hidden");
    toast("听力题播放期间已隐藏字幕；可点击消息右上角 ▶ 重听。", 5000);
  } else {
    elements.subtitleToggle.disabled = false;
    elements.subtitleToggle.checked = state.assessment.restoreSubtitles;
    elements.subtitleCard.classList.toggle("hidden", !state.assessment.restoreSubtitles);
  }
  const article = addMessage("coach", task.displayPrompt, feedback || task.instructionZh, `${task.index}/${task.total}`);
  const replayButton = article.querySelector(".replay-speech");
  replayButton.dataset.speech = task.spokenText;
  replayButton.dataset.translation = task.kind === "listening" ? "" : task.instructionZh;
  const voiceUrl = await ensureRecordedVoice(task.spokenText);
  await playRecordedVoice(voiceUrl, task.spokenText, task.kind === "listening" ? "" : task.instructionZh, replayButton);
}

async function beginAssessment() {
  if(state.temporaryRecovery){toast('请先继续或放弃上次聊天。');return;}
  if (state.replyPending) return;
  state.replyPending = true;
  elements.assessmentButton.disabled = true;
  state.assessment.restoreSubtitles = elements.subtitleToggle.checked;
  stopCurrentSpeech();
  setAvatarState("thinking", "正在准备测评");
  try {
    const response = await apiFetch("/api/assessment/start", { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.currentTask) throw new Error(result.error || "测评启动失败");
    renderLearnerSnapshot(result);
    elements.chat.innerHTML = "";
    elements.messageInput.value = "";
    state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
    await presentAssessmentTask(result.currentTask);
  } catch (error) {
    state.assessment.active = false;
    elements.sessionMode.disabled = false;
    setAvatarState("listening", "在听你说");
    toast(`无法开始测评：${error.message}`, 6000);
  } finally {
    state.replyPending = false;
    elements.assessmentButton.disabled = false;
  }
}

async function submitAssessmentAnswer(text) {
  const task = state.assessment.currentTask;
  if (!task) {
    toast("当前测评题目已失效，请重新进入测评。", 4500);
    return;
  }
  state.replyPending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  stopCurrentSpeech();
  setAvatarState(
    "thinking",
    task.index === task.total ? "正在综合分析整套测评" : "正在记录这道题"
  );
  try {
    const response = await apiFetch("/api/assessment/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        text,
        source: state.inputMeta.source,
        durationSeconds: state.inputMeta.durationSeconds,
        // Unknown confidence must remain unknown, including on older servers
        // where Number(null) would otherwise turn it into a zero-confidence score.
        asrConfidence: typeof state.inputMeta.asrConfidence === "number"
          ? state.inputMeta.asrConfidence : undefined,
        duration: Number(elements.lessonDuration.value),
        mode: elements.sessionMode.value
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "测评分析失败");
    addMessage("user", text);
    elements.messageInput.value = "";
    if (state.recordingPhase === "review") setRecorderPhase("idle");
    state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
    renderLearnerSnapshot(result);
    if (result.warning) toast(result.warning, 6500);

    if (result.completed) {
      state.assessment.active = false;
      state.assessment.currentTask = null;
      elements.sessionMode.disabled = false;
      elements.subtitleToggle.disabled = false;
      elements.subtitleToggle.checked = state.assessment.restoreSubtitles;
      elements.subtitleCard.classList.toggle("hidden", !state.assessment.restoreSubtitles);
      elements.sessionTitle.textContent = "测评完成，开始针对练习";
      setLearningStage(2);
      const range = result.profile.stableRange?.map(displayBand).join("–") || displayBand(result.profile.stableBand);
      const focus = englishFocusLabel(result.profile.activeNeeds[0]);
      const completionText = `Thank you. I now have a preliminary picture of your English. Your current range is about ${range}, and today's plan will focus on ${focus}.`;
      const article = addMessage("coach", completionText, result.overallFeedbackZh, "测评完成");
      const replayButton = article.querySelector(".replay-speech");
      replayButton.dataset.translation = "初步画像已生成；它会在后续证据中缓慢修正。";
      renderAssessmentFeedback(result.assessmentFeedback);
      setAvatarState("celebrating", "测评完成");
      const voiceUrl = await ensureRecordedVoice(completionText);
      await playRecordedVoice(voiceUrl, completionText, replayButton.dataset.translation, replayButton);
      toast("已生成初步画像和个性化计划；分数是区间，不会因单次回答骤变。", 6000);
    } else {
      await presentAssessmentTask(result.currentTask);
    }
  } catch (error) {
    setAvatarState("listening", "等你补充后再评估");
    toast(error.message, 6500);
  } finally {
    state.replyPending = false;
    elements.sendButton.disabled = false;
    elements.messageInput.disabled = state.recordingPhase === "transcribing";
  }
}

async function resetLearnerProfile() {
  if (!window.confirm("清空本地能力画像、测评证据和教师文字记忆？伙伴偏好与共同经历将保留。")) return;
  try {
    const response = await apiFetch("/api/learner/reset", { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "清空失败");
    state.assessment.active = false;
    state.assessment.currentTask = null;
    elements.sessionMode.disabled = false;
    elements.subtitleToggle.disabled = false;
    elements.sessionTitle.textContent = "先聊两句，再开始训练";
    renderLearnerSnapshot(result);
    toast("本地画像和结构化证据已清空。", 4200);
  } catch (error) {
    toast(`清空失败：${error.message}`, 5000);
  }
}

function analyzeAnswer(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const connectors = (text.match(/\b(because|so|although|but|for example|actually|especially|which|when)\b/gi) || []).length;
  const specifics = (text.match(/\b(yesterday|today|usually|week|friend|family|work|study|hour|morning|evening)\b/gi) || []).length;
  const quality = Math.min(100, words.length * 3 + connectors * 12 + specifics * 5);
  return { words: words.length, connectors, specifics, quality, source: state.inputMeta.source };
}

async function generateLiveReply(text, evidence, onEvent = () => {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 75_000);
  const ticket = activity.begin("正在组织回复", "正在回应你刚才说的内容。");
  try {
    const response = await fetch("/api/codex/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" },
      body: JSON.stringify({ text, mode: elements.sessionMode.value, evidence, sessionId: chatSessionId, translation:elements.translationToggle.checked, sentenceVoice: true, progressiveVoice: true }),
      signal: controller.signal
    });
    return await readChatResponse(response, event => {
      if (event.type === "status") ticket.update(event.label, event.detail);
      if (event.type === "speech") ticket.update("正在补充修改建议", "语音已就绪，翻译与学习建议随后补齐。");
      onEvent(event);
    });
  } catch (error) {
    if (error.name === "AbortError") {
      ticket.end("等待超时，暂未收到完整结果。请稍后重试。");
      throw new Error("AI 回复超时");
    }
    ticket.end(error.message || "对话连接中断，请稍后重试。");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    ticket.end();
  }
}

async function submitAnswer(rawText) {
  if(state.temporaryRecovery){toast('请先继续或放弃上次聊天。');return;}
  if (state.replyPending) {
    toast("AI 正在回复上一句话，请稍等一下。");
    return;
  }
  if (state.recordingPhase === "recording") {
    toast("请先结束录音；结束后只会识别，不会自动发送。");
    return;
  }
  if (state.recordingPhase === "transcribing") {
    toast("本地模型正在识别，请稍等一下。");
    return;
  }
  const text = rawText.trim();
  if (!text) return;
  if (state.assessment.active) {
    await submitAssessmentAnswer(text);
    return;
  }
  const evidence = analyzeAnswer(text);
  stopCurrentSpeech();
  state.replyPending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  setAvatarState("thinking", "正在理解你说的话");
  const startedAt = performance.now();
  let article = null, playbackJob = null, playbackError = null, latestReply = null;
  let pendingExpression = null, pendingFeedback = null, pendingTranslation = "", replySpeechGeneration = null, expressionRevision = 0;
  let pendingVoiceSegments=[],playlistFinal=false,spokenVoiceUrls=[],progressivePlayback=false;
  const flushVoiceSegments=()=>{
    const audio=state.activeAudio;
    if(replySpeechGeneration!==state.speechGeneration || !audio?.voicePlaylist)return;
    if(pendingVoiceSegments.length){audio.voicePlaylist.append(pendingVoiceSegments);pendingVoiceSegments=[];}
    if(playlistFinal)audio.voicePlaylist.finish();
  };
  const diagnostics = { textReceivedMs: null, audioStartedMs: null, speechReceivedMs: null, completeReceivedMs: null };
  // Timings only, never learner text. Useful for diagnosing cold starts and
  // distinguishing model latency from Kokoro synthesis or browser playback.
  window.chatDiagnostics = { lastTurn: diagnostics };
  const applyExpression = expression => {
    pendingExpression = normalizeExpression(expression);
    if (latestReply) latestReply.expression = pendingExpression;
    const button = article?.querySelector(".replay-speech");
    if (button) button.dataset.expression = JSON.stringify(pendingExpression);
    // A late cue can still complete this reply's reaction after audio ends,
    // but may never affect a newer reply/replay. It never opens the mouth.
    if (replySpeechGeneration !== state.speechGeneration) return;
    if (JSON.stringify(state.avatarExpression) !== JSON.stringify(pendingExpression)) {
      state.avatarExpression = pendingExpression;
      state.avatarExpressionId = `${replySpeechGeneration}:reaction:${++expressionRevision}`;
      diagnostics.expressionAppliedMs = Math.round(performance.now() - startedAt);
      diagnostics.expressionKind = pendingExpression.kind;
      if (state.speaking) setAvatarState("speaking", reactionLabel(pendingExpression));
      else sendRigState();
    }
  };
  const applyTranslation = translation => {
    const zh = String(translation || "").replace(/\s+/g, " ").trim();
    if (!zh) return;
    pendingTranslation = zh;
    if (latestReply) latestReply.zh = zh;
    const button = article?.querySelector(".replay-speech");
    if (button) button.dataset.translation = zh;
    if (state.speaking && state.activeReplayButton === button) setSubtitles(latestReply?.en || "", zh);
  };
  const showReplyText = reply => {
    latestReply = { ...latestReply, ...reply, partial:reply.partial===true, expression: reply.expression || pendingExpression,
      feedback: reply.feedback || pendingFeedback, zh: reply.zh || pendingTranslation };
    if(!reply.partial && diagnostics.fullTextReceivedMs==null)diagnostics.fullTextReceivedMs=Math.round(performance.now()-startedAt);
    if (article) {
      article.querySelector('.bubble > p').textContent=reply.en;
      const button=article.querySelector('.replay-speech');button.dataset.speech=reply.en;
      if(!reply.partial)button.disabled=false;
      if(state.speaking && state.activeReplayButton===button)setSubtitles(reply.en,latestReply.zh);
      return;
    }
    diagnostics.textReceivedMs = Math.round(performance.now() - startedAt);
    addMessage("user", text);
    article = addMessage("coach", reply.en, latestReply.note, latestReply.chip);
    article.querySelector(".replay-speech").disabled = true;
    renderTurnFeedback(article, latestReply, text, !latestReply.feedback);
  };
  const startReply = reply => {
    showReplyText(reply);
    if (playbackJob) return;
    diagnostics.speechReceivedMs = Math.round(performance.now() - startedAt);
    progressivePlayback=reply.partial===true;
    setAvatarState("thinking", "正在准备播放");
    playbackJob = (async () => {
      const voiceUrl = reply.voiceUrls || reply.voiceUrl || await ensureRecordedVoice(reply.en);
      spokenVoiceUrls=Array.isArray(voiceUrl)?[...voiceUrl]:[voiceUrl];
      if (reply.voiceUrl) voiceAudioByText.set(normalizeSpeech(reply.en), voiceUrl);
      await playRecordedVoice(reply.partial?{urls:spokenVoiceUrls,open:true}:voiceUrl, reply.en, latestReply.zh, article.querySelector(".replay-speech"), () => {
        diagnostics.audioStartedMs = Math.round(performance.now() - startedAt);
        replySpeechGeneration = state.speechGeneration;
        const replayButton = article.querySelector(".replay-speech");
        replayButton.disabled = latestReply.partial;
        replayButton.dataset.translation = latestReply.zh || "";
        replayButton.dataset.expression = JSON.stringify(normalizeExpression(latestReply.expression));
        diagnostics.expressionKind = normalizeExpression(latestReply.expression).kind;
        if (latestReply.expression) diagnostics.expressionAppliedMs = diagnostics.audioStartedMs;
        renderTurnFeedback(article, latestReply, text, !latestReply.feedback);
        const thisAudio = state.activeAudio;
        diagnostics.audioDurationMs = Number.isFinite(thisAudio?.duration) ? Math.round(thisAudio.duration * 1000) : null;
        thisAudio?.addEventListener("ended", () => {
          if (!thisAudio.ended || thisAudio.voiceSegmentIndex + 1 !== thisAudio.voiceSegmentCount) return;
          diagnostics.audioEndedMs = Math.round(performance.now() - startedAt);
          if (Number.isFinite(thisAudio.duration)) diagnostics.audioDurationMs = Math.round(thisAudio.duration * 1000);
          diagnostics.feedbackBeforeAudioEnd = diagnostics.feedbackReceivedMs != null
            && diagnostics.feedbackReceivedMs <= diagnostics.audioEndedMs;
        });
        state.evidence.push({ at: Date.now(), ...evidence });
        state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
        state.turn += 1;
        flushVoiceSegments();
        elements.messageInput.value = "";
        elements.quickReplies.style.display = "none";
        if (state.recordingPhase === "review") setRecorderPhase("idle");
        return replayButton;
      }, true);
    })().catch(error => {
      playbackError = error;
      if (article) article.querySelector(".replay-speech").disabled = false;
    });
  };
  try {
    const result = await generateLiveReply(text, evidence, event => {
      if (event.type === "text") showReplyText(event.reply);
      if (event.type === "speech") { diagnostics.server = event.timing; startReply(event.reply); }
      if (event.type === 'speech-append') {
        showReplyText(event.reply);
        pendingVoiceSegments.push(...event.reply.voiceUrls);spokenVoiceUrls.push(...event.reply.voiceUrls);
        playlistFinal=event.final===true;
        voiceAudioByText.set(normalizeSpeech(event.reply.en),[...spokenVoiceUrls]);
        flushVoiceSegments();
      }
      if (event.type === "translation") applyTranslation(event.zh);
      if (event.type === "expression") {
        diagnostics.expressionReceivedMs = Math.round(performance.now() - startedAt);
        applyExpression(event.expression);
      }
      if (event.type === "feedback") {
        diagnostics.feedbackReceivedMs = Math.round(performance.now() - startedAt);
        pendingFeedback = event.feedback;
        if (latestReply) latestReply.feedback = event.feedback;
        renderTurnFeedback(article, { ...latestReply, feedback: event.feedback }, text);
      }
    });
    diagnostics.completeReceivedMs = Math.round(performance.now() - startedAt);
    if (result.reply?.feedback && diagnostics.feedbackReceivedMs == null) diagnostics.feedbackReceivedMs = diagnostics.completeReceivedMs;
    diagnostics.server = result.timing || diagnostics.server;
    diagnostics.model = result.model;
    diagnostics.effort = result.effort;
    diagnostics.memorySources=result.reply?.memorySources||[];
    const reply = result.reply;
    if (latestReply && normalizeSpeech(latestReply.en) !== normalizeSpeech(reply.en)) throw new Error("最终回复发生变化，暂不更新修改建议");
    startReply(reply);
    await playbackJob;
    if (playbackError) throw playbackError;
    if (article) {
      renderTurnFeedback(article, latestReply, text);
      const replayButton = article.querySelector(".replay-speech");
      replayButton.dataset.translation = reply.zh || "";
      replayButton.dataset.expression = JSON.stringify(normalizeExpression(reply.expression));
      // Late metadata enriches this playing reply without replaying it, opening
      // the mouth again, or changing a different reply selected by the user.
      if (state.speaking && state.activeReplayButton === replayButton) {
        setSubtitles(reply.en, reply.zh);
      }
      applyExpression(reply.expression || pendingExpression);
      elements.chat.scrollTop = elements.chat.scrollHeight;
    }
    if (result.learner) renderLearnerSnapshot(result.learner, false);
    if (result.lesson) syncLessonClockProgress(result.lesson);
  } catch (error) {
    // The audio may have started before the metadata connection failed. Never
    // claim the turn was unsent, clear its bubble, or replay it automatically.
    if (playbackJob) await playbackJob;
    const incompleteVoice=progressivePlayback && !playlistFinal;
    if(incompleteVoice){playlistFinal=true;flushVoiceSegments();elements.messageInput.value=text;}
    if (article) article.querySelector(".replay-speech").disabled = false;
    if (article && !latestReply?.feedback && !latestReply?.note) {
      renderTurnFeedback(article, { note: "修改建议暂未完成，请稍后重试；这不表示你的表达没有问题。" }, text);
    }
    if (!state.speaking) setAvatarState("listening", "在听你说");
    toast(incompleteVoice
      ? `已播放开头，后续回复暂未完成：${error.message}。原问题已保留，可继续重试。`
      : diagnostics.audioStartedMs !== null
      ? `回复已播放，正文与课堂上下文已保留；附加建议未完成：${error.message}。不会重复发送。`
      : `本轮回复未能播放：${error.message}。${article ? "文字已保留，可点击 ▶ 重试语音。" : "你的输入已保留。"}`, 6500);
  } finally {
    state.replyPending = false;
    elements.sendButton.disabled = false;
    elements.messageInput.disabled = state.recordingPhase === "transcribing";
  }
}

function renderPlan(plan, source = "本地示例计划") {
  state.plan = plan;
  elements.lessonSource.textContent = source;
  elements.lessonPlan.innerHTML = "";
  for (const [index, segment] of plan.segments.entries()) {
    const row = document.createElement("div");
    row.className = "lesson-segment";
    row.title = segment.activity || "";
    row.innerHTML = `<b>${index + 1}</b><div><strong></strong><span></span></div><em>${segment.minutes}m</em>`;
    row.querySelector("strong").textContent = segment.title;
    row.querySelector("span").textContent = segment.activity;
    elements.lessonPlan.append(row);
  }
}

async function checkCodex() {
  elements.codexStatus.classList.remove("online", "error");
  elements.codexStatus.querySelector("span").textContent = "正在检测…";
  try {
    const response = await apiFetch("/api/model/status", {headers:{'X-Emilia-Settings':'1'}});
    const status = await response.json();
    if (status.mode === 'api') {
      elements.codexStatus.classList.add(status.configured ? 'online' : 'error');
      elements.codexStatus.querySelector('span').textContent = status.configured?`API · ${status.model}`:'API · 待配置';
      elements.codexStatus.title = '当前为 API 配置；点击模型设置可测试实际连接或切回 Codex';
    } else if (status.authenticated && status.authMode === "chatgpt") {
      elements.codexStatus.classList.add("online");
      elements.codexStatus.querySelector("span").textContent = `Codex 已连接 · ${status.planType || "会员"}`;
      toast("已检测到本机 ChatGPT/Codex 登录。不会读取或展示登录凭据。");
    } else if (status.available) {
      elements.codexStatus.classList.add("error");
      elements.codexStatus.querySelector("span").textContent = "Codex 未登录会员";
      toast(status.error || "Codex 可用，但当前不是 ChatGPT 会员登录模式。");
    } else {
      elements.codexStatus.classList.add("error");
      elements.codexStatus.querySelector("span").textContent = "未安装 Codex";
      toast("未检测到 Codex，本地 Demo 仍可完整体验。");
    }
  } catch {
    elements.codexStatus.classList.add("error");
    elements.codexStatus.querySelector("span").textContent = "检测失败";
    toast("无法连接本地 Demo 服务。");
  }
}

async function generateLessonWithCodex() {
  if (state.replyPending) return;
  state.replyPending = true;
  stopCurrentSpeech();
  setAvatarState("thinking", "后台备课中");
  elements.codexLessonButton.disabled = true;
  elements.codexLessonButton.textContent = "模型正在备课…";
  elements.lessonSource.textContent = "整理本节必要记忆，不读取全部历史…";
  try {
    const response = await apiFetch("/api/codex/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duration: Number(elements.lessonDuration.value),
        mode: elements.sessionMode.value,
        sessionId: chatSessionId
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "生成失败");
    renderPlan(result.lesson, `当前模型生成 · ${result.planType || result.provider || "AI"}`);
    toast(`备课完成：${result.lesson.title}`);
  } catch (error) {
    renderPlan(localPlans[Number(elements.lessonDuration.value)], "本地计划 · Codex 已降级");
    toast(`Codex 通道未完成：${error.message}`, 5000);
  } finally {
    state.replyPending = false;
    setAvatarState("listening", "在听你说");
    elements.codexLessonButton.disabled = false;
    elements.codexLessonButton.textContent = "用当前模型备课";
  }
}

function setRecorderPhase(phase) {
  state.recordingPhase = phase;
  const labels = {
    idle: "开始说话",
    recording: "结束录音",
    transcribing: "正在识别",
    review: "重新录音"
  };
  const placeholders = {
    idle: "也可以先打字回答…",
    recording: "正在录音…结束后才会进行本地识别",
    transcribing: "本地 Whisper 正在识别…",
    review: "可修改识别结果，确认无误后点击 ↑ 发送"
  };
  elements.micButton.classList.toggle("listening", phase === "recording");
  elements.micButton.classList.toggle("processing", phase === "transcribing");
  elements.micButton.classList.toggle("review", phase === "review");
  elements.micButton.querySelector(".mic-label").textContent = labels[phase];
  elements.micButton.setAttribute("aria-label", labels[phase]);
  elements.discardSpeechButton.hidden = phase === "idle";
  elements.messageInput.placeholder = placeholders[phase];
  elements.messageInput.disabled = state.replyPending || phase === "recording" || phase === "transcribing";
  elements.sendButton.disabled = state.replyPending || phase === "recording" || phase === "transcribing";
}

function closeRecordingStream() {
  state.mediaStream?.getTracks().forEach(track => track.stop());
  state.mediaStream = null;
}

function encodePcmWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function convertRecordingToWav(recording) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器无法解码录音");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const outputRate = 16_000;
    const outputLength = Math.max(1, Math.round(decoded.duration * outputRate));
    // Use the browser's band-limited resampler; linear downsampling aliases
    // high-frequency microphone noise into the speech band.
    const offline = new OfflineAudioContext(1, outputLength, outputRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodePcmWav(rendered.getChannelData(0), outputRate);
  } finally {
    await context.close().catch(() => {});
  }
}

async function transcribeRecording(recording, generation) {
  if (generation !== state.recordingGeneration) return;
  if (recording.size < 600) {
    setRecorderPhase("idle");
    toast("录音太短，没有发送任何内容。请再试一次。");
    return;
  }
  setRecorderPhase("transcribing");
  setAvatarState("thinking", "正在本地识别");
  try {
    const wav = await convertRecordingToWav(recording);
    if (generation !== state.recordingGeneration) return;
    const controller = new AbortController();
    state.transcriptionAbort = controller;
    const response = await apiFetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: controller.signal
    });
    const result = await response.json();
    if (generation !== state.recordingGeneration) return;
    if (!response.ok || !result.ok) throw new Error(result.error || "识别失败");
    const transcript = String(result.text || "").trim();
    if (!transcript) {
      setRecorderPhase("idle");
      setAvatarState("listening", "在听你说");
      toast("没有识别到英文内容，没有自动发送。可以重新录音或打字。");
      return;
    }
    elements.messageInput.value = transcript;
    state.inputMeta = {
      source: "voice",
      durationSeconds: Number(result.duration) || Math.max(1, (Date.now() - state.recordingStartedAt) / 1000),
      // Neither fixed-language probability nor uncalibrated token probability
      // is evidence of a learner's proficiency or transcription accuracy.
      asrConfidence: null
    };
    setRecorderPhase("review");
    setAvatarState("listening", "等你确认后发送");
    elements.messageInput.focus();
    const reviewHint = result.reviewRecommended
      ? `有听不确定的词，请核对：${(result.uncertainWords || []).join("、")}。` : "";
    // Successful recognition already moves into the editable review state.
    // Do not interrupt conversation with a model/timing completion toast.
    if (reviewHint) toast(reviewHint, 6500);
  } catch (error) {
    if (generation !== state.recordingGeneration || error.name === "AbortError") return;
    setRecorderPhase("idle");
    setAvatarState("listening", "在听你说");
    toast(`本地识别失败：${error.message}。没有发送任何内容。`, 5500);
  } finally {
    if (generation === state.recordingGeneration) state.transcriptionAbort = null;
  }
}

function stopRecording() {
  if (state.recordingPhase !== "recording") return;
  window.clearTimeout(state.recordingTimer);
  state.recordingTimer = null;
  setRecorderPhase("transcribing");
  setAvatarState("thinking", "正在整理录音");
  if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
}

function discardRecording() {
  if (state.recordingPhase === "idle") return;
  state.recordingGeneration += 1;
  state.transcriptionAbort?.abort();
  state.transcriptionAbort = null;
  window.clearTimeout(state.recordingTimer);
  state.recordingTimer = null;
  const recorder = state.mediaRecorder;
  state.mediaRecorder = null;
  if (recorder?.state === "recording") recorder.stop();
  closeRecordingStream();
  state.audioChunks = [];
  elements.messageInput.value = "";
  state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
  setRecorderPhase("idle");
  setAvatarState("listening", "在听你说");
  toast("本次录音和识别文本已删除，没有发送。", 3800);
}

async function startRecording() {
  if(state.temporaryRecovery){toast('请先继续或放弃上次聊天。');return;}
  if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
    toast("当前浏览器不支持录音，请使用新版 Edge/Chrome 或先打字体验。", 5000);
    return;
  }
  if (state.replyPending || state.recordingPhase === "transcribing") return;
  const generation = ++state.recordingGeneration;
  setRecorderPhase("transcribing");
  setAvatarState("thinking", "正在连接麦克风");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    if (generation !== state.recordingGeneration) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.mediaStream = stream;
    state.audioChunks = [];
    elements.messageInput.value = "";
    state.inputMeta = { source: "voice", durationSeconds: null, asrConfidence: null };
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
    state.mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", event => {
      if (event.data.size && generation === state.recordingGeneration) state.audioChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const chunks = state.audioChunks;
      state.audioChunks = [];
      state.mediaRecorder = null;
      closeRecordingStream();
      if (generation !== state.recordingGeneration) return;
      void transcribeRecording(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), generation);
    }, { once: true });
    recorder.addEventListener("error", event => {
      if (generation !== state.recordingGeneration) return;
      discardRecording();
      toast(`录音失败：${event.error?.message || "浏览器录音器异常"}`, 5000);
    }, { once: true });
    state.speechGeneration += 1;
    stopCurrentSpeech();
    finishSpeech(state.speechGeneration);
    recorder.start(250);
    state.recordingStartedAt = Date.now();
    setRecorderPhase("recording");
    setAvatarState("listening", "专心听你说");
    const recordingLimitSeconds = state.lessonActive || state.assessment.active ? 300 : 180;
    state.recordingTimer = window.setTimeout(() => {
      stopRecording();
      toast(`已到 ${recordingLimitSeconds / 60} 分钟安全上限，正在识别；仍然不会自动发送。`, 5000);
    }, recordingLimitSeconds * 1_000);
  } catch (error) {
    if (generation !== state.recordingGeneration) return;
    closeRecordingStream();
    setRecorderPhase("idle");
    const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
    toast(denied ? "麦克风权限不可用，请允许权限或改用文字输入。" : `无法开始录音：${error.message}`, 5000);
  }
}

function setupRecorder() {
  elements.micButton.addEventListener("click", () => {
    if (state.recordingPhase === "recording") stopRecording();
    else if (state.recordingPhase === "transcribing") toast("本地模型正在识别；可点“删除本次”取消。");
    else void startRecording();
  });
  elements.discardSpeechButton.addEventListener("click", discardRecording);
  elements.messageInput.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.recordingPhase !== "idle") discardRecording();
  });
  setRecorderPhase("idle");
}

function setPronunciationPhase(phase) {
  state.pronunciation.phase = phase;
  const labels = {
    idle: "开始朗读",
    recording: "结束朗读",
    ready: "重新朗读",
    analyzing: "正在分析…"
  };
  elements.pronunciationRecordButton.textContent = labels[phase];
  elements.pronunciationRecordButton.disabled = phase === "analyzing";
  elements.pronunciationRecordButton.classList.toggle("recording", phase === "recording");
  elements.pronunciationDiscardButton.hidden = !["recording", "ready"].includes(phase);
  elements.pronunciationAnalyzeButton.disabled = phase !== "ready";
}

async function loadPronunciationPassage() {
  try {
    const response = await apiFetch("/api/pronunciation/passage", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "朗读文本读取失败");
    state.pronunciation.passage = result.passage;
    elements.pronunciationPassageTitle.textContent = `${result.passage.title} · ${result.passage.text.split(/\s+/).length} words`;
    elements.pronunciationPassage.textContent = result.passage.text;
    elements.pronunciationTimer.textContent = `目标约 ${result.passage.targetSeconds} 秒`;
    elements.pronunciationTimerBar.style.width = "0%";
    elements.pronunciationConfidence.textContent = result.profile?.status === "stable" ? "已完成跨日复测" : "仍需后续采样";
    if (result.profile?.lastReport) renderPronunciationReport(null, result.profile);
  } catch (error) {
    elements.pronunciationPassageTitle.textContent = "朗读文本暂不可用";
    elements.pronunciationPassage.textContent = error.message;
    elements.pronunciationRecordButton.disabled = true;
  }
}

function closePronunciationStream() {
  state.pronunciation.mediaStream?.getTracks().forEach(track => track.stop());
  state.pronunciation.mediaStream = null;
}

function stopPronunciationRecording() {
  if (state.pronunciation.phase !== "recording") return;
  clearTimeout(state.pronunciation.timer);
  clearInterval(state.pronunciation.tick);
  state.pronunciation.timer = null;
  state.pronunciation.tick = null;
  if (state.pronunciation.mediaRecorder?.state === "recording") state.pronunciation.mediaRecorder.stop();
}

function discardPronunciationRecording(showToast = true) {
  state.pronunciation.generation += 1;
  clearTimeout(state.pronunciation.timer);
  clearInterval(state.pronunciation.tick);
  const recorder = state.pronunciation.mediaRecorder;
  state.pronunciation.mediaRecorder = null;
  if (recorder?.state === "recording") recorder.stop();
  closePronunciationStream();
  state.pronunciation.chunks = [];
  state.pronunciation.recording = null;
  elements.pronunciationTimerBar.style.width = "0%";
  elements.pronunciationTimer.textContent = `目标约 ${state.pronunciation.passage?.targetSeconds || 60} 秒`;
  setPronunciationPhase("idle");
  setAvatarState("listening", "在听你说");
  if (showToast) toast("本次发音样本已删除，没有保存。", 3800);
}

async function startPronunciationRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
    toast("当前浏览器不支持录音，请使用新版 Edge 或 Chrome。", 5000);
    return;
  }
  if (!state.pronunciation.passage || state.recordingPhase !== "idle") {
    toast("请先结束聊天输入的录音，再开始长文本采样。", 4500);
    return;
  }
  discardPronunciationRecording(false);
  const generation = ++state.pronunciation.generation;
  setAvatarState("thinking", "正在连接麦克风");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      video: false
    });
    if (generation !== state.pronunciation.generation) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.pronunciation.mediaStream = stream;
    state.pronunciation.chunks = [];
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 96_000 } : undefined);
    state.pronunciation.mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", event => {
      if (event.data.size && generation === state.pronunciation.generation) state.pronunciation.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const chunks = state.pronunciation.chunks;
      state.pronunciation.chunks = [];
      state.pronunciation.mediaRecorder = null;
      closePronunciationStream();
      if (generation !== state.pronunciation.generation) return;
      state.pronunciation.recording = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const elapsed = Math.max(1, (Date.now() - state.pronunciation.startedAt) / 1000);
      elements.pronunciationTimer.textContent = `已采样 ${elapsed.toFixed(1)} 秒 · 可删除或分析`;
      setPronunciationPhase("ready");
      setAvatarState("celebrating", "朗读已完成");
    }, { once: true });
    recorder.addEventListener("error", event => {
      if (generation !== state.pronunciation.generation) return;
      discardPronunciationRecording(false);
      toast(`发音录音失败：${event.error?.message || "录音器异常"}`, 5000);
    }, { once: true });
    state.speechGeneration += 1;
    stopCurrentSpeech();
    recorder.start(250);
    state.pronunciation.startedAt = Date.now();
    setPronunciationPhase("recording");
    setAvatarState("listening", "正在听你朗读");
    state.pronunciation.tick = setInterval(() => {
      const elapsed = (Date.now() - state.pronunciation.startedAt) / 1000;
      elements.pronunciationTimerBar.style.width = `${Math.min(100, elapsed / 90 * 100)}%`;
      elements.pronunciationTimer.textContent = `已朗读 ${Math.floor(elapsed)} 秒 · 点击结束后再分析`;
    }, 250);
    state.pronunciation.timer = setTimeout(() => {
      stopPronunciationRecording();
      toast("已到 90 秒上限，录音已停止；点击“分析本次”开始处理。", 5000);
    }, 90_000);
  } catch (error) {
    closePronunciationStream();
    setPronunciationPhase("idle");
    setAvatarState("listening", "在听你说");
    toast(error.name === "NotAllowedError" ? "麦克风权限不可用。" : `无法开始朗读：${error.message}`, 5000);
  }
}

async function analyzePronunciationRecording() {
  const recording = state.pronunciation.recording;
  const passage = state.pronunciation.passage;
  if (!recording || !passage || state.pronunciation.phase !== "ready") return;
  setPronunciationPhase("analyzing");
  setAvatarState("thinking", "正在分析整段发音");
  elements.pronunciationReport.hidden = false;
  elements.pronunciationReport.innerHTML = "<p class=\"pronunciation-working\">正在比对文本、语速、停顿与语调变化。长文本会比普通识别稍慢…</p>";
  try {
    const wav = await convertRecordingToWav(recording);
    const response = await apiFetch(`/api/pronunciation/analyze?passageId=${encodeURIComponent(passage.id)}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "发音分析失败");
    state.pronunciation.recording = null;
    renderLearnerSnapshot(result, false);
    renderPronunciationReport(result.report, result.profile?.pronunciationProfile);
    setPronunciationPhase("idle");
    setAvatarState("celebrating", "分析完成");
    toast(`发音分析完成：本次 ${Math.round(result.report.durationSeconds)} 秒；已保存统计摘要，录音和逐字稿已删除。`, 6000);
    await loadPronunciationPassage();
  } catch (error) {
    setPronunciationPhase("ready");
    setAvatarState("listening", "样本仍待分析");
    elements.pronunciationReport.innerHTML = `<p class="pronunciation-working error">${error.message}</p>`;
    toast(`发音分析未完成：${error.message}`, 5500);
  }
}

elements.avatarStage.addEventListener("pointermove", event => {
  if (!state.motion) return;
  const rect = elements.avatarStage.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width - .5;
  const ny = (event.clientY - rect.top) / rect.height - .5;
  sendRigState({
    ParamAngleX: nx * 10,
    ParamAngleY: -ny * 7,
    ParamBodyAngleX: nx * 2,
    ParamEyeBallX: nx * .55,
    ParamEyeBallY: -ny * .34
  });
});

elements.avatarStage.addEventListener("pointerleave", () => {
  sendRigState({ ParamAngleX: 0, ParamAngleY: 0, ParamBodyAngleX: 0, ParamEyeBallX: 0, ParamEyeBallY: 0 });
});

function scheduleBlink() {
  window.setTimeout(() => {
    if (state.motion) {
      sendRigState({ ParamEyeLOpen: .52, ParamEyeROpen: .52 });
      window.setTimeout(() => state.motion && sendRigState({ ParamEyeLOpen: .02, ParamEyeROpen: .02 }), 48);
      window.setTimeout(() => state.motion && sendRigState({ ParamEyeLOpen: .02, ParamEyeROpen: .02 }), 92);
      window.setTimeout(() => state.motion && sendRigState({ ParamEyeLOpen: .62, ParamEyeROpen: .62 }), 132);
      window.setTimeout(() => sendRigState({ ParamEyeLOpen: 1, ParamEyeROpen: 1 }), 178);
    }
    scheduleBlink();
  }, 3300 + Math.random() * 2200);
}

setInterval(() => {
  if (!state.motion) return;
  const now = performance.now() / 1000;
  sendRigState({
    ParamBreath: .5 + Math.sin(now * 1.45) * .34,
    ParamAngleZ: Math.sin(now * .42) * .65,
    ParamBodyAngleZ: Math.sin(now * .36) * .22
  });
}, 90);

elements.subtitleToggle.addEventListener("change", () => {
  syncSubtitleVisibility();
});
elements.translationToggle.checked = localStorage.getItem("emilia.translation.enabled") !== "false";
elements.translationToggle.addEventListener("change", () => {
  localStorage.setItem("emilia.translation.enabled", String(elements.translationToggle.checked));
  syncSubtitleVisibility();
});
elements.translationToggle.title='关闭后，新回复不再生成中文翻译；已有翻译仅隐藏。';
$('#resumeTemporaryChat').onclick=()=>recoverTemporaryChat('resume');
$('#discardTemporaryChat').onclick=()=>recoverTemporaryChat('discard');
syncSubtitleVisibility();

elements.motionToggle.addEventListener("click", () => {
  state.motion = !state.motion;
  elements.motionToggle.textContent = `动作：${state.motion ? "开" : "关"}`;
  if (!state.motion) {
    sendRigState({
      ParamAngleX: 0,
      ParamAngleY: 0,
      ParamAngleZ: 0,
      ParamBodyAngleX: 0,
      ParamBodyAngleY: 0,
      ParamBodyAngleZ: 0,
      ParamEyeBallX: 0,
      ParamEyeBallY: 0,
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamBreath: .5
    });
  }
  sendRigState();
});

elements.themeToggle.addEventListener("click", () => document.body.classList.toggle("warm"));
elements.chat.addEventListener("click", event => {
  const button = event.target.closest(".replay-speech");
  if (!button) return;
  speak(button.dataset.speech || "", button.dataset.translation || "", button);
});
elements.sendButton.addEventListener("click", () => submitAnswer(elements.messageInput.value));
elements.messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") submitAnswer(elements.messageInput.value);
});
elements.messageInput.addEventListener("input", () => {
  if (state.recordingPhase === "idle") {
    state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
  }
});
elements.quickReplies.addEventListener("click", event => {
  if (event.target.tagName === "BUTTON") {
    state.inputMeta = { source: "typed", durationSeconds: null, asrConfidence: null };
    submitAnswer(event.target.textContent);
  }
});
elements.lessonDuration.addEventListener("change", () => {
  const duration = Number(elements.lessonDuration.value);
  renderPlan(localPlans[duration]);
  document.querySelector(".lesson-card h2").textContent = `今天的 ${duration} 分钟`;
});
elements.codexStatus.addEventListener("click", checkCodex);
initModelSettings({
  canChange: () => !state.replyPending && !['recording','transcribing'].includes(state.recordingPhase),
  onSaved: message => { if(message) toast(message); else { toast('模型配置已应用；下一轮使用新配置，课堂和记忆保留。'); void checkCodex(); } }
});
void checkCodex();
elements.codexLessonButton.addEventListener("click", generateLessonWithCodex);
elements.assessmentButton.addEventListener("click", beginAssessment);
elements.assessmentReportButton.addEventListener("click", () => {
  const report = state.learnerProfile?.latestAssessmentReport;
  if (!report?.items?.length) {
    toast("暂时还没有可查看的逐段反馈。", 4200);
    return;
  }
  renderAssessmentFeedback(report.items);
  toast("已把最近一次测评的逐段修改重新放到对话区。", 4200);
});
initMemoryUI({ sessionId: chatSessionId,
  canChange: () => !state.replyPending && !state.temporaryRecovery && !state.assessment.active && state.recordingPhase !== 'recording',
  isLessonActive: () => state.lessonActive,
  finishLesson: () => finishCurrentLesson(),
  setBusy: value => { state.replyPending = value; },
  onFinished: result => renderLearnerSnapshot(result, false)
});
initVocabularyHelper({ sessionId: chatSessionId });
elements.recoverInterruptedLesson.addEventListener('click', () => recoverInterruptedLesson('resume'));
elements.discardInterruptedLesson.addEventListener('click', () => recoverInterruptedLesson('discard'));
elements.resetProfileButton.addEventListener("click", resetLearnerProfile);
elements.startLesson.addEventListener("click", async () => {
  if(state.temporaryRecovery){toast('请先继续或放弃上次聊天。');return;}
  if (state.replyPending || state.assessment.active) return;
  state.replyPending = true;
  elements.startLesson.disabled = true;
  stopCurrentSpeech();
  setAvatarState("thinking", "正在读取长期记忆并编译本节课");
  try {
    const response = await apiFetch("/api/lesson/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duration: Number(elements.lessonDuration.value),
        mode: elements.sessionMode.value,
        sessionId: chatSessionId
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "课前编译失败");
    renderPlan(result.plan, result.compilationProvider === 'local-fallback' ? '模型备课未完成 · 本地备用计划' : '长期记忆已编译 · 本节短上下文');
    renderLearnerSnapshot(result, false);
    if (result.warning) toast('本次采用备用计划：' + result.warning, 7500);
    const question = result.plan.openingQuestion;
    const voiceUrl = await ensureRecordedVoice(question);
    const article = addMessage(
      "coach",
      question,
      `本课课题：${result.sessionBrief.focus[0]} · 训练重点：${result.sessionBrief.focus[1]}`,
      "正式训练开始"
    );
    const replayButton = article.querySelector(".replay-speech");
    replayButton.dataset.translation = "课程开始。请自然回答，不需要背模板。";
    startLessonClock(result.profile.currentSession, result.plan, result.lesson);
    await playRecordedVoice(voiceUrl, question, replayButton.dataset.translation, replayButton);
    state.turn = 3;
    toast("本节短上下文已生成。已完成的课堂轮次会临时保存以便恢复，归档后删除；长期记忆在课后核对更新。", 6500);
  } catch (error) {
    setAvatarState("listening", "在听你说");
    toast(`课前准备失败：${error.message}`, 6000);
  } finally {
    state.replyPending = false;
    elements.startLesson.disabled = false;
  }
});
function renderLessonArchiveSummary(result) {
  const summary = result?.summary;
  if (!summary) return;
  const card = document.createElement("article");
  card.className = "lesson-archive-summary";
  const title = document.createElement("h3");
  title.textContent = "本节课已总结并写入记忆";
  const topic = document.createElement("p");
  topic.textContent = `课题：${(summary.focus || []).join(" · ") || "本节口语训练"}`;
  const evidence = document.createElement("p");
  evidence.textContent = `课堂证据：${summary.turnCount || 0} 轮，语音 ${summary.voiceTurns || 0} 轮，平均每次 ${summary.averageWords || 0} 词。`;
  const observation = document.createElement("p");
  const strengths = (summary.observedStrengths || []).join("、") || "本节没有形成足够稳定的新优势结论";
  const needs = (summary.observedNeeds || []).join("、") || "本节没有形成足够稳定的新问题结论";
  const mixed = (summary.mixedSignals || []).join("、");
  observation.textContent = `观察：优势信号—${strengths}；待巩固信号—${needs}${mixed ? `；本节表现有波动—${mixed}（暂不下结论）` : ""}。`;
  const next = document.createElement("p");
  next.textContent = `下节优先：${(summary.nextFocus || []).join("、") || "开课前根据长期记忆重新编译"}。`;
  const learning = summary.learning || result.learningUpdate?.summary;
  const learned = document.createElement("p");
  const introduced = (learning?.introduced || []).map(item => item.targetEn).filter(Boolean);
  const reviewed = (learning?.reviewed || []).map(item => `${item.targetEn}：${{
    transferred_in_session: "本课换语境用对，明后课再查",
    reinforced_same_day: "同日换语境用对，暂不算长期记住",
    recalled_independently: "独立想起",
    recalled_with_help: "提示后想起",
    forgotten: "下次耐心重学"
  }[item.outcome] || "已练习"}`);
  learned.textContent = introduced.length || reviewed.length
    ? `语言点：${[introduced.length ? `新学 ${introduced.join("、")}` : "", reviewed.length ? `复习 ${reviewed.join("；")}` : ""].filter(Boolean).join("；")}。`
    : "语言点：本节没有形成可可靠入账的新项目。";
  const memory = document.createElement("small");
  memory.textContent = result.memoryUpdate?.digest
    || "本节统计摘要已归档；没有可靠新证据的私人信息不会写入人物记忆。";
  card.append(title, topic, evidence, observation, learned, next, memory);
  elements.chat.append(card);
  elements.chat.scrollTop = elements.chat.scrollHeight;
}

async function finishCurrentLesson() {
  if (state.replyPending) return;
  state.replyPending = true;
  stopCurrentSpeech();
  setAvatarState("thinking", "正在总结并保存本节课");
  elements.finishLesson.disabled = true;
  elements.lessonClockFinish.disabled = true;
  try {
    const response = await apiFetch("/api/lesson/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: chatSessionId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "归档失败");
    renderLearnerSnapshot(result, false);
    renderLessonArchiveSummary(result);
    elements.sessionTitle.textContent = "先聊两句，再开始训练";
    const turns = result.summary?.turnCount || 0;
    const digest = result.memoryUpdate?.digest ? ` ${result.memoryUpdate.digest}` : "";
    const status = '教师与伙伴记忆已按来源核对；无可靠新证据的内容不写入。';
    toast(`本节已一次性归档：${turns} 轮对话；${status}${digest}`, 7000);
  } catch (error) {
    toast(`课程归档失败：${error.message}`, 5000);
  } finally {
    state.replyPending = false;
    setAvatarState("listening", "在听你说");
    elements.finishLesson.disabled = false;
    elements.lessonClockFinish.disabled = false;
  }
}

elements.finishLesson.addEventListener("click", finishCurrentLesson);
elements.lessonClockFinish.addEventListener("click", finishCurrentLesson);
elements.memoryInfo.addEventListener("click", () => {
  const memory = state.learnerSnapshot?.longMemory;
  const size = memory ? `当前约 ${memory.characters} 字，含 ${memory.assessmentEntries} 次测评与 ${memory.sessionEntries} 节课程。` : "";
  toast('长期记忆在结束后核对来源再维护。正式课堂的已完成对话临时保存用于恢复，归档或放弃后删除；闲聊的临时恢复记录在本机保留 24 小时。这些恢复记录不作为人物长期画像。', 9000);
});
elements.toolTriggers.forEach(button => button.addEventListener("click", () => openTool(button.dataset.tool)));
elements.drawerClose.addEventListener("click", closeTools);
elements.drawerBackdrop.addEventListener("click", closeTools);
$('#performancePreview').addEventListener('click', () => openTool('performance'));
$('#gestureButtons').addEventListener('click', event => {
  const button = event.target.closest('[data-gesture]');
  if (!button) return;
  if (state.replyPending || state.speaking || state.recordingPhase === 'recording') {
    toast('请等本轮发言结束后再预览动作，避免打断正在进行的交流。'); return;
  }
  if (!state.motion || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toast('动作已关闭或系统开启了减少动态效果，请先开启后再预览。'); return;
  }
  state.previewGesture = button.dataset.gesture;
  state.previewId += 1;
  const kind = { comfort: 'empathy', encourage: 'encouraging', celebrate: 'celebrating', think: 'curious', explain: 'curious' }[state.previewGesture] || 'neutral';
  state.avatarExpression = normalizeExpression({ kind, intensity: .65 });
  state.avatarExpressionId += 1;
  sendRigState(); closeTools();
  toast('动作预览：' + button.firstChild.textContent.trim(), 2600);
});
document.addEventListener("keydown", event => {
  if (document.querySelector('dialog[open]')) return; // Let the modal own focus and Escape.
  if (event.key === "Escape" && elements.toolDrawer.classList.contains("open")) closeTools();
  if (event.key === 'Tab' && elements.toolDrawer.classList.contains('open')) {
    const focusable = [...elements.toolDrawer.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')].filter(el => el.getClientRects().length);
    const first=focusable[0], last=focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
elements.pronunciationRecordButton.addEventListener("click", () => {
  if (state.pronunciation.phase === "recording") stopPronunciationRecording();
  else if (state.pronunciation.phase === "analyzing") toast("正在分析整段发音，请稍候。", 4000);
  else void startPronunciationRecording();
});
elements.pronunciationDiscardButton.addEventListener("click", () => discardPronunciationRecording());
elements.pronunciationAnalyzeButton.addEventListener("click", () => void analyzePronunciationRecording());

renderPlan(localPlans[30]);
elements.voiceRetryButton?.addEventListener('click', () => {
  const retry = state.pendingVoiceRetry;
  if (!retry || retry.token !== state.speechGeneration) return;
  void speak(retry.text, retry.translation, retry.replayButton);
});
void fetch('/api/health').then(response => response.json()).then(health => {
  const badge = $('#buildVersion');
  if (!badge) return;
  const revision = Number(health.uiRevision || 0);
  badge.title=`前端 ${UI_REVISION} · 后台 ${revision}`;
  badge.textContent = revision >= 18 ? 'V1.3' : `V1.3 UI · 后台 ${revision || '未标记'}`;
  if (health.previewOnly) {
    state.previewOnly = true;
    badge.textContent = 'V1.3 · 预览';
    $('.brand p').textContent = '新版聊天预览 · 不写入学习档案';
    badge.title = '可测试新版聊天、纠错和表情；此页不更改正式学习档案。旧课请在原页面结束并归档。';
    badge.addEventListener('click', () => toast(badge.title, 7500));
    renderSessionBrief(null);
    renderLessonRecovery(state.learnerSnapshot);
    for (const button of [elements.assessmentButton, elements.startLesson, elements.finishLesson,
      elements.resetProfileButton, elements.codexLessonButton, elements.pronunciationAnalyzeButton]) {
      button.disabled = true;
      button.title = badge.title;
    }
  }
  if (revision < 16) {
    badge.title = '当前后台尚未更新，新版对话反馈与情绪传递尚未生效。请先结束并归档旧课，再更新服务。';
    badge.style.color = '#996838';
    badge.addEventListener('click', () => toast(badge.title, 7500));
  }
}).catch(() => {
  const badge = $('#buildVersion');
  if (badge) badge.textContent = 'V1.3 · 后台未连接';
});
setupRecorder();
setPronunciationPhase("idle");
scheduleBlink();
void initializeConversation();
void loadPronunciationPassage();
elements.live2dFrame?.addEventListener("load", () => {
  sendRigState();
  window.setTimeout(() => sendRigState(), 250);
});
window.addEventListener("message", event => {
  if (event.source !== elements.live2dFrame?.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === "emilia:ready") {
    clearTimeout(avatarLoadTimeout); avatarLoadActivity.end(); sendRigState();
  } else if (event.data?.type === "emilia:error") {
    clearTimeout(avatarLoadTimeout); avatarLoadActivity.end("人物动作未能加载，暂时显示静态形象。请刷新重试。");
  }
});
if (elements.live2dFrame?.contentWindow?.avatarDiagnostics?.snapshot().ready) {
  clearTimeout(avatarLoadTimeout); avatarLoadActivity.end(); sendRigState();
}
window.addEventListener("pointerdown", () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  state.audioContext ||= new AudioContextClass();
  if (state.audioContext.state === "suspended") void state.audioContext.resume();
}, { once: true, capture: true });
