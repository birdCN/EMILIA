import { randomUUID } from 'node:crypto';
import { completedJsonField, partialEnglishField } from './public/stream-fields.js';
import {providerFetch,drainProviderReader} from './provider-transport.mjs';
import {recallLeadDecision} from './memory-retrieval.mjs';
import {recordProviderEvent} from './api-usage.mjs';

export const PROVIDERS = [
  { id:'deepseek', name:'DeepSeek', protocol:'openai', baseUrl:'https://api.deepseek.com', model:'deepseek-v4-flash', website:'https://platform.deepseek.com/', docs:'https://api-docs.deepseek.com/', thinking:'deepseek' },
  { id:'openai', name:'OpenAI', protocol:'openai', baseUrl:'https://api.openai.com/v1', model:'gpt-4.1-mini', website:'https://platform.openai.com/api-keys', docs:'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create' },
  { id:'qwen', name:'通义千问 · 北京', protocol:'openai', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'', website:'https://bailian.console.aliyun.com/', docs:'https://help.aliyun.com/en/model-studio/base-url', thinking:'qwen' },
  { id:'kimi', name:'Kimi', protocol:'openai', baseUrl:'https://api.moonshot.cn/v1', model:'', website:'https://platform.kimi.com/', docs:'https://platform.kimi.com/docs/get-api-key' },
  { id:'gemini', name:'Google Gemini', protocol:'openai', baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-3.8-flash', website:'https://aistudio.google.com/apikey', docs:'https://ai.google.dev/gemini-api/docs/openai' },
  { id:'claude', name:'Anthropic Claude', protocol:'anthropic', baseUrl:'https://api.anthropic.com/v1', model:'', website:'https://platform.claude.com/', docs:'https://platform.claude.com/docs/en/api/overview' },
  { id:'custom', name:'自定义 / 本地兼容服务', protocol:'openai', baseUrl:'', model:'', website:'', docs:'' }
];

export function normalizeEndpoint(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('请输入完整的 API Base URL'); }
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('云端接口必须使用 HTTPS；HTTP 仅支持本机 localhost');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含账号、密码、查询参数或片段');
  url.pathname = url.pathname.replace(/\/(chat\/completions|messages|models)\/?$/, '').replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function validateConfig(input) {
  const provider = PROVIDERS.find(p => p.id === input.provider);
  if (!provider) throw new Error('请选择有效的服务商');
  if (!['codex','api'].includes(input.mode)) throw new Error('请选择 Codex 或 API');
  if (!['openai','anthropic'].includes(input.protocol)) throw new Error('暂支持 Chat Completions 与 Anthropic Messages 协议');
  const model = String(input.model || '').trim();
  if (model.length > 180 || /[\r\n\x00-\x1f]/.test(model)) throw new Error('模型 ID 无效');
  const baseUrl = input.baseUrl ? normalizeEndpoint(input.baseUrl) : '';
  if (input.mode === 'api' && !baseUrl) throw new Error('请填写接口地址');
  return { mode:input.mode, provider:provider.id, protocol:input.protocol, baseUrl, model, disableThinking:input.disableThinking !== false };
}

export function authHeaders(config) {
  return config.protocol === 'anthropic'
    ? { 'x-api-key':config.apiKey || '', 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' }
    : { ...(config.apiKey ? { Authorization:`Bearer ${config.apiKey}` } : {}), 'Content-Type':'application/json' };
}

// Never return provider response bodies: they may echo credentials or private prompts.
export function statusError(status) {
  return Object.assign(new Error(({401:'密钥无效或已过期',403:'账号无权访问此模型或接口',404:'接口地址或模型 ID 不存在',429:'服务商限流或余额不足，请检查账户',402:'服务商余额不足'}[status]) || `服务商请求失败（HTTP ${status}），请检查地址、模型及参数兼容性`),{status,retryable:status>=500||status===408});
}

export async function listModels(config, fetcher = providerFetch) {
  let response;
  try { response = await fetcher(`${config.baseUrl}/models`, { headers:authHeaders(config), redirect:'error', signal:AbortSignal.timeout(15000) }); }
  catch { throw new Error('无法读取模型列表：网络超时或地址不可达，也可以手动填写模型 ID'); }
  if (!response.ok) {void response.body?.cancel().catch(()=>{});throw statusError(response.status);}
  const body = await response.json();
  const ids = (body.data || body.models || []).map(x => x.id || x.name?.replace(/^models\//,'')).filter(x => typeof x === 'string' && x.length < 180);
  if (!ids.length) throw new Error('接口没有返回模型列表，请手动填写模型 ID');
  return [...new Set(ids)].slice(0,500);
}

export function validateSchema(value, schema, path = 'reply') {
  if (!schema) return;
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validateSchema(value,s,path); return true; } catch { return false; } })) throw new Error(`${path} 类型不匹配`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 不在允许值内`);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => t === type || (t === 'integer' && Number.isInteger(value)))) throw new Error(`${path} 类型不匹配`);
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value,key)) throw new Error(`${path}.${key} 缺失`);
    for (const [key,item] of Object.entries(value)) {
      if (schema.additionalProperties === false && !schema.properties?.[key]) throw new Error(`${path} 含未知字段`);
      if (schema.properties?.[key]) validateSchema(item,schema.properties[key],`${path}.${key}`);
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path} 数量不符合要求`);
    value.forEach(item => validateSchema(item,schema.items,path));
  }
  if (type === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${path} 文本长度不符合要求`);
  if (type === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path} 数值不符合要求`);
}

