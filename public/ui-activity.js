// Concurrent jobs have individual tickets: finishing an older job cannot hide
// a newer job's spinner. Timing shows elapsed time, never invented progress.
export function createActivityIndicator(views, badge) {
  const jobs = new Map(); let nextId = 0, timer = null, failure = null;
  function render() {
    const job = [...jobs.values()].at(-1);
    badge?.classList.toggle("is-loading", Boolean(job));
    for (const view of views) {
      view.hidden = !job && !failure;
      view.dataset.status = job ? "busy" : "error";
      view.setAttribute("aria-busy", String(Boolean(job)));
      if (!job && !failure) continue;
      const seconds = job ? Math.floor((Date.now() - job.startedAt) / 1000) : 0;
      view.querySelector("[data-activity-title]").textContent = job?.label || "这一步未完成";
      view.querySelector("[data-activity-time]").textContent = job ? `已等待 ${seconds} 秒` : "可重试";
      view.querySelector("[data-activity-detail]").textContent = job
        ? (seconds >= 12 ? `仍在等待结果，请稍候。${jobs.size > 1 ? `另有 ${jobs.size - 1} 项处理中。` : ""}` : job.detail)
        : failure;
    }
    if (!jobs.size && timer) { clearInterval(timer); timer = null; }
  }
  return {
    begin(label, detail = "") {
      const id = ++nextId; failure = null; jobs.set(id, { label, detail, startedAt: Date.now() });
      timer ||= setInterval(render, 1000); render(); let finished = false;
      return {
        update(label, detail = "") { const job = jobs.get(id); if (job) Object.assign(job, { label, detail }); render(); },
        end(error = "") {
          if (finished) return; finished = true; jobs.delete(id);
          if (error) failure = String(error); render();
        }
      };
    }
  };
}

const activities = {
  "/api/opening": ["Emilia 正在想和你聊什么", "这句开场由 AI 临场生成，不从固定话术中轮选。", 80_000],
  "/api/tts": ["正在生成语音", "回复即将读出来。", 55_000],
  "/api/codex/chat": ["正在组织回复与准备语音", "Emilia 正在回应你刚才说的内容。", 80_000],
  "/api/codex/lesson": ["后台备课中", "正在安排本节内容、追问和练习。", 95_000],
  "/api/lesson/prepare": ["正在读取记忆并备课", "根据长期学习画像，准备本节课的简短教案。", 95_000],
  "/api/lesson/finish": ["正在总结并保存本节课", "先提取，再核对主语、否定和来源，最后维护两类记忆。", 180_000],
  "/api/assessment/start": ["正在准备测评", "正在选择本轮题目。", 30_000],
  "/api/assessment/answer": ["正在处理测评回答", "整套结束后会统一给出反馈。", 95_000],
  "/api/transcribe": ["正在识别你的语音", "识别完成后，你可以修改或删除，再确认发送。", 100_000],
  "/api/pronunciation/analyze": ["正在分析整段发音", "正在比对朗读内容、停顿、语速和语调。", 195_000],
  "/api/learner/profile": ["正在读取学习档案", "加载已有画像与本节状态。", 15_000],
  "/api/pronunciation/passage": ["正在准备朗读文本", "加载本次发音采样内容。", 15_000],
  "/api/codex/status": ["正在检查连接", "确认对话服务是否可用。", 30_000],
  "/api/learner/reset": ["正在重置学习档案", "等待保存结果。", 20_000]
};

export function createActivityFetch(indicator) {
  return async function activityFetch(url, options = {}) {
    const path = new URL(url, location.origin).pathname;
    const [label, detail, timeoutMs] = activities[path] || ["正在处理", "等待后台结果。", 80_000];
    const ticket = indicator.begin(label, detail), controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Wait for the complete JSON body; headers alone do not mean completion.
      const data = await response.clone().json();
      if (!response.ok || data?.ok === false) {
        ticket.end(data?.error || "后台未能完成，请重试。");
      } else ticket.end();
      return response;
    } catch (error) {
      const canceled = options.signal?.aborted && path === "/api/transcribe";
      const message = timedOut || (error.name === "AbortError" && !canceled)
        ? "等待超时，暂未收到后台结果。请检查连接后重试。"
        : "连接中断，暂未收到后台结果。请检查连接后重试。";
      ticket.end(canceled ? "" : message);
      if (timedOut) throw new Error(message);
      throw error;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort); ticket.end();
    }
  };
}
