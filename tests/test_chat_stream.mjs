import assert from "node:assert/strict";
import { readChatResponse } from "../public/chat-stream.js";

const speech = { type: "speech", reply: { en: "That's lovely. What did you enjoy?", voiceUrl: "/voice.wav" } };
const complete = { type: "complete", ok: true, reply: { ...speech.reply, note: "用过去式描述已经发生的事情。" } };
const encode = new TextEncoder();
function streamResponse(chunks, delay = 0) {
  let canceled = false;
  return new Response(new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (canceled) return;
        controller.enqueue(typeof chunk === "string" ? encode.encode(chunk) : chunk);
      }
      if (!canceled) controller.close();
    },
    cancel() { canceled = true; }
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}
let events = [];
const payload = encode.encode(JSON.stringify(speech) + "\n" + JSON.stringify(complete));
const result = await readChatResponse(streamResponse(Array.from(payload, b => Uint8Array.of(b))), e => events.push(e));
assert.equal(result.reply.note, complete.reply.note);
assert.equal(events.length, 1);
assert.equal(events[0].type, "speech");

events = [];
const streaming = readChatResponse(streamResponse([JSON.stringify(speech) + "\n", JSON.stringify(speech) + "\n", JSON.stringify(complete) + "\n"], 40), e => events.push(e));
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(events.length, 1, "audio must be delivered before final metadata");
await streaming;
assert.equal(events.length, 1, "duplicates must not trigger replay");

await assert.rejects(() => readChatResponse(streamResponse([JSON.stringify(speech) + "\n"])), /中断/);
await assert.rejects(() => readChatResponse(streamResponse(['{"type":"error","error":"测试断线"}\n'])), /测试断线/);
await assert.rejects(() => readChatResponse(streamResponse(['{"type":"speech","reply":{"en":"中文","voiceUrl":"x"}}\n'])), /无效/);
await assert.rejects(() => readChatResponse(streamResponse(['{broken}\n'])), SyntaxError);
await assert.rejects(() => readChatResponse(new Response('{"ok":false,"error":"Unavailable"}', { status: 503 })), /Unavailable/);
const legacy = await readChatResponse(new Response(JSON.stringify({ ok: true, reply: speech.reply })));
assert.equal(legacy.reply.en, speech.reply.en);
const metadataIndependent = await readChatResponse(streamResponse([
  JSON.stringify(speech) + "\n",
  JSON.stringify({ type: 'complete', ok: true, reply: { ...speech.reply, zh: null, feedback: null }, metadataIncomplete: true }) + "\n"
]));
assert.equal(metadataIndependent.reply.en, speech.reply.en,
  'missing late metadata must not invalidate an already delivered spoken reply');
events = [];
const expression = { type:'expression', expression:{kind:'empathy', intensity:.8} };
const translation = { type:'translation', zh:'真好。你最喜欢什么？' };
const feedback = { type:'feedback', feedback:{status:'ok',original:'',revised:'',reasonZh:'表达清楚。'} };
await readChatResponse(streamResponse([expression, speech, translation, feedback, complete].map(e => JSON.stringify(e)+'\n')), e => events.push(e));
assert.deepEqual(events.map(e => e.type), ['expression','speech','translation','feedback']);
assert.deepEqual(events[0].expression, expression.expression);
assert.equal(events[2].zh, translation.zh);
assert.deepEqual(events[3].feedback, feedback.feedback);
console.log(JSON.stringify({ ok: true, utf8Chunks: true, earlyDelivery: true, lateTranslation: true, noDuplicate: true, incompleteStream: true, errorEvents: true, legacyJson: true }));

events=[];
const textEvent={type:'text',reply:{en:speech.reply.en}};
await readChatResponse(streamResponse([textEvent,textEvent,feedback,speech,complete].map(e=>JSON.stringify(e)+'\n')),e=>events.push(e));
assert.deepEqual(events.map(e=>e.type),['text','feedback','speech']);
await assert.rejects(()=>readChatResponse(streamResponse([textEvent,{...speech,reply:{...speech.reply,en:'Different text.'}}].map(e=>JSON.stringify(e)+'\n'))),/不一致/);
console.log(JSON.stringify({earlyText:true,textDeduplicated:true,voiceTextConsistency:true}));
