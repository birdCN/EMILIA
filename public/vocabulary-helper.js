const PARTS_OF_SPEECH = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', pronoun: '代词',
  preposition: '介词', conjunction: '连词', interjection: '感叹词', determiner: '限定词',
  phrase: '短语', 'noun phrase': '名词短语', 'verb phrase': '动词短语', 'phrasal verb': '短语动词',
  'adjective phrase': '形容词短语', 'adverb phrase': '副词短语', collocation: '搭配',
  idiom: '习语', expression: '表达', 'sentence pattern': '句型', 'sentence frame': '句式'
};
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

// This helper owns only its form, requests and one private Audio instance.
// It deliberately has no access to conversation or microphone state/helpers.
export function initVocabularyHelper({ sessionId }) {
  const get = id => document.getElementById(id);
  const trigger = get('openVocabularyHelper'), panel = get('vocabularyHelper');
  const input = get('vocabularyIntent'), form = get('vocabularyForm'), lookupButton = get('vocabularyLookup');
  const status = get('vocabularyStatus'), retry = get('vocabularyRetry'), resultBox = get('vocabularyResult');
  const termButton = get('vocabularyTerm'), pronounceButton = get('vocabularyPronounce');
  const audioStatus = get('vocabularyAudioStatus');
  let lookupPending = false, lookupGeneration = 0, audioGeneration = 0;
  let lookupAbort = null, pronunciationAbort = null, wordAudio = null;
  let currentResult = null, lastIntent = '', cachedVoiceUrl = '', pronunciationPending = false;

  function positionPanel() {
    if (panel.hidden) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const mobile = window.innerWidth <= 880;
    let top = mobile ? 14 : 92;
    let bottom = viewportHeight - (mobile ? 86 : 20);
    const composer = document.querySelector('.composer')?.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    if (composer && composer.bottom > 0 && composer.top < viewportHeight
      && composer.left < bounds.right && composer.right > bounds.left) {
      const above = composer.top - 12 - top;
      const below = bottom - composer.bottom - 12;
      if (above >= below && above > 80) bottom = composer.top - 12;
      else if (below > 80) top = composer.bottom + 12;
    }
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(100, bottom - top)}px`;
  }

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const setLookupPending = value => {
    lookupPending = value;
    lookupButton.disabled = value;
    lookupButton.textContent = value ? '正在找词…' : '帮我找词';
    form.setAttribute('aria-busy', String(value));
  };
  function setPronunciationState(phase = 'idle') {
    const loading = phase === 'loading', playing = phase === 'playing';
    pronunciationPending = loading;
    for (const button of [termButton, pronounceButton]) {
      button.setAttribute('aria-busy', String(loading));
      button.setAttribute('aria-pressed', String(playing));
    }
    pronounceButton.textContent = loading ? '…' : playing ? '■' : '▶';
    pronounceButton.setAttribute('aria-label', loading ? '取消单词发音加载' : playing ? '停止单词发音' : '播放单词发音');
    termButton.title = loading ? '点击取消加载' : playing ? '点击停止发音' : '点击听发音';
  }
  function stopWordAudio() {
    audioGeneration++;
    pronunciationAbort?.abort();
    pronunciationAbort = null;
    const audio = wordAudio;
    wordAudio = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setPronunciationState();
    audioStatus.textContent = '';
  }
  function close(returnFocus = true) {
    lookupGeneration++;
    lookupAbort?.abort();
    lookupAbort = null;
    setLookupPending(false);
    stopWordAudio();
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (!currentResult) setStatus('用中文描述你想表达的意思。');
    if (returnFocus) trigger.focus({ preventScroll: true });
  }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionPanel();
    input.focus({ preventScroll: true });
  }

  async function lookup(intent = input.value) {
    if (lookupPending || panel.hidden) return;
    const intentZh = clean(intent);
    if (!intentZh || intentZh.length > 240) {
      setStatus('请用 1–240 个字符描述你想表达的中文意思。', true);
      input.focus();
      return;
    }
    const generation = ++lookupGeneration;
    const controller = new AbortController();
    lookupAbort?.abort();
    lookupAbort = controller;
    lastIntent = intentZh;
    stopWordAudio();
    currentResult = null;
    cachedVoiceUrl = '';
    resultBox.hidden = true;
    retry.hidden = true;
    setLookupPending(true);
    setStatus('正在结合已发送的对话，找一个最贴切的词或短语…');
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    try {
      const response = await fetch('/api/vocabulary/lookup', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, intentZh }), signal: controller.signal });
      const payload = await response.json();
      if (generation !== lookupGeneration || panel.hidden) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || '这次找词没有完成。');
      const result = payload.result;
      if (result?.status === 'clarify') {
        setStatus(clean(result.clarificationZh) || '请再补充一点你想表达的意思，然后重新找词。');
        return;
      }
      if (result?.status !== 'ok' || !clean(result.termEn) || !clean(result.meaningZh) || !clean(result.exampleEn)) {
        throw new Error('找词结果不完整，请再试一次。');
      }
      currentResult = { termEn: clean(result.termEn) };
      termButton.textContent = currentResult.termEn;
      termButton.setAttribute('aria-label', `${currentResult.termEn}，点击听发音`);
      const part = clean(result.partOfSpeech);
      get('vocabularyPartOfSpeech').textContent = PARTS_OF_SPEECH[part.toLowerCase().replace(/[_-]/g, ' ')]
        || (/[\u3400-\u9fff]/u.test(part) ? part : '词语或短语');
      get('vocabularyMeaning').textContent = clean(result.meaningZh);
      get('vocabularyExample').textContent = clean(result.exampleEn);
      get('vocabularyReviewNote').textContent = clean(payload.reviewWarning)
        ? `${clean(payload.reviewWarning)} 查过不等于学会。`
        : payload.savedForReview
          ? '已加入后续课堂的少量复习；查过不等于学会。'
          : '查过不等于学会；本次未加入后续课堂复习。';
      resultBox.hidden = false;
      setStatus('可以把这个表达放进你自己的话里。点击英文或 ▶ 听发音。');
      positionPanel();
    } catch (error) {
      if (generation !== lookupGeneration || panel.hidden) return;
      setStatus(timedOut ? '找词等待超时，请稍后重试。' : (error.message || '找词暂未完成，请重试。'), true);
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (generation === lookupGeneration) {
        lookupAbort = null;
        setLookupPending(false);
      }
    }
  }

  async function pronounce() {
    if (!currentResult || panel.hidden) return;
    if (pronunciationPending || wordAudio) { stopWordAudio(); return; }
    const generation = ++audioGeneration;
    const term = currentResult.termEn;
    const controller = new AbortController();
    pronunciationAbort = controller;
    setPronunciationState('loading');
    audioStatus.textContent = '正在准备这个表达的发音…';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 55000);
    const isCurrent = () => generation === audioGeneration && !panel.hidden && currentResult?.termEn === term;
    try {
      if (!cachedVoiceUrl) {
        const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: term }), signal: controller.signal });
        const payload = await response.json();
        if (!isCurrent()) return;
        if (!response.ok || payload.ok === false || !clean(payload.url)) throw new Error(payload.error || '单词语音没有准备好。');
        cachedVoiceUrl = payload.url;
      }
      if (!isCurrent()) return;
      const audio = new Audio(cachedVoiceUrl);
      wordAudio = audio;
      const finish = error => {
        if (!isCurrent() || wordAudio !== audio) return;
        wordAudio = null;
        setPronunciationState();
        audioStatus.textContent = error ? '发音未能播放，点击英文或 ▶ 重试。' : '';
        if (error) cachedVoiceUrl = '';
      };
      audio.addEventListener('ended', () => finish(false), { once: true });
      audio.addEventListener('error', () => finish(true), { once: true });
      await audio.play();
      if (!isCurrent() || wordAudio !== audio) return;
      setPronunciationState('playing');
      audioStatus.textContent = '正在播放单词发音；再次点击可停止。';
    } catch (error) {
      if (!isCurrent()) return;
      stopWordAudio();
      audioStatus.textContent = timedOut ? '单词发音等待超时，点击英文或 ▶ 重试。'
        : `发音未能播放：${error.message || '请再试一次'}。点击英文或 ▶ 重试。`;
    } finally {
      clearTimeout(timeout);
      if (generation === audioGeneration) pronunciationAbort = null;
    }
  }

  trigger.addEventListener('click', () => panel.hidden ? open() : close());
  get('closeVocabularyHelper').addEventListener('click', () => close());
  form.addEventListener('submit', event => { event.preventDefault(); void lookup(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!lookupPending) form.requestSubmit();
    }
  });
  retry.addEventListener('click', () => void lookup(lastIntent));
  termButton.addEventListener('click', () => void pronounce());
  pronounceButton.addEventListener('click', () => void pronounce());
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  // No backdrop, focus trap or page inertness: conversation and microphone
  // controls remain available. Dismissal touches only this helper's work.
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  window.addEventListener('pagehide', () => close(false));
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, { passive: true });
  window.visualViewport?.addEventListener('resize', positionPanel);
}
