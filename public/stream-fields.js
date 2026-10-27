// Only speculate when English is the first field. No regex search through
// quoted values; incomplete escapes are held until the next delta.
export function partialEnglishField(source) {
  source=source.replace(/^\s*```(?:json)?\s*\n?/i,'');
  const match = source.match(/^\s*\{\s*"en"\s*:\s*"/);
  if (!match) return null;
  let raw = '';
  for (let i = match[0].length; i < source.length; i++) {
    const c = source[i];
    if (c === '"') break;
    if (c === '\\') {
      if (i + 1 >= source.length) break;
      if (source[i + 1] === 'u') {
        if (i + 5 >= source.length) break;
        raw += source.slice(i, i + 6); i += 5;
      } else { raw += c + source[++i]; }
    } else raw += c;
  }
  try { return JSON.parse('"' + raw + '"'); } catch { return null; }
}

export function firstSpeechSentence(text) {
  if (typeof text !== 'string' || /[\u3400-\u9fff]/u.test(text)) return null;
  for (const match of text.matchAll(/[.!?]+["”’')\]]*(?=\s+\S)/g)) {
    const prefix = text.slice(0, match.index + match[0].length).trim();
    if (prefix.length < 12) continue;
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)\.$/i.test(prefix)) continue;
    if (/\b[A-Z]\.$/.test(prefix)) continue;
    return prefix;
  }
  return null;
}

// Parse only complete TOP-LEVEL JSON fields in an append-only model stream.
// A field name quoted inside English, or braces inside a string, are not keys.
export function completedJsonField(source, wanted) {
  source=source.replace(/^\s*```(?:json)?\s*\n?/i,'');
  let pos = 0;
  const whitespace = () => { while (/\s/.test(source[pos] || "") && pos < source.length) pos++; };
  const endString = start => {
    let escape = false;
    for (let i = start + 1; i < source.length; i++) {
      if (escape) { escape = false; continue; }
      if (source[i] === "\\") { escape = true; continue; }
      if (source[i] === '"') return i + 1;
    }
    return -1;
  };
  whitespace();
  if (source[pos++] !== "{") return null;
  while (pos < source.length) {
    whitespace();
    if (source[pos] !== '"') return null;
    const keyEnd = endString(pos);
    if (keyEnd < 0) return null;
    let key;
    try { key = JSON.parse(source.slice(pos, keyEnd)); } catch { return null; }
    pos = keyEnd; whitespace();
    if (source[pos++] !== ":") return null;
    whitespace(); const start = pos;
    if (source[pos] === '"') {
      pos = endString(pos);
      if (pos < 0) return null;
    } else if (source[pos] === "{" || source[pos] === "[") {
      let depth = 0;
      for (; pos < source.length; pos++) {
        if (source[pos] === '"') {
          const end = endString(pos);
          if (end < 0) return null;
          pos = end - 1;
        } else if (source[pos] === "{" || source[pos] === "[") depth++;
        else if (source[pos] === "}" || source[pos] === "]") {
          if (--depth === 0) { pos++; break; }
        }
      }
      if (depth) return null;
    } else {
      while (pos < source.length && !/[,}]/.test(source[pos])) pos++;
      if (pos === source.length) return null;
    }
    if (key === wanted) {
      try { return JSON.parse(source.slice(start, pos)); } catch { return null; }
    }
    whitespace();
    if (source[pos++] !== ",") return null;
  }
  return null;
}