export async function streamCompletion(config,messages,schema,onDelta,options={}){
  const id=randomUUID(),started=Date.now(),record=options.onProviderEvent||recordProviderEvent;
  record({type:'start',id,purpose:options.purpose||'other',model:config.model});
  let status='failed';
  try{
    const result=await streamCompletionBody(config,messages,schema,onDelta,{...options,onUsage:usage=>record({type:'usage',id,usage})});
    status='completed';return result;
  }finally{record({type:'finish',id,status:options.signal?.aborted?'cancelled':status,durationMs:Date.now()-started});}
}
async function streamCompletionBody(config, messages, schema, onDelta, {fetcher = providerFetch, signal,onUsage} = {}) {
  if (!config.model) throw new Error('请先选择模型');
  const spokenOnly=Boolean(schema?.properties?.en && Object.keys(schema.properties).length===1);
  const instruction = spokenOnly
    ? '\nFor this spoken turn, output only the English words Emilia will say. No JSON, markdown, labels or stage directions. Keep all the needed meaning and examples. The transport adapter will structure your words.'
    : schema ? `\nReturn ONLY a JSON object matching this schema; no markdown or preamble. Preserve property order, especially en first when present. Schema: ${JSON.stringify(schema)}` : '';
  const system = messages.filter(m=>m.role==='system').map(m=>m.content).join('\n') + instruction;
  const chat = messages.filter(m=>m.role!=='system');
  let body = config.protocol === 'anthropic'
    ? { model:config.model, system, messages:chat, max_tokens:4096, stream:true }
    : { model:config.model, messages:[{role:'system',content:system},...chat], stream:true };
  const preset = PROVIDERS.find(p=>p.id===config.provider);
  if(config.protocol==='openai'&&config.baseUrl===preset?.baseUrl&&['deepseek','openai'].includes(config.provider))body.stream_options={include_usage:true};
  // Official DeepSeek supports JSON Output. Keep custom/other providers unchanged.
  // https://api-docs.deepseek.com/guides/json_mode/
  if (schema && !spokenOnly && config.provider === 'deepseek' && config.baseUrl === preset?.baseUrl && config.protocol === 'openai') {
    body.response_format = { type: 'json_object' };
  }
  if (config.disableThinking && config.baseUrl === preset?.baseUrl && config.protocol === 'openai') {
    if (preset.thinking === 'deepseek') body.thinking = {type:'disabled'};
    if (preset.thinking === 'qwen') body.enable_thinking = false;
  }
  let response;
  try { response = await fetcher(`${config.baseUrl}/${config.protocol==='anthropic'?'messages':'chat/completions'}`, {
    method:'POST', headers:authHeaders(config), body:JSON.stringify(body), redirect:'error', signal:signal || AbortSignal.timeout(70000)
  }); } catch { throw new Error('API 连接失败或超时，请检查网络与接口地址'); }
  if (!response.ok) {void response.body?.cancel().catch(()=>{});throw statusError(response.status);}
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {void response.body?.cancel().catch(()=>{});throw new Error('此接口未返回 SSE 流式回复，请选择支持流式文本的模型');}
  let buffer='', result='', finished=false,nativeUsage={};
  let spokenFormat=null,rawEmitted=0;
  const emitContent=delta=>{
    if(!spokenOnly){onDelta(delta);return;}
    if(!spokenFormat){
      const start=result.trimStart();
      if(!start)return;
      if(start.startsWith('```')){if(!/^```(?:json)?\s*\{/.test(start))return;spokenFormat='json';}
      else spokenFormat=start.startsWith('{')?'json':'plain';
      if(spokenFormat==='plain'){onDelta('{"en":'+JSON.stringify(result).slice(0,-1));rawEmitted=result.length;return;}
    }
    const fresh=result.slice(rawEmitted);rawEmitted=result.length;
    if(fresh)onDelta(spokenFormat==='plain'?JSON.stringify(fresh).slice(1,-1):fresh);
  };
  const decoder = new TextDecoder();
  const consume = line => {
    if (!line.startsWith('data:')) return;
    const data=line.slice(5).trim();
    if (!data) return;
    if (data==='[DONE]') { finished=true; return; }
    let event;
    try { event=JSON.parse(data); } catch { throw new Error('API 流式数据格式错误'); }
    if(config.protocol==='anthropic'){
      nativeUsage={...nativeUsage,...event.message?.usage,...event.usage};
      if(Number.isSafeInteger(nativeUsage.input_tokens)&&Number.isSafeInteger(nativeUsage.output_tokens))onUsage?.({prompt_tokens:nativeUsage.input_tokens+(nativeUsage.cache_read_input_tokens||0)+(nativeUsage.cache_creation_input_tokens||0),completion_tokens:nativeUsage.output_tokens,prompt_cache_hit_tokens:nativeUsage.cache_read_input_tokens||0});
    }else if(event.usage)onUsage?.(event.usage);
    if (event.error || event.type==='error') throw new Error('服务商在生成过程中报错，请稍后重试');
    const stop = event.choices?.[0]?.finish_reason || event.delta?.stop_reason;
    if (['length','max_tokens','content_filter','refusal','tool_calls','tool_use'].includes(stop)) throw new Error('模型未完成有效文本回复（截断、拒绝或工具调用）');
    if (stop === 'stop') finished=true;
    if (event.type==='message_stop') finished=true;
    const delta=config.protocol==='anthropic'
      ? (event.type==='content_block_delta' && event.delta?.type==='text_delta' ? event.delta.text : '')
      : event.choices?.[0]?.delta?.content;
    if (typeof delta==='string' && delta) { result+=delta; if(result.length>250000) throw new Error('模型回复过长'); emitContent(delta); }
  };
  const reader=response.body.getReader();
  try {
    while(true) {
      const {value:chunk,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(chunk,{stream:true});
      if(buffer.length>300000) throw new Error('API 数据块过长');
      const lines=buffer.split(/\r?\n/);buffer=lines.pop();
      for (const line of lines) {
        consume(line);
      }
      if (finished) break;
    }
    if (!finished) { buffer+=decoder.decode(); if(buffer.trim()) consume(buffer); }
  } catch(error) {
    if (signal?.aborted || error.name==='TimeoutError' || error.name==='AbortError') throw new Error('API 生成超时或已取消');
    throw error.message?.startsWith('API') || error.message?.startsWith('模型') || error.message?.startsWith('服务商') ? error : new Error('API 流式连接中断');
  } finally {
    if(finished)drainProviderReader(reader,1000,chunk=>{
      buffer+=decoder.decode(chunk,{stream:true});
      const lines=buffer.split(/\r?\n/);buffer=lines.pop();
      for(const line of lines)if(line.startsWith('data:'))try{const packet=JSON.parse(line.slice(5));if(packet.usage)onUsage?.(packet.usage);}catch{}
    });
    else {void reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  // Some gateways close after a complete JSON object without sending [DONE].
  // Recover only a fully parsed, schema-valid answer; incomplete text and
  // explicit length/refusal/tool stop reasons remain errors.
  if (!finished && schema && result.trim()) {
    try { validateSchema(JSON.parse(result), schema); finished = true; } catch {}
  }
  if (!finished || !result.trim()) throw new Error('API 回复为空或流提前中断');
  if(spokenFormat==='plain')onDelta('"}');
  if(schema) {
    const fenced = result.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) result = fenced[1]; // Formatting wrapper only; contents still validate strictly.
    let parsed;
    const isChatEnvelope = schema.properties?.en && schema.properties?.feedback && schema.properties?.observation;
    const isSpokenReply = schema.properties?.en && Object.keys(schema.properties || {}).length === 1;
    try { parsed=JSON.parse(result); } catch {
      // Some compatible gateways ignore JSON Output. Preserve an unambiguous
      // English-only spoken reply, but NEVER invent corrections or score evidence.
      // Malformed JSON, long prose, and all assessment/memory outputs still fail.
      const completeEnglish = isChatEnvelope ? completedJsonField(result, 'en') : null;
      const spoken = typeof completeEnglish === 'string' ? completeEnglish.trim() : result.trim();
      const spokenLimit = Number(schema.properties?.en?.maxLength) || 240;
      if ((!isChatEnvelope && !isSpokenReply) || spoken.length > spokenLimit || !/[A-Za-z]/.test(spoken) || /[{}\[\]`<>\u3400-\u9fff]/u.test(spoken)) {
        throw new Error('模型没有返回有效 JSON；请换用支持结构化回复的模型');
      }
      if (isSpokenReply) parsed = { en: spoken };
      else {
        const recoveredFeedback = completedJsonField(result, 'feedback');
        const recoveredExpression = completedJsonField(result, 'expression');
        const recoveredTranslation = completedJsonField(result, 'zh');
        const recoveredObservation = completedJsonField(result, 'observation');
        const recoveredPedagogy = completedJsonField(result, 'pedagogy');
        parsed = { en: spoken,
          feedback: recoveredFeedback || { status: 'uncertain', original: '', revised: '', reasonZh: '本轮模型仅返回口语文本，暂未提供可靠纠错。' },
          expression: recoveredExpression || { kind: 'neutral', intensity: 0 },
          zh: typeof recoveredTranslation === 'string' ? recoveredTranslation : '',
          observation: recoveredObservation || { skillKey: 'answer_development', signal: 'neutral',
            evidenceQuality: 'low', confidence: 0, noteZh: '未收到结构化观察，不计入能力证据。', nextMove: 'converse' },
          pedagogy: recoveredPedagogy || { action: 'none', category: 'vocabulary', targetKey: '', targetEn: '', explanationZh: '',
            exampleEn: '', outcome: 'not_tested', errorTag: '', errorLabelZh: '' } };
      }
      result = JSON.stringify(parsed);
    }
    // Conversation providers sometimes add harmless explanatory metadata.
    // Project only this known chat envelope onto its declared fields; never
    // relax grading/memory-patch validation or invent missing required values.
    if (isChatEnvelope) {
      const project = (value, shape) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(shape.properties || {}, key))
          .map(([key, item]) => [key, shape.properties[key].properties ? project(item, shape.properties[key]) : item]));
      };
      parsed = project(parsed, schema);
      const safeMetadata = { feedback: { status: 'uncertain', original: '', revised: '', reasonZh: '本轮未收到可靠的结构化纠错，不据此判断表达没有问题。' },
        expression: { kind: 'neutral', intensity: 0 }, zh: '', observation: { skillKey: 'answer_development', signal: 'neutral',
          evidenceQuality: 'low', confidence: 0, noteZh: '缺少可靠观察，不计入能力证据。', nextMove: 'converse' },
        pedagogy: { action: 'none', category: 'vocabulary', targetKey: '', targetEn: '', explanationZh: '',
          exampleEn: '', outcome: 'not_tested', errorTag: '', errorLabelZh: '' } };
      for (const [key, fallback] of Object.entries(safeMetadata)) {
        try { validateSchema(parsed?.[key], schema.properties[key], `reply.${key}`); }
        catch { if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsed[key] = fallback; }
      }
      result = JSON.stringify(parsed);
    }
    validateSchema(parsed,schema);
  }
  return result;
}

