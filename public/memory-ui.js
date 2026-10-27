const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
export function initMemoryUI({ sessionId, canChange, isLessonActive, finishLesson, setBusy, onFinished }) {
  const dialog = document.querySelector('#memoryDialog');
  const list = dialog.querySelector('#maintainedMemoryList');
  const status = dialog.querySelector('#memoryStatus');
  const summary = dialog.querySelector('#memorySummary');
  const tabs = [...dialog.querySelectorAll('[data-memory-scope]')];
  let snapshot, scope = 'companion', busy = false;
  const say = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  const api = async (path, body) => {
    const response = await fetch(`/api/memory/${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Emilia-Memory': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '记忆请求失败');
    return result;
  };
  const work = async (label, operation) => {
    if (busy) return;
    busy = true; dialog.setAttribute('aria-busy', 'true'); say(label);
    try { await operation(); }
    catch (error) { say(error.message, true); }
    finally { busy = false; dialog.setAttribute('aria-busy', 'false'); }
  };
  const labels = { reported: '你曾明确说过', tentative: '暂定 · 不作事实', corroborated: '跨日证据支持 · 非准确率保证', 'user-confirmed': '由你纠正 · 自动覆盖已锁定' };
  function render() {
    const memory = snapshot.memory;
    summary.textContent = `共 ${memory.records.length} 条精选 · 第 ${memory.revision} 版 · ${memory.updatedAt ? new Date(memory.updatedAt).toLocaleString() : '尚未整理'}`;
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.memoryScope === scope));
    list.replaceChildren();
    const usage=dialog.querySelector('#memoryUsage');
    const day=snapshot.usage?.days?.[0];
    if(usage)usage.textContent=day?`${day.day} API：${day.requests} 次请求，${day.usageReportedRequests} 次返回用量；已知输入 ${day.inputTokens}、输出 ${day.outputTokens} token。未返回用量的费用未知，以服务商账单为准。`:'暂无调用用量记录。';
    if(scope==='persona'){
      const rows=snapshot.persona?.records||[];
      if(!rows.length)list.append(node('p','她在真实交流中明确表达的少量偏好会放在这里；不会据此编造生活经历。','memory-empty'));
      for(const row of rows){
        const card=node('article',null,'maintained-memory-card');
        card.append(node('span','Emilia 曾表达的观点','memory-badge'),node('p',row.quote),node('small',`来源：实际回复 · ${new Date(row.at).toLocaleDateString()}`));
        const remove=node('button','删除');remove.onclick=()=>work('正在删除人物记录…',async()=>{
          if(!canChange())throw new Error('请等待当前回复完成。');
          if(!confirm('删除这条人物偏好记录？'))return;
          const result=await api('persona-delete',{id:row.id});snapshot.persona=result.persona;render();say('已删除人物记录。');
        });card.append(remove);list.append(card);
      }return;
    }
    if (scope === 'teacher') {
      const card = node('article', null, 'maintained-memory-card');
      card.append(node('h3', '当前教学依据'), node('p', `待巩固：${snapshot.teacher.activeNeeds?.join('、') || '等待建立证据'}`),
        node('p', `稳定能力：${snapshot.teacher.masteredItems?.join('、') || '暂无稳定结论'}`),
        node('small', '能力档案来自独立测评与跨课证据，不由伙伴亲密程度决定。下列文字记忆可单独修正，不直接改分数。'));
      list.append(card);
    }
    const records = memory.records.filter(item => item.scope === scope);
    if (!records.length) list.append(node('p', '这里还没有精选记录。结束一次交流并整理后，仅保存有依据、值得保留的内容。', 'memory-empty'));
    for (const item of records) {
      const card = node('article', null, 'maintained-memory-card');
      card.dataset.memoryId = item.id;
      const badge = node('span', labels[item.status] || item.status, 'memory-badge');
      const text = node('p', item.text, 'memory-record-text');
      const time = node('small', `最近确认：${new Date(item.lastSeen).toLocaleDateString()} · ${item.expiresAt ? '复核期限：' + new Date(item.expiresAt).toLocaleDateString() : '不自动过期'}`);
      const proof = node('details'); proof.append(node('summary', '查看来源'));
      if (!item.evidence.length) proof.append(node('p', '你在记忆面板手动确认；旧引用已清除。'));
      for (const evidence of item.evidence) proof.append(node('p', `${new Date(evidence.at).toLocaleDateString()}：“${evidence.quote}”`));
      const controls = node('div', null, 'memory-record-actions');
      const correct = node('button', '纠正'), remove = node('button', '删除');
      correct.type = remove.type = 'button';
      const editor = node('div', null, 'memory-editor'); editor.hidden = true;
      const input = node('textarea'); input.maxLength = 240; input.value = item.text; input.setAttribute('aria-label', '纠正记忆内容');
      const save = node('button', '保存纠正'), cancel = node('button', '取消'); save.type = cancel.type = 'button';
      editor.append(input, save, cancel);
      correct.onclick = () => { if (!busy) { editor.hidden = false; input.focus(); } };
      cancel.onclick = () => { editor.hidden = true; };
      const edit = action => work('正在更新记忆…', async () => {
        if (!canChange()) throw new Error('请先等待当前回复或测评完成。');
        snapshot = {...snapshot,...await api('edit', { revision: memory.revision, id: item.id, action, text: input.value })};
        render(); say(action === 'delete' ? '已删除；同一记忆主题已加入重新写入保护。' : '已纠正；模型不会自动覆盖你的修改。');
      });
      save.onclick = () => edit('correct');
      remove.onclick = () => { if (!busy && confirm('删除这条记忆及其引用？此主题不会被后续自动整理重新写入。')) void edit('delete'); };
      controls.append(correct, remove); card.append(badge, text, time, proof, controls, editor); list.append(card);
    }
  }
  const load = () => work('正在读取精选记忆…', async () => { snapshot = await api('state'); render(); say(snapshot.memory.retention); });
  const finishButton = document.querySelector('#finishCompanionChat');
  document.querySelector('#openMemoryManager').onclick = () => {
    finishButton.textContent = isLessonActive() ? '总结并归档本节课' : '结束聊天并整理';
    dialog.showModal(); void load();
  };
  document.querySelector('#closeMemoryManager').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  document.querySelector('#refreshMemoryManager').onclick = load;
  for (const tab of tabs) tab.onclick = () => { scope = tab.dataset.memoryScope; if (snapshot) render(); };
  finishButton.onclick = async () => {
    if (busy || !canChange()) return;
    if (isLessonActive()) {
      dialog.close();
      await finishLesson();
      return;
    }
    dialog.showModal();
    setBusy(true);
    try {
      await work('正在回顾本次交流、核对来源并维护记忆…请不要关闭或刷新页面。', async () => {
        const result = await api('finish', { sessionId });
        snapshot = { memory: result.memory, relationship: result.relationship,
          teacher: { activeNeeds: result.profile.activeNeeds, masteredItems: result.profile.masteredItems } };
        render(); onFinished(result); say(result.memoryUpdate.digest + ' 本次临时交流记录已释放，可以开始新一轮聊天。');
      });
    } finally { setBusy(false); }
  };
}
