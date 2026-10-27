import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,copyFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
if(!process.env.EMILIA_PLAYWRIGHT_MODULE){console.log(JSON.stringify({ok:true,browserLifetimeBrowser:'skipped; set EMILIA_PLAYWRIGHT_MODULE for headless acceptance'}));process.exit(0);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=fileURLToPath(new URL('..',import.meta.url)),fixture=await mkdtemp(join(tmpdir(),'emilia-lifetime-browser-'));
let child,closed,browser,foreignServer,logs='';
try{
 await mkdir(join(fixture,'public'));for(const name of await readdir(root))if(name.endsWith('.mjs')||name==='package.json')await copyFile(join(root,name),join(fixture,name));
 for(const name of await readdir(join(root,'public')))if(/\.(js|html|css)$/.test(name))await copyFile(join(root,'public',name),join(fixture,'public',name));
 // Only release artwork/branding dependencies; never copy a voice cache or data.
 for(const name of ['branding','avatar-v3','room'])await cp(join(root,'public/assets',name),join(fixture,'public/assets',name),{recursive:true});
 for(const name of ['emilia-performance-v4.runtime.html','emilia-performance-v4.js','emilia-face-library.js'])await copyFile(join(root,'public/assets',name),join(fixture,'public/assets',name));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...process.env,IELTS_DEMO_PORT:String(port),IELTS_SKIP_WARMUP:'1',EMILIA_BROWSER_STARTUP_GRACE_MS:'0',IELTS_RUNTIME_ROOT:join(fixture,'runtime'),IELTS_LEARNER_DATA_ROOT:join(fixture,'learner'),IELTS_MODEL_CONFIG_PATH:join(fixture,'settings.json')},stdio:['ignore','pipe','pipe']});closed=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await sleep(50);}assert.ok(ready,logs);
 const {chromium}=await import(process.env.EMILIA_PLAYWRIGHT_MODULE);browser=await chromium.launch({headless:true,...(process.env.EMILIA_BROWSER_EXECUTABLE?{executablePath:process.env.EMILIA_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext();
 await context.addInitScript(()=>{
   const NativeWebSocket=WebSocket;window.__emiliaTestSockets=[];
   window.WebSocket=class extends NativeWebSocket{constructor(...args){super(...args);if(new URL(String(args[0]),location.href).pathname==='/api/app/connection'){window.__emiliaTestSockets.push(this);if(!sessionStorage.getItem('emilia.test.first-socket-failed')){sessionStorage.setItem('emilia.test.first-socket-failed','1');queueMicrotask(()=>this.close());}}}};
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);const pageErrors=[];context.on('page',p=>p.on('pageerror',e=>pageErrors.push(e.message)));page.on('pageerror',e=>pageErrors.push(e.message));
 await context.route('**/api/opening',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"skip":true}'}));
 const connection=p=>p.waitForEvent('websocket',{predicate:socket=>socket.url().endsWith('/api/app/connection')}).then(()=>p.waitForFunction(()=>window.__emiliaTestSockets?.some(socket=>socket.readyState===WebSocket.OPEN)));
 let live=connection(page);await page.goto(origin);await live;assert.ok(await page.evaluate(()=>window.__emiliaTestSockets.length>=2),'initial socket failure retries without needing a visibility change');
 live=connection(page);await page.reload();await live;
 const headers={'X-Emilia-Settings':'1','Content-Type':'application/json'};const settings=await(await fetch(origin+'/api/model/settings',{headers})).json();
 assert.equal((await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify({...settings,mode:'api',provider:'custom',protocol:'openai',baseUrl:'http://127.0.0.1:1',model:'synthetic-lifecycle-only',apiKey:''})})).status,200);
 live=connection(page);await page.goto(origin);await live;assert.equal(await page.title(),'EMILIA · English Coach');
 const avatar=page.frames().find(frame=>frame.url().includes('emilia-performance-v4.runtime.html'));assert.ok(avatar);await avatar.waitForFunction(()=>globalThis.avatarDiagnostics?.snapshot().ready);const avatarReady=await avatar.evaluate(()=>avatarDiagnostics.snapshot().ready);
 live=connection(page);await page.goto(origin+'/setup');await live;
 live=connection(page);await page.goto(origin);await live;
 const second=await context.newPage();second.setDefaultTimeout(15000);live=connection(second);await second.goto(origin+'/setup');await live;
 const extra=[],poolChecks=[];
 for(let tabs=3;tabs<=8;tabs++){
   const tab=await context.newPage();extra.push(tab);live=connection(tab);await tab.goto(origin+'/setup');await live;
   if(tabs===6||tabs===8){const requests=await second.evaluate(async()=>{const rows=[];for(const path of ['/api/health','/api/learner/profile']){const started=performance.now();const response=await fetch(path,{signal:AbortSignal.timeout(2000)});rows.push({path,status:response.status,ms:Math.round(performance.now()-started)});}return rows;});assert.ok(requests.every(row=>row.status===200&&row.ms<2000));poolChecks.push({tabs,requests});}
 }
 await Promise.all(extra.map(tab=>tab.close()));
 foreignServer=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<title>Foreign owner</title><iframe src="${origin}/setup"></iframe>`);});await new Promise(r=>foreignServer.listen(0,'127.0.0.1',r));
 const foreign=await context.newPage();let foreignLeases=0;foreign.on('websocket',socket=>{if(socket.url().endsWith('/api/app/connection'))foreignLeases++;});await foreign.goto(`http://127.0.0.1:${foreignServer.address().port}`);await sleep(750);
 await page.close();await sleep(250);assert.equal((await fetch(origin+'/api/health')).status,200,'closing one tab must not stop the other');
 const cdp=await context.newCDPSession(second);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await sleep(35000);assert.equal((await fetch(origin+'/api/health')).status,200,'a frozen background document answers native control pings without JS timers');await cdp.send('Page.setWebLifecycleState',{state:'active'});
 live=connection(second);await second.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await sleep(100);await second.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await live;
 const started=Date.now();await second.close();let timer;const exit=await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Last real page did not stop backend while a foreign iframe owner remained open: '+logs)),8500);})]);clearTimeout(timer);assert.equal(exit.code,0,logs);assert.ok(Date.now()-started>=4500);assert.equal(foreign.isClosed(),false);assert.equal(foreignLeases,0,'foreign embedding must not acquire a document connection');assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({ok:true,headless:true,initialRetry:true,refresh:true,mainSetupNavigation:true,twoTabs:true,httpPoolChecks:poolChecks,frozenBackground:true,pageHideShow:true,sameOriginAvatar:avatarReady,foreignFrameCannotRetain:true,lastPageExit:exit,shutdownMs:Date.now()-started}));
}finally{await browser?.close();if(child&&child.exitCode===null&&!child.killed){child.kill();await closed;}if(foreignServer){foreignServer.closeAllConnections();await new Promise(r=>foreignServer.close(r));}assert.ok(resolve(fixture).startsWith(resolve(tmpdir())+sep));await rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});}

