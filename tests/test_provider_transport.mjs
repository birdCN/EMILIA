import assert from 'node:assert/strict';
import http from 'node:http';
import {providerFetch} from '../provider-transport.mjs';
const ports=[];let forwarded=false;
const server=http.createServer(async(req,res)=>{
 ports.push(req.socket.remotePort);
 if(req.url==='/redirect'){res.writeHead(302,{Location:'/private'});res.end();return;}
 if(req.url==='/private'){forwarded=true;res.end('private');return;}
 if(req.url==='/empty'){res.writeHead(204);res.end();return;}
 let body='';for await(const chunk of req)body+=chunk;
 res.setHeader('content-type','application/json');res.end(JSON.stringify({body,method:req.method}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const base='http://127.0.0.1:'+server.address().port;
 const response=await providerFetch(base,{method:'POST',body:'中文与 English',headers:{Authorization:'Bearer synthetic'}});
 assert.deepEqual(await response.json(),{body:'中文与 English',method:'POST'});
 await new Promise(resolve=>setImmediate(resolve));
 await(await providerFetch(base)).text();
 assert.equal(ports[0],ports[1],'a fully consumed provider response must leave a reusable connection');
 await assert.rejects(()=>providerFetch(base+'/redirect'),/redirect/);
 assert.equal(forwarded,false,'redirects must never forward provider credentials');
 assert.equal((await providerFetch(base+'/empty')).status,204);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>providerFetch(base,{signal:controller.signal}),/abort/i);
 console.log('PASS: provider UTF-8 transport, reusable connection, redirect refusal, empty response and abort');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
