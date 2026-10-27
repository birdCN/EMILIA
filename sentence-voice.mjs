import { firstSpeechSentence, partialEnglishField } from './public/stream-fields.js';

export function speechChunks(value, limit=680) {
  const chunks=[];let remaining=String(value||'').trim();
  while(remaining) {
    let end=Math.min(limit,remaining.length);
    if(end<remaining.length)end=remaining.lastIndexOf(' ',end)>0?remaining.lastIndexOf(' ',end):end;
    chunks.push(remaining.slice(0,end));remaining=remaining.slice(end).trim();
  }
  return chunks;
}

// Speculation only creates audio. The caller must validate the authoritative
// English before publishing it. A rewritten reply never uses the old prefix.
export function createSentenceVoice(synthesize, { enabled = true } = {}) {
  let prefix = null, firstJob = null;
  const full = async en => {
    const chunks=speechChunks(en);
    if(chunks.length<=1)return synthesize(en);
    const firstJob=synthesize(chunks[0]);
    for(const tail of chunks.slice(1))void synthesize(tail).catch(()=>{});
    const first=await firstJob;
    return {...first,voiceUrls:[first.url,...chunks.slice(1).map(tail=>`/api/tts/stream?text=${encodeURIComponent(tail)}`)]};
  };
  return {
    preview() { return prefix && firstJob ? { text: prefix, ready: firstJob } : null; },
    observe(json) {
      if (!enabled) return;
      if (firstJob) return;
      prefix = firstSpeechSentence(partialEnglishField(json));
      if (prefix) firstJob = Promise.resolve(synthesize(prefix)).catch(() => null);
    },
    async finish(en) {
      if (!prefix || !en.startsWith(prefix) || !firstJob) return full(en);
      const rest = en.slice(prefix.length).trim();
      // Warm the same cached request the browser will make. Catch failure here:
      // the browser request can retry and must visibly fail rather than skip it.
      const tails = speechChunks(rest);
      for (const tail of tails) void synthesize(tail).catch(() => {});
      const first = await firstJob;
      if (!first?.url) return full(en);
      return { ...first, voiceUrls: rest
        ? [first.url, ...tails.map(tail => `/api/tts/stream?text=${encodeURIComponent(tail)}`)]
        : [first.url] };
    }
  };
}
