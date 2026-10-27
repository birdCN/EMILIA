import assert from 'node:assert/strict';
import { cleanChineseSubtitle, hasChineseSubtitle, shouldRegenerateTranslation } from '../subtitle-utils.mjs';

assert.equal(cleanChineseSubtitle('我很好， my dear——谢谢你关心。'), '我很好，亲爱的——谢谢你关心。');
assert.equal(cleanChineseSubtitle('晚安，my darling。'), '晚安，亲爱的。');
assert.equal(cleanChineseSubtitle('Emilia 会陪你练习 IELTS。'), 'Emilia 会陪你练习 IELTS。');
assert.equal(hasChineseSubtitle('my dear'), true, 'known address terms are repaired deterministically');
assert.equal(hasChineseSubtitle('我很好，my dear。'), true);
assert.equal(shouldRegenerateTranslation(
  'That makes this space real. What topic would you like?',
  'That makes this space real.'
), true, 'translation must be rebuilt when the question guard removes English');
assert.equal(shouldRegenerateTranslation('That makes this space real.', 'That makes this space real.'), false);

console.log(JSON.stringify({ ok: true, affectionateAddressTranslated: true, properNamesPreserved: true,
  rewrittenEnglishRealigned: true }));
