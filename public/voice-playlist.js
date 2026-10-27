// Reuse one media element and audio graph: segment boundaries must not reset
// the avatar, expression, speech token or the full English subtitle.
export function attachVoicePlaylist(audio, input, { isCurrent, onEnded, onError, play=()=>audio.play() }) {
  const progressive = input && !Array.isArray(input) && typeof input === 'object';
  const urls = progressive ? [...input.urls] : Array.isArray(input) ? [...input] : [input];
  let open = progressive && input.open === true, waiting = false, completed = false;
  if (!urls.length || urls.some(url => typeof url !== 'string' || !url)) throw new Error('语音分段地址无效');
  audio.voiceSegmentIndex = 0;
  const updateCount = () => { audio.voiceSegmentCount = open ? Infinity : urls.length; };
  updateCount();
  audio.src = urls[0];
  const advance = () => {
    if (!isCurrent()) return;
    if (audio.voiceSegmentIndex + 1 === urls.length) {
      waiting = true;
      if (!open && !completed) { completed = true; onEnded(); }
      return;
    }
    waiting = false;
    audio.src = urls[++audio.voiceSegmentIndex];
    void play().catch(error => { if (isCurrent()) onError(error); });
  };
  audio.onended = advance;
  const control = {
    append(next) {
      if (!open || !Array.isArray(next) || next.some(url => typeof url !== 'string' || !url)) throw new Error('语音续段无效');
      urls.push(...next); updateCount();
      if (waiting && audio.voiceSegmentIndex + 1 < urls.length) advance();
    },
    finish() { open = false; updateCount(); if (waiting) advance(); }
  };
  audio.voicePlaylist = control;
  return control;
}
