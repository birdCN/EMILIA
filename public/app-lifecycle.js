// WebSocket control traffic avoids occupying HTTP/1.1's small fetch pool.
// Native ping/pong remains active with frozen JS; visibility never ends a lease.
let active=null,retry=null,paused=false;
const clearRetry=()=>{if(retry!==null){clearTimeout(retry);retry=null;}};
function connect(){
  if(paused||active)return;
  clearRetry();let socket;
  try{
    const url=new URL('/api/app/connection',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    socket=new WebSocket(url);active=socket;
  }catch{if(!paused)retry=setTimeout(connect,500);return;}
  socket.addEventListener('close',()=>{
    if(active===socket){active=null;if(!paused)retry=setTimeout(connect,500);}
  });
  socket.addEventListener('error',()=>{
    // Close events drive retries, including failed initial handshakes.
    try{socket.close();}catch{}
  });
}
addEventListener('pagehide',()=>{paused=true;clearRetry();const socket=active;active=null;socket?.close(1000);});
addEventListener('pageshow',()=>{paused=false;void connect();});
void connect();
