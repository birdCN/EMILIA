import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {TEMP_ROOT,PYTHON_EXECUTABLE} from './local-paths.mjs';
import {memoryRelevanceSignals} from './memory-retrieval.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = PYTHON_EXECUTABLE;
const DEFAULT_WORKER = join(ROOT, 'tools', 'rag_embedding_worker.py');
const DEFAULT_MODEL = join(ROOT, 'runtime', 'rag', 'models', 'multilingual-e5-small-int8');
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export class OnnxEmbeddingWorker {
  constructor({ pythonPath = DEFAULT_PYTHON, workerPath = DEFAULT_WORKER, modelPath = DEFAULT_MODEL,
    timeoutMs = 8000 } = {}) {
    this.pythonPath = pythonPath;
    this.workerPath = workerPath;
    this.modelPath = modelPath;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.stderr = '';
  }

  start() {
    if (this.child && !this.child.killed) return;
    const child = spawn(this.pythonPath, [this.workerPath, '--model', this.modelPath], {
      cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', TEMP: TEMP_ROOT, TMP: TEMP_ROOT }
    });
    this.child = child;
    this.buffer = '';
    this.stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-2000); });
    child.once('error', error => this.failAll(error));
    child.once('exit', code => {
      if (this.child === child) this.child = null;
      this.failAll(new Error(`RAG embedding worker exited (${code ?? 'unknown'}): ${this.stderr}`));
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const index = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let reply;
      try { reply = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(reply.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error));
      else if (reply.dimensions !== 384 || !Array.isArray(reply.vectors)) pending.reject(new Error('Invalid embedding response'));
      else pending.resolve(reply.vectors);
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async embed(texts, prefix) {
    this.start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RAG embedding timeout'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, texts, prefix }) + '\n', 'utf8', error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
  }
}

function passageText(row) {
  const quotes = (row.evidence || []).slice(-2).map(item => clean(item.quote)).filter(Boolean);
  return [clean(row.text), ...quotes].join(' | ');
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return -1;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

export class SemanticMemoryRetriever {
  constructor({ embedder = new OnnxEmbeddingWorker(), threshold = 0.80, explicitThreshold = 0.78,
    maxScoreDelta = 0.035, onError = null } = {}) {
    this.embedder = embedder;
    this.threshold = threshold;
    this.explicitThreshold = explicitThreshold;
    this.maxScoreDelta = maxScoreDelta;
    this.onError = onError;
    this.cache = new Map();
    this.lastError = '';
  }

  async retrieve(records, { query = '', limit = Infinity, explicitRecall = false,
    scopes = ['teacher', 'companion', 'episode'] } = {}) {
    const wantedScopes = new Set(scopes);
    const candidates = (records || []).filter(row => row?.id && row.kind !== 'boundary'
      && wantedScopes.has(row.scope) && clean(row.text));
    const count=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):candidates.length;
    if (!clean(query) || !candidates.length || limit <= 0) return [];
    try {
      // Scope is a per-turn view, not a deletion from the authoritative index.
      const activeIds = new Set((records||[]).map(row => row.id));
      for (const id of this.cache.keys()) if (!activeIds.has(id)) this.cache.delete(id);
      const missing = [];
      for (const row of candidates) {
        const text = passageText(row);
        const hash = fingerprint(text);
        const cached = this.cache.get(row.id);
        if (!cached || cached.hash !== hash) missing.push({ row, text, hash });
      }
      if (missing.length) {
        const vectors = await this.embedder.embed(missing.map(item => item.text), 'passage: ');
        for (let index = 0; index < missing.length; index += 1) {
          this.cache.set(missing[index].row.id, { hash: missing[index].hash, vector: vectors[index] });
        }
      }
      const [queryVector] = await this.embedder.embed([clean(query)], 'query: ');
      const ranked = candidates.map(row => {
        const score=cosine(queryVector,this.cache.get(row.id)?.vector);
        const signals=memoryRelevanceSignals(query,row);
        return {row,score,rankScore:score+Math.min(2,signals.sharedTopics)*0.04+(signals.reasonMatch?0.025:0)};
      }).filter(item => Number.isFinite(item.score));
      const floor = explicitRecall ? this.explicitThreshold : this.threshold;
      const eligible=ranked.filter(item=>item.score>=floor).sort((left,right)=>right.rankScore-left.rankScore);
      const top = eligible[0]?.rankScore ?? -1;
      if (top < floor) return [];
      return eligible.filter(item => item.rankScore >= top - this.maxScoreDelta)
        .slice(0, count).map(item => item.row);
    } catch (error) {
      const signature = `${error?.name || 'Error'}:${error?.message || error}`;
      if (signature !== this.lastError) this.onError?.(error);
      this.lastError = signature;
      // A failed embedding process must not erase a strong, explicit recall.
      // Ordinary conversation still fails closed; never substitute random facts.
      if(!explicitRecall)return [];
      return candidates.map(row=>({row,...memoryRelevanceSignals(query,row)}))
        .filter(item=>item.lexicalMatches>=2 || item.sharedTopics>0&&(item.lexicalMatches>0||item.reasonMatch))
        .sort((a,b)=>(Number(b.reasonMatch)-Number(a.reasonMatch))||b.sharedTopics-a.sharedTopics||b.lexicalMatches-a.lexicalMatches)
        .slice(0,count).map(item=>item.row);
    }
  }
}

export const semanticMemoryRetriever = new SemanticMemoryRetriever({
  onError: error => console.warn(`[memory-rag] ${error.message}`)
});

process.once('exit', () => semanticMemoryRetriever.embedder.close?.());
