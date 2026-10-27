import {createHash,randomBytes} from 'node:crypto';

const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame=(opcode,payload=Buffer.alloc(0))=>Buffer.concat([Buffer.from([0x80|opcode,payload.length]),payload]);
const validCloseCode=code=>[1000,1001,1002,1003,1007,1008,1009,1010,1011,1012,1013,1014].includes(code)||(code>=3000&&code<=4999);

// A deliberately control-only RFC6455 transport. No text, binary, extensions,
// fragmented messages, credentials or conversation data travel on this socket.
export class BrowserSocketHub {
  constructor({lifetime,allowedHosts,pingMs=15000,setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval}={}){
    if(typeof lifetime?.connect!=='function'||!Array.isArray(allowedHosts)||!allowedHosts.length||!Number.isFinite(pingMs)||pingMs<=0)throw new TypeError('Invalid browser socket options');
    Object.assign(this,{lifetime,allowedHosts:new Set(allowedHosts),pingMs,setInterval,clearInterval});this.connections=new Set();this.stopping=false;
  }
  reject(socket,status){
    const timer=setTimeout(()=>socket.destroy(),250);timer.unref();socket.once('close',()=>clearTimeout(timer));
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  upgrade(req,socket,head=Buffer.alloc(0)){
    socket.on('error',()=>socket.destroy());
    if(req.url!=='/api/app/connection'){this.reject(socket,404);return;}
    const headers=req.headers;
    if(!this.allowedHosts.has(headers.host)||headers.origin!==`http://${headers.host}`||(headers['sec-fetch-site']&&headers['sec-fetch-site']!=='same-origin')){this.reject(socket,403);return;}
    const key=headers['sec-websocket-key'];
    if(req.method!=='GET'||req.httpVersion!=='1.1'||String(headers.upgrade).toLowerCase()!=='websocket'
      ||!String(headers.connection).toLowerCase().split(',').some(value=>value.trim()==='upgrade')||headers['sec-websocket-version']!=='13'
      ||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)||Buffer.from(key,'base64').length!==16||Buffer.from(key,'base64').toString('base64')!==key){this.reject(socket,400);return;}
    const disconnect=this.stopping?null:this.lifetime.connect();
    if(!disconnect){this.reject(socket,503);return;}
    socket.setNoDelay(true);socket.setTimeout(0);
    let buffer=Buffer.alloc(0),released=false,closing=false,interval,closeTimer,nonce=Buffer.alloc(0),awaitingPong=false,missedPongs=0;
    const release=()=>{if(released)return;released=true;this.clearInterval(interval);this.connections.delete(peer);disconnect();};
    const destroy=()=>{release();socket.destroy();};
    const send=(opcode,payload)=>{
      if(released||socket.destroyed)return false;
      if(socket.writableLength>4096){destroy();return false;}
      try{return socket.write(frame(opcode,payload));}catch{destroy();return false;}
    };
    const close=(payload=Buffer.from([3,233]))=>{
      if(closing||released)return;closing=true;
      closeTimer=setTimeout(()=>socket.destroy(),250);closeTimer.unref();
      const bytes=frame(8,payload);release();socket.end(bytes);
    };
    const fail=code=>{const payload=Buffer.alloc(2);payload.writeUInt16BE(code);close(payload);};
    const consume=chunk=>{
      if(released)return;
      if(buffer.length+chunk.length>1024){fail(1009);return;}
      buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;
      while(buffer.length>=2){
        const first=buffer[0],opcode=first&15,length=buffer[1]&127;
        if(!(first&128)||(first&112)||!(buffer[1]&128)){fail(1002);return;}
        if(opcode===1||opcode===2){fail(1003);return;}
        if(![8,9,10].includes(opcode)||length>125){fail(1002);return;}
        if(buffer.length<6+length)return;
        const payload=Buffer.alloc(length);for(let i=0;i<length;i++)payload[i]=buffer[6+i]^buffer[2+(i&3)];
        buffer=buffer.subarray(6+length);
        if(opcode===8){
          if(length===1||(length>=2&&!validCloseCode(payload.readUInt16BE(0)))){fail(1002);return;}
          try{if(length>2)new TextDecoder('utf-8',{fatal:true}).decode(payload.subarray(2));}catch{fail(1007);return;}
          close(payload);return;
        }
        if(opcode===9)send(10,payload);
        else if(awaitingPong&&payload.equals(nonce)){awaitingPong=false;missedPongs=0;}
        if(released)return;
      }
    };
    const ping=()=>{
      if(released)return;
      // Native browser networking answers control pings even with frozen JS.
      if(awaitingPong&&++missedPongs>=2){destroy();return;}
      nonce=randomBytes(8);awaitingPong=true;send(9,nonce);
    };
    const peer={close:()=>close()};this.connections.add(peer);
    socket.once('close',()=>{clearTimeout(closeTimer);release();});socket.once('end',()=>{release();socket.end();});socket.on('data',consume);
    const accept=createHash('sha1').update(key+GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    interval=this.setInterval(ping,this.pingMs);interval.unref?.();ping();if(head.length)consume(head);
  }
  close(){this.stopping=true;for(const peer of [...this.connections])peer.close();}
}
