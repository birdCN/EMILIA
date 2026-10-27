// A live response represents a document. Background tabs do not expire by time.
export class BrowserLifetime {
  constructor({onIdle,graceMs=5000,startupGraceMs=0,maxClients=32,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    if(typeof onIdle!=='function'||!Number.isFinite(graceMs)||graceMs<0||!Number.isFinite(startupGraceMs)||startupGraceMs<0||!Number.isInteger(maxClients)||maxClients<1)throw new TypeError('Invalid browser lifetime options');
    Object.assign(this,{onIdle,graceMs,startupGraceMs,maxClients,setTimer,clearTimer});
    this.clients=new Set();this.seen=false;this.stopping=false;this.started=false;this.timer=null;
  }
  start(){if(this.started||this.stopping)return;this.started=true;if(!this.seen&&this.startupGraceMs)this.arm(this.startupGraceMs,'browser-startup-timeout');}
  clear(){if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}}
  arm(delay,reason){this.clear();this.timer=this.setTimer(()=>{this.timer=null;if(this.stopping||this.clients.size)return;this.stopping=true;this.onIdle(reason);},delay);}
  connect(){
    if(this.stopping||this.clients.size>=this.maxClients)return null;
    this.clear();this.seen=true;const token={};this.clients.add(token);
    return ()=>{if(!this.clients.delete(token)||this.stopping)return;if(!this.clients.size)this.arm(this.graceMs,'last-browser-closed');};
  }
  dispose(){this.stopping=true;this.clear();this.clients.clear();}
  snapshot(){return {clients:this.clients.size,seen:this.seen,stopping:this.stopping};}
}
