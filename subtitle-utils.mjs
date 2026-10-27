const ADDRESS_TRANSLATIONS = [
  [/\bmy\s+dear\b/gi, '亲爱的'],
  [/\bmy\s+darling\b/gi, '亲爱的'],
  [/\bdear\s+one\b/gi, '亲爱的'],
  [/\bsweetheart\b/gi, '亲爱的'],
  [/\bdarling\b/gi, '亲爱的']
];

export function cleanChineseSubtitle(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  for (const [pattern, replacement] of ADDRESS_TRANSLATIONS) text = text.replace(pattern, replacement);
  return text.replace(/\s+([，。！？；：、])/g, '$1').replace(/([，。！？；：、])\s+/g, '$1');
}

export function hasChineseSubtitle(value) {
  return /[\u3400-\u9fff]/u.test(cleanChineseSubtitle(value));
}

export function shouldRegenerateTranslation(sourceEnglish, spokenEnglish) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  return normalize(sourceEnglish) !== normalize(spokenEnglish);
}
