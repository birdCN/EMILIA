import http from 'node:http';
import https from 'node:https';
import {Readable} from 'node:stream';

// Conversation pauses are longer than fetch's usual idle connection lifetime.
// Keep the authenticated provider connection available between spoken turns.
const httpAgent=new http.Agent({keepAlive:true,keepAliveMsecs:1000,maxSockets:8,maxFreeSockets:4,timeout:120000});
const httpsAgent=new https.Agent({keepAlive:true,keepAliveMsecs:1000,maxSockets:8,maxFreeSockets:4,timeout:120000});
export function providerFetch(input,options={}) {
  const url=new URL(input),transport=url.protocol==='https:'?https:http;
  if(!['http:','https:'].includes(url.protocol))return Promise.reject(new Error('Unsupported provider protocol'));
  return new Promise((resolve,reject)=>{
    const request=transport.request(url,{method:options.method||'GET',headers:options.headers,
      agent:url.protocol==='https:'?httpsAgent:httpAgent,signal:options.signal},response=>{
      if(response.statusCode>=300 && response.statusCode<400){response.resume();reject(new Error('Provider redirects are not allowed'));return;}
      const headers=new Headers();
      for(let i=0;i<response.rawHeaders.length;i+=2)headers.append(response.rawHeaders[i],response.rawHeaders[i+1]);
      if([204,205,304].includes(response.statusCode)){response.resume();resolve(new Response(null,{status:response.statusCode,headers}));return;}
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers}));
    });
    request.on('error',reject);request.end(options.body);
  });
}

// Drain a terminal SSE response in the background so the socket can be reused.
// A gateway which never closes is bounded; it cannot block audible delivery.
export function drainProviderReader(reader,timeoutMs=1000,onChunk=null) {
  const timer=setTimeout(()=>{void reader.cancel().catch(()=>{});},timeoutMs);timer.unref?.();
  void (async()=>{try{for(;;){const {value,done}=await reader.read();if(done)break;onChunk?.(value);}}catch{}finally{clearTimeout(timer);reader.releaseLock();}})();
}