// Race identical-model requests only until meaningful speech begins. No
// alternative model, canned answer or truncated context participates. A slow
// attempt is cancelled, and only the winning stream enters conversation state.
// Known-recall leads may be preferred over a fast denial. Denials remain valid
// fallbacks after a bounded grace period, so uncertainty never becomes an error.
export async function hedgeSpokenStream(run,onDelta,{signal,delayMs=40,maxAttempts=3,onHedge=()=>{},acceptEnglish=null,fallbackDelayMs=180}={}) {
  const attempts=[],deferred=[];let winner=null,finished=false,timer,fallbackTimer,failPending;
  const cancel=()=>{for(const item of attempts)if(!item.done)item.controller.abort();};
  const abort=()=>{cancel();failPending?.(new Error('API 生成超时或已取消'));};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    return await new Promise((resolve,reject)=>{
      const fail=error=>{if(!finished){finished=true;clearTimeout(timer);clearTimeout(fallbackTimer);reject(error);}};
      failPending=fail;
      const select=item=>{
        if(finished||signal?.aborted)return false;
        if(winner)return winner===item;
        winner=item;clearTimeout(timer);clearTimeout(fallbackTimer);
        for(const other of attempts)if(other!==item&&!other.done)other.controller.abort();
        onDelta(item.buffer);return true;
      };
      const finish=item=>{if(select(item)){finished=true;clearTimeout(timer);clearTimeout(fallbackTimer);resolve(item.value);}};
      const useDeferred=()=>{if(!winner&&deferred.length)finish(deferred[0]);};
      const maybeFallback=()=>{
        if(!deferred.length||winner||finished)return;
        if(attempts.length>=maxAttempts&&attempts.every(item=>item.done||item.failed))useDeferred();
        else if(!fallbackTimer)fallbackTimer=setTimeout(useDeferred,fallbackDelayMs);
      };
      const launch=()=>{
        clearTimeout(timer);
        if(winner || attempts.length>=maxAttempts)return;
        if(finished || signal?.aborted){if(signal?.aborted)fail(new Error('API 生成超时或已取消'));return;}
        const item={controller:new AbortController(),buffer:'',failed:false};attempts.push(item);
        if(attempts.length>1)onHedge();
        void run(item.controller.signal,delta=>{
          if(finished || (winner && winner!==item))return;
          item.buffer+=delta;
          if(winner===item){onDelta(delta);return;}
          const english=partialEnglishField(item.buffer) || (!/^\s*[{`]/.test(item.buffer)?item.buffer:'');
          if(/[A-Za-z]/.test(english)&&(!acceptEnglish||acceptEnglish(english,false)==='accept'))select(item);
        }).then(value=>{
          item.done=true;item.value=value;
          if(finished || (winner && winner!==item))return;
          if(!winner&&acceptEnglish){
            let english=partialEnglishField(item.buffer)||(!/^\s*[{`]/.test(item.buffer)?item.buffer:'');
            if(!english)try{english=JSON.parse(value).en||'';}catch{}
            if(acceptEnglish(english,true)!=='accept'){deferred.push(item);maybeFallback();return;}
          }
          finish(item);
        }).catch(error=>{
          item.failed=true;
          if(finished || (winner && winner!==item))return;
          if(error.retryable===false){fail(error);return;}
          if(winner===item){fail(error);return;}
          if(attempts.length<maxAttempts){clearTimeout(timer);launch();}
          else if(attempts.every(candidate=>candidate.failed))fail(error);
          else maybeFallback();
        });
        if(!finished && !winner && attempts.length<maxAttempts)timer=setTimeout(launch,attempts.length===1?delayMs:140);
      };
      launch();
    });
  } finally {clearTimeout(timer);clearTimeout(fallbackTimer);signal?.removeEventListener('abort',abort);cancel();}
}

