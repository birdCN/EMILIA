import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Exercise the production function without loading the DOM application,
// starting a server, contacting a provider, or synthesizing any audio.
const appPath = process.argv[2] || fileURLToPath(new URL('../public/app.js',import.meta.url));
const playlistPath = new URL('./voice-playlist.js', pathToFileURL(appPath));
const { attachVoicePlaylist } = await import(playlistPath.href);
const source = readFileSync(appPath, 'utf8');
const start = source.indexOf('async function playRecordedVoice(');
const end = source.indexOf('\nfunction streamingVoiceUrl(', start);
assert.ok(start >= 0 && end > start, 'production playback function must be located');
const playbackSource = source.slice(start, end);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function harness({ failures = 1, interrupt = false, rejectFirst = false, blockedAt = [], playlist = false } = {}) {
  const state = { speechGeneration: 0, audioNodes: [], speaking: false };
  const stats = { plays: 0, finishes: 0, started: 0, begins: 0, toasts: [] };
  const elements = { voiceRetryButton: { hidden: true, textContent: '' } };
  const replayButton = { dataset: { speech: 'A useful complete reply.' } };
  let originalAudio;
  class MockAudio {
    constructor() { this.src = ''; this.paused = true; originalAudio = this; }
    play() {
      const attempt = ++stats.plays;
      return new Promise((resolve, reject) => setTimeout(() => {
        if (blockedAt.includes(attempt)) {
          // Autoplay denial rejects play(), without a media loading error.
          reject(Object.assign(new Error('Synthetic autoplay denial'), { name: 'NotAllowedError' }));
          return;
        }
        if (attempt <= failures) {
          const error = Object.assign(new Error('Synthetic media load failure'), { name: 'NotSupportedError' });
          // A failed load produces both an error event and a rejected play
          // promise. They describe one failure and must consume one retry.
          if (rejectFirst) reject(error);
          this.onerror?.({ type: 'error' });
          if (!rejectFirst) reject(error);
          if (interrupt && attempt === 1) setTimeout(() => {
            state.speechGeneration++;
            state.activeAudio = null;
          }, 15);
        } else {
          this.paused = false;
          this.onplaying?.({ type: 'playing' });
          resolve();
        }
      }, 0));
    }
    pause() { this.paused = true; }
  }
  const context = {
    state, Audio: MockAudio, window: { setTimeout, clearTimeout }, setTimeout, clearTimeout,
    URL, location: { href: 'http://localhost/' }, VOICE_START_DEADLINE_MS: 450,
    activity: { begin: () => ({ end() {} }) },
    stopCurrentSpeech() { state.speechGeneration++; },
    attachVoicePlaylist,
    finishSpeech(token) {
      if (token !== state.speechGeneration) return;
      stats.finishes++; state.speaking = false; state.activeAudio = null;
    },
    beginSpeech(token) {
      if (token !== state.speechGeneration) return;
      stats.begins++; state.speaking = true;
    },
    normalizeSpeech: value => value,
    voiceAudioByText: new Map(), toast: value => stats.toasts.push(value), elements,
    driveAudioMouth() {}, animateMouth() {}, cancelAnimationFrame() {}, clearInterval() {}, sendRigState() {}
  };
  vm.createContext(context);
  vm.runInContext(playbackSource + '\nglobalThis.runPlayback = playRecordedVoice;', context);
  const urls = playlist ? ['/synthetic-first.wav', '/synthetic-tail.wav'] : '/synthetic.wav';
  const promise = context.runPlayback(urls, 'A useful complete reply.', '', replayButton, () => {
    stats.started++;
    return replayButton;
  }, true);
  // Attach immediately so an expected failure never becomes unhandled.
  const outcome = promise.then(value => ({ value }), error => ({ error }));
  return { state, stats, outcome, elements, replayButton, get audio() { return originalAudio; } };
}

for (const rejectFirst of [false, true]) {
  const test = harness({ failures: 1, rejectFirst });
  const result = await test.outcome;
  assert.equal(result.error, undefined, 'one load failure must recover automatically');
  assert.equal(result.value, true, 'playback resolves only after the successful retry starts');
  assert.equal(test.stats.plays, 2, 'event and rejection must schedule only one retry');
  assert.equal(test.stats.started, 1, 'onStarted fires once');
  assert.equal(test.stats.finishes, 0, 'recoverable failure must not finish speech');
  assert.equal(test.state.activeAudio, test.audio, 'successful audio remains tracked');
  assert.equal(test.state.speaking, true);
  await sleep(350);
  assert.equal(test.stats.plays, 2, 'no duplicate delayed retry after success');
}

{
  const test = harness({ failures: Infinity });
  const result = await test.outcome;
  assert.ok(result.error, 'exhausting two retries rejects once');
  assert.equal(test.stats.plays, 3, 'initial load plus exactly two retries');
  assert.equal(test.stats.started, 0);
  assert.equal(test.stats.finishes, 1, 'terminal failure finishes speech once');
  assert.equal(test.state.activeAudio, null);
  await sleep(350);
  assert.equal(test.stats.plays, 3, 'no late detached play after terminal failure');
  assert.equal(test.stats.finishes, 1);
}

{
  const test = harness({ failures: 1, interrupt: true });
  await sleep(350);
  assert.equal(test.stats.plays, 1, 'changing the token suppresses the scheduled retry');
  assert.equal(test.stats.started, 0);
  assert.equal(test.stats.finishes, 0, 'stale playback must not finish a newer speech token');
  await test.outcome;
  assert.equal(test.stats.plays, 1);
}

{
  const test = harness({ failures: 0, blockedAt: [1] });
  const result = await test.outcome;
  assert.equal(result.error?.name, 'NotAllowedError', 'initial autoplay denial retains its user-gesture error');
  assert.equal(test.stats.plays, 1, 'initial autoplay denial must not automatically loop');
  assert.equal(test.stats.finishes, 1);
  assert.equal(test.state.activeAudio, null);
  assert.equal(test.elements.voiceRetryButton.hidden, false, 'initial autoplay denial exposes the gesture retry button');
  assert.equal(test.state.pendingVoiceRetry?.replayButton, test.replayButton);
  await sleep(350);
  assert.equal(test.stats.plays, 1, 'initial autoplay denial stays idle until a user gesture');
}

{
  const test = harness({ failures: 0, blockedAt: [2], playlist: true });
  const result = await test.outcome;
  assert.equal(result.value, true, 'first segment starts successfully');
  assert.equal(test.state.speaking, true);
  test.audio.onended();
  await sleep(20);
  assert.equal(test.stats.plays, 2, 'the tail attempts automatic playback once');
  assert.equal(test.stats.started, 1, 'tail failure must not restart the turn');
  assert.equal(test.stats.finishes, 1, 'blocked tail finishes speech exactly once');
  assert.equal(test.state.speaking, false);
  assert.equal(test.state.activeAudio, null, 'blocked tail releases the tracked audio');
  assert.equal(test.elements.voiceRetryButton.hidden, false, 'blocked tail exposes a visible gesture retry');
  assert.equal(test.state.pendingVoiceRetry?.replayButton, test.replayButton, 'retry remains attached to the reply');
  await sleep(350);
  assert.equal(test.stats.plays, 2, 'blocked tail never loops automatically or plays detached audio');
  assert.equal(test.stats.finishes, 1);
}

console.log('PASS: audio recovery, bounded retries, interruption, and initial/tail autoplay denial with visible gesture retry');
