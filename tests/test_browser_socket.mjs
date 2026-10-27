import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {BrowserLifetime} from '../browser-lifetime.mjs';
import {BrowserSocketHub} from '../browser-socket.mjs';
const key='dGhlIHNhbXBsZSBub25jZQ==',host='127.0.0.1:4317';
const request=()=>({method:'GET',httpVersion:'1.1',url:'/api/app/connection',headers:{host,origin:'http://'+host,upgrade:'websocket',connection:'Upgrade','sec-websocket-version':'13','sec-websocket-key':key}});
class Socket extends EventEmitter{constructor(){super();this.output=[];this.writableLength=0;this.destroyed=false;}setNoDelay(){}setTimeout(){}write(data){this.output.push(Buffer.from(data));return true;}end(data){if(data)this.write(data);this.destroy();}destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}}
function masked(opcode,payload=Buffer.alloc(0),{fin=true,rsv=0,mask=true}={}){payload=Buffer.from(payload);const result=Buffer.alloc(2+(mask?4:0)+payload.length);result[0]=(fin?128:0)|rsv|opcode;result[1]=(mask?128:0)|payload.length;if(mask)result.fill(0x37,2,6);for(let i=0;i<payload.length;i++)result[2+(mask?4:0)+i]=payload[i]^(mask?0x37:0);return result;}
function fixture(){let released=0;const intervals=new Set();const lifetime={connect:()=>()=>released++};const hub=new BrowserSocketHub({lifetime,allowedHosts:[host],setInterval:fn=>{const timer={fn,referenced:true,unref(){this.referenced=false;}};intervals.add(timer);return timer;},clearInterval:timer=>intervals.delete(timer)});return {hub,intervals,released:()=>released};}
for(const [name,change,status]of[
 ['host',r=>r.headers.host='other.invalid',403],['missing origin',r=>delete r.headers.origin,403],['origin',r=>r.headers.origin='https://other.invalid',403],['site',r=>r.headers['sec-fetch-site']='cross-site',403],['path',r=>r.url='/other',404],['method',r=>r.method='POST',400],['version',r=>r.headers['sec-websocket-version']='12',400],['key',r=>r.headers['sec-websocket-key']='invalid',400],['connection',r=>r.headers.connection='close',400],['upgrade',r=>r.headers.upgrade='other',400],['http version',r=>r.httpVersion='1.0',400]]){
 const f=fixture(),r=request(),socket=new Socket();change(r);f.hub.upgrade(r,socket,Buffer.alloc(0));assert.match(socket.output[0].toString(),new RegExp('^HTTP/1.1 '+status),name);assert.equal(f.intervals.size,0);assert.equal(f.released(),0);f.hub.close();
}
{
 const f=fixture(),socket=new Socket();f.hub.upgrade(request(),socket,Buffer.alloc(0));assert.match(socket.output[0].toString(),/Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);assert.equal(socket.output[1][0],0x89);assert.equal([...f.intervals][0].referenced,false);
 socket.emit('data',masked(10,socket.output[1].subarray(2)));const ping=masked(9,Buffer.from('echo'));socket.emit('data',ping.subarray(0,3));socket.emit('data',ping.subarray(3));assert.deepEqual(socket.output.at(-1),Buffer.from([0x8a,4,...Buffer.from('echo')]));f.hub.close();socket.emit('error',Error('late socket failure'));assert.equal(f.released(),1);assert.equal(f.intervals.size,0);
}
for(const [name,frame,code]of[
 ['application text',masked(1,Buffer.from('not allowed')),1003],['application binary',masked(2),1003],['unmasked',masked(9,Buffer.alloc(0),{mask:false}),1002],['RSV',masked(9,Buffer.alloc(0),{rsv:64}),1002],['fragmented',masked(9,Buffer.alloc(0),{fin:false}),1002],['extended length',Buffer.from([0x89,0xfe]),1002],['close one byte',masked(8,Buffer.from([0])),1002],['reserved close code',masked(8,Buffer.from([3,237])),1002],['bad close UTF8',masked(8,Buffer.from([3,232,0xc0,0xaf])),1007],['buffer limit',Buffer.alloc(2048),1009]]){
 const f=fixture(),socket=new Socket();f.hub.upgrade(request(),socket,Buffer.alloc(0));socket.emit('data',frame);assert.equal(socket.output.at(-1)[0],0x88,name);assert.equal(socket.output.at(-1).readUInt16BE(2),code,name);assert.equal(f.released(),1);assert.equal(f.intervals.size,0);f.hub.close();
}
{
 const f=fixture(),socket=new Socket();f.hub.upgrade(request(),socket,Buffer.alloc(0));const timer=[...f.intervals][0];timer.fn();timer.fn();assert.equal(socket.destroyed,true,'two unanswered native pings detach a stale socket');assert.equal(f.released(),1);assert.equal(f.intervals.size,0);f.hub.close();
}
{
 const f=fixture(),socket=new Socket();f.hub.upgrade(request(),socket,Buffer.alloc(0));socket.writableLength=5000;socket.emit('data',masked(9,Buffer.from('echo')));assert.equal(socket.destroyed,true,'a peer that does not read cannot grow the output queue');assert.equal(f.released(),1);assert.equal(f.intervals.size,0);f.hub.close();
}
{
 const f=fixture(),socket=new Socket();f.hub.upgrade(request(),socket,Buffer.alloc(0));socket.emit('data',masked(8,Buffer.from([3,232])));assert.deepEqual(socket.output.at(-1),Buffer.from([0x88,2,3,232]),'valid close is echoed');assert.equal(f.released(),1);f.hub.close();
}
{
 const lifetime=new BrowserLifetime({maxClients:2,onIdle:()=>{}}),hub=new BrowserSocketHub({lifetime,allowedHosts:[host]});for(let i=0;i<2;i++)hub.upgrade(request(),new Socket(),Buffer.alloc(0));const third=new Socket();hub.upgrade(request(),third,Buffer.alloc(0));assert.match(third.output[0].toString(),/^HTTP\/1.1 503/);hub.close();lifetime.dispose();
}
// Exercise a genuine HTTP upgrade, native control ping/pong and frame masking.
const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const wireHost='127.0.0.1:'+server.address().port;
const lifetime=new BrowserLifetime({onIdle:()=>{}}),hub=new BrowserSocketHub({lifetime,allowedHosts:[wireHost]});server.on('upgrade',(req,socket,head)=>hub.upgrade(req,socket,head));let peer;
try{
 const result=await new Promise((resolve,reject)=>{const req=http.request('http://'+wireHost+'/api/app/connection',{headers:{Host:wireHost,Origin:'http://'+wireHost,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key}});req.on('upgrade',(res,socket,head)=>resolve({res,socket,head}));req.on('error',reject);req.end();});peer=result.socket;assert.equal(result.res.statusCode,101);
 let buffer=result.head;const next=()=>new Promise(resolve=>{const consume=()=>{if(buffer.length>=2+buffer[1]){const frame=buffer.subarray(0,2+buffer[1]);buffer=buffer.subarray(frame.length);peer.off('data',onData);resolve(frame);return true;}return false;};const onData=chunk=>{buffer=Buffer.concat([buffer,chunk]);consume();};if(!consume())peer.on('data',onData);});
 const ping=await next();assert.equal(ping[0],0x89);peer.write(masked(10,ping.subarray(2)));peer.write(masked(9,Buffer.from('wire')));assert.deepEqual(await next(),Buffer.from([0x8a,4,...Buffer.from('wire')]));
}finally{peer?.destroy();hub.close();lifetime.dispose();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({ok:true,websocketUpgrade:true,originGuards:true,controlOnly:true,maskFinRsvLengthGuards:true,bufferBound:true,pingPong:true,stalePeerCleanup:true,clientCap:true}));
