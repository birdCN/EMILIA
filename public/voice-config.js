// One source of truth for the chosen voice, including the fixed opening line.
// test_voice_config.mjs checks that the opening asset matches the server's key.
export const VOICE_PROFILE = Object.freeze({preset:'emilia_timbre_a', speed:.91, pitchSemitones:.4, cacheVersion:'kokoro-v1'});
export const GREETING_TEXT = 'Hi! Good to see you. How has your day been so far?';
export const GREETING_VOICE_URL = '/assets/voice/emilia-kokoro-a/0e5cbfbb07ba62f4dd1475af.wav';
