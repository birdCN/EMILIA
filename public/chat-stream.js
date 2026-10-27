// Audio-ready and final teaching metadata are separate events. Do not use the
// ordinary JSON fetch wrapper: consuming its whole body would reintroduce lag.
export async function readChatResponse(response, onEvent = () => {}) {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const result = await response.json();
    if (!response.ok || !result.ok || !result.reply?.en) throw new Error(result.error || "没有生成有效回复");
    return result;
  }
  if (!response.ok || !response.body) throw new Error("对话连接不可用");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", complete = null, speechSeen = false, textSeen = null;
  let spokenPrefix = null;
  const consume = line => {
    if (!line.trim() || complete) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "对话生成中断");
    if (event.type === "complete") {
      if (!event.ok || !event.reply?.en) throw new Error("没有生成有效回复");
      if (spokenPrefix && !event.reply.en.startsWith(spokenPrefix)) throw new Error('最终文字与已播放语音不一致');
      complete = event;
    } else if (event.type === "text") {
      if (typeof event.reply?.en !== "string" || !/[A-Za-z]/.test(event.reply.en) || /[\u3400-\u9fff]/u.test(event.reply.en)) throw new Error("文字回复格式无效");
      if (spokenPrefix && !event.reply.en.startsWith(spokenPrefix)) throw new Error('文字与已播放语音不一致');
      if (textSeen !== null) { if (textSeen === event.reply.en) return; if (!spokenPrefix || !event.reply.en.startsWith(textSeen)) throw new Error("文字回复发生变化"); }
      textSeen = event.reply.en;
      onEvent(event);
    } else if (event.type === "speech") {
      if (speechSeen) return;
      if (!event.reply?.en || !event.reply?.voiceUrl || /[\u3400-\u9fff]/u.test(event.reply.en)) throw new Error("语音回复格式无效");
      if (textSeen !== null && textSeen !== event.reply.en && !(event.reply.partial && textSeen.startsWith(event.reply.en))) throw new Error("文字与语音不一致");
      if (event.reply.partial) spokenPrefix = event.reply.en;
      speechSeen = true;
      onEvent(event);
    } else if (event.type === 'speech-append') {
      if (!spokenPrefix || !event.reply?.en?.startsWith(spokenPrefix) || !Array.isArray(event.reply.voiceUrls)
        || event.reply.voiceUrls.some(url => typeof url !== 'string' || !url)) throw new Error('续段文字与已播放语音不一致');
      onEvent(event);
    } else if (["status", "translation", "expression", "feedback"].includes(event.type)) onEvent(event);
  };
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("对话返回内容过长");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) consume(line);
      if (done) { consume(buffer); break; }
    }
    if (!complete) throw new Error("对话连接中断，修改建议尚未完成");
    return complete;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