// Transport adapter for the existing teacher pipeline; never pretends to be a Codex login.
export class ApiModelClient {
  constructor(config, { fetcher = providerFetch } = {}) { this.config={...config}; this.model=config.model; this.listeners=new Set(); this.waiters=[]; this.threads=new Map(); this.closed=false; this.controllers=new Set(); this.ephemeral=new Set(); this.fetcher=fetcher; this.nextLearnerText=null; }
  setLearnerTurn(text) { this.nextLearnerText=String(text); }
  setRecallLead(enabled) {this.nextRecallLead=enabled===true;}
  setSpokenPrefix(threadId, text) { this.audiblePrefixes ||= new Map(); this.audiblePrefixes.set(threadId, text); }
  async initialize() {}
  isAlive() { return !this.closed; }
  cancelTurn(threadId) { this.turnControllers?.get(threadId)?.abort(); }
  onMessage(fn) { this.listeners.add(fn); return ()=>this.listeners.delete(fn); }
  emit(message) {
    for(const w of [...this.waiters]) if(w.predicate(message)) { clearTimeout(w.timer);this.waiters.splice(this.waiters.indexOf(w),1);w.resolve(message); }
    for(const fn of this.listeners) fn(message);
  }
  waitFor(predicate,timeout=75000) {
    const promise=new Promise((resolve,reject)=>{ const w={predicate,resolve,reject};w.timer=setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(new Error('API 响应超时'));},timeout);this.waiters.push(w); });
    promise.catch(()=>{});return promise;
  }
  async request(method,params={}) {
    if(this.closed)throw new Error('模型连接已关闭');
    if(method==='account/read') return {account:{type:'api',planType:PROVIDERS.find(p=>p.id===this.config.provider)?.name}};
    if(method==='thread/start') { const id=randomUUID();this.threads.set(id,[{role:'system',content:params.baseInstructions||''}]);if(params.ephemeral)this.ephemeral.add(id);return {thread:{id}}; }
    if(method!=='turn/start') throw new Error('不支持的模型操作');
    const history=this.threads.get(params.threadId);if(!history) throw new Error('模型会话已失效');
    const user={role:'user',content:params.input.map(x=>x.text||'').join('\n')};
    const isSpoken = params.outputSchema?.properties?.en && Object.keys(params.outputSchema.properties).length === 1;
    const recallLead=isSpoken&&this.nextRecallLead===true;
    if(isSpoken)this.nextRecallLead=false;
    const historyUser = isSpoken && this.nextLearnerText != null ? {role:'user',content:this.nextLearnerText} : user;
    if(isSpoken)this.nextLearnerText=null;
    if(isSpoken)this.audiblePrefixes?.delete(params.threadId);
    const controller=new AbortController();this.controllers.add(controller);this.turnControllers ||= new Map();this.turnControllers.set(params.threadId,controller);const timeout=setTimeout(()=>controller.abort(),70000);
    const generate = async () => {
      for (let attempt=0;;attempt++) {
        const prefix=this.audiblePrefixes?.get(params.threadId);
        const current=prefix ? { ...user, content:user.content+'\nThe learner has already heard this exact beginning: '+JSON.stringify(prefix)+'. Return the full reply starting with that exact text, then finish answering the original message. Do not repeat the beginning in the continuation.' } : user;
        try {
          const deliver=delta=>this.emit({method:'item/agentMessage/delta',params:{threadId:params.threadId,delta}});
          const run=(signal,onDelta)=>streamCompletion(this.config,[...history,current],params.outputSchema,onDelta,{signal,fetcher:this.fetcher,purpose:params.purpose||(isSpoken?'spoken':'other')});
          const value=isSpoken && this.config.provider==='deepseek'
            ? await hedgeSpokenStream(run,deliver,{signal:controller.signal,onHedge:()=>this.emit({method:'turn/hedging',params:{threadId:params.threadId}}),acceptEnglish:recallLead?(english,complete)=>recallLeadDecision(english,{complete}):null})
            : await run(controller.signal,deliver);
          const audible=this.audiblePrefixes?.get(params.threadId);
          if (isSpoken && audible && !JSON.parse(value).en.startsWith(audible)) throw new Error('模型续写与已播放开头不一致');
          return value;
        } catch(error) {
          if(!isSpoken || attempt>=2 || controller.signal.aborted || this.closed || !/流提前中断|回复为空|连接失败|流式连接中断|JSON|文本长度|续写/.test(error.message)) throw error;
          this.emit({method:'turn/retrying',params:{threadId:params.threadId,attempt:attempt+1}});
          if(attempt)await new Promise(resolve=>setTimeout(resolve,120));
        }
      }
    };
    void generate()
      .then(text=>{
        history.push(historyUser,{role:'assistant',content:text});
        // Keep 40 complete exchanges; transient directors and memory bundles
        // belong only to the current request, not every future context.
        if(history.length>81)history.splice(1,history.length-81);
        if(!isSpoken && this.ephemeral.has(params.threadId)){this.threads.delete(params.threadId);this.ephemeral.delete(params.threadId);}
        this.emit({method:'turn/completed',params:{threadId:params.threadId,turn:{status:'completed',items:[{type:'agentMessage',text}]}}});
      }).catch(error=>this.emit({method:'turn/completed',params:{threadId:params.threadId,turn:{status:'failed',error:{message:error.message,status:error.status,retryable:error.retryable},items:[]}}}))
      .finally(()=>{clearTimeout(timeout);this.controllers.delete(controller);if(this.turnControllers.get(params.threadId)===controller)this.turnControllers.delete(params.threadId);if(!isSpoken && this.ephemeral.has(params.threadId)){this.threads.delete(params.threadId);this.ephemeral.delete(params.threadId);}});
    return {};
  }
  close() { this.closed=true;for(const c of this.controllers)c.abort();for(const w of this.waiters){clearTimeout(w.timer);w.reject(new Error('模型连接已关闭'));}this.waiters=[];this.listeners.clear();this.threads.clear();this.ephemeral.clear();this.nextLearnerText=null; }
}
