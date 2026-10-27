import assert from 'node:assert/strict';
import {mkdtemp, readdir, copyFile, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import http from 'node:http';

const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=await mkdtemp(join(tmpdir(),'emilia-onboarding-'));
let child,browser,fake;
const portForTest=async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
try {
  // Copy source only. The real installation's learner data, keys and caches are never opened.
  await mkdir(join(fixture,'public'));
  for(const file of await readdir(root))if(file.endsWith('.mjs'))await copyFile(join(root,file),join(fixture,file));
  for(const file of await readdir(join(root,'public')))if(/\.(js|html|css)$/.test(file))await copyFile(join(root,'public',file),join(fixture,'public',file));
  await mkdir(join(fixture,'public','assets','branding'),{recursive:true});
  await copyFile(join(root,'public','assets','branding','emilia.ico'),join(fixture,'public','assets','branding','emilia.ico'));
  const pythonQuery="import('./local-paths.mjs').then(m=>console.log(m.PYTHON_EXECUTABLE))";
  const pathEnv={...process.env,IELTS_PYTHON_PATH:'',IELTS_RUNTIME_ROOT:join(fixture,'runtime')};
  const sourcePython=spawnSync(process.execPath,['--input-type=module','-e',pythonQuery],{cwd:fixture,env:pathEnv,encoding:'utf8',windowsHide:true});
  assert.equal(sourcePython.status,0);
  assert.equal(sourcePython.stdout.trim(),join(fixture,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python'));
  if(process.platform==='win32'){
    await mkdir(join(fixture,'runtime','python'),{recursive:true});
    await writeFile(join(fixture,'runtime','python','python.exe'),'synthetic path fixture, never executable');
    const bundled=spawnSync(process.execPath,['--input-type=module','-e',pythonQuery],{cwd:fixture,env:pathEnv,encoding:'utf8',windowsHide:true});
    assert.equal(bundled.status,0);assert.equal(bundled.stdout.trim(),join(fixture,'runtime','python','python.exe'));
  }
  const port=await portForTest(),origin=`http://127.0.0.1:${port}`;
  const configPath=join(fixture,'private','settings.json');
  child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...process.env,IELTS_DEMO_PORT:String(port),IELTS_MODEL_CONFIG_PATH:configPath,IELTS_RUNTIME_ROOT:join(fixture,'runtime'),IELTS_LEARNER_DATA_ROOT:join(fixture,'learner'),IELTS_SKIP_WARMUP:'1'},stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stdout.on('data',v=>diagnostics+=v);child.stderr.on('data',v=>diagnostics+=v);
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,`isolated backend failed to start: ${diagnostics}`);
  assert.match(await (await fetch(origin)).text(),/id="setupForm"/,'fresh install must open the first-run guide');
  assert.match(await (await fetch(origin+'/index.html')).text(),/id="setupForm"/,'index must not bypass onboarding');
  assert.match(await (await fetch(origin+'/setup')).text(),/id="setupForm"/);
  const headers={'X-Emilia-Settings':'1','Content-Type':'application/json'};
  assert.equal((await fetch(origin+'/api/model/settings')).status,403);
  let saved=await (await fetch(origin+'/api/model/settings',{headers})).json();
  assert.equal(saved.hasKey,false);
  assert.equal(saved.setupRequired,true);
  let providerCalls=0;
  fake=http.createServer((req,res)=>{providerCalls++;req.resume();res.writeHead(500);res.end('Provider must not be called by setup');});
  await new Promise(r=>fake.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${fake.address().port}/v1`;
  const draft={revision:saved.revision,mode:'api',provider:'custom',protocol:'openai',baseUrl:endpoint,model:'fixture-model',apiKey:'',disableThinking:true};
  const bad=await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify({...draft,model:''})});
  assert.equal((await bad.json()).ok,false);
  assert.match(await (await fetch(origin)).text(),/id="setupForm"/,'failed save must leave onboarding active');
  if(process.env.EMILIA_PLAYWRIGHT_MODULE){
    const {chromium}=await import(process.env.EMILIA_PLAYWRIGHT_MODULE);
    browser=await chromium.launch({headless:true,...(process.env.EMILIA_BROWSER_EXECUTABLE?{executablePath:process.env.EMILIA_BROWSER_EXECUTABLE}:{})});
    const page=await browser.newPage({viewport:{width:1200,height:850}});
    const outsideRequests=[];
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      outsideRequests.push(route.request().url());return route.abort();
    });
    await page.goto(origin);
    await page.locator('#nextStep:enabled').waitFor();
    if(process.env.EMILIA_ONBOARDING_SCREENSHOT_DIR){
      await mkdir(process.env.EMILIA_ONBOARDING_SCREENSHOT_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.EMILIA_ONBOARDING_SCREENSHOT_DIR,'onboarding-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'guide must fit mobile width');
      await page.screenshot({path:join(process.env.EMILIA_ONBOARDING_SCREENSHOT_DIR,'onboarding-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1200,height:850});
    }
    await page.locator('#provider').selectOption('custom');
    await page.locator('#nextStep').click();
    await page.locator('#baseUrl').fill(endpoint);
    await page.locator('#model').fill('fixture-model');
    // A real failed backend save is shown in the guide and leaves the draft editable.
    await page.locator('#baseUrl').fill('http://example.invalid/v1');
    await page.locator('#apiKey').fill('fake-key-for-onboarding-only');
    await page.locator('#saveSettings').click();
    await page.locator('#setupStatus[data-error="true"]').waitFor();
    await page.locator('#baseUrl').fill(endpoint);
    await page.locator('#apiKey').fill('');
    await page.locator('#saveSettings').click();
    await page.locator('#setupDone:not([hidden])').waitFor();
    assert.equal(await page.locator('#apiKey').inputValue(),'');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
    assert.equal(await page.locator('#startPractice').getAttribute('href'),'/');
    assert.match(await page.locator('#setupDone').innerText(),/未验证/);
    assert.deepEqual(outsideRequests,[],'onboarding must make no external network requests');
    await page.goto(origin+'/setup');
    await page.locator('#nextStep').click();
    assert.equal(await page.locator('#apiKey').inputValue(),'');
    // Keep the page's lifetime stream open through the remaining backend checks.
  } else {
    const response=await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify(draft)});
    assert.equal(response.status,200);
  }
  saved=await (await fetch(origin+'/api/model/settings',{headers})).json();
  assert.equal(saved.setupRequired,false);
  assert.match(await (await fetch(origin)).text(),/class="app-shell"/);
  assert.match(await (await fetch(origin+'/setup')).text(),/id="setupForm"/,'explicit setup remains available');
  if(process.platform==='win32'){
    const response=await fetch(origin+'/api/model/settings',{method:'POST',headers,body:JSON.stringify({...draft,revision:saved.revision,apiKey:'fake-key-for-onboarding-only'})});
    assert.equal(response.status,200);
    const safe=await response.json();
    assert.equal(safe.hasKey,true);
    assert.equal(safe.apiKey,undefined);
    assert.equal(safe.encryptedKey,undefined);
    assert.equal(JSON.stringify(safe).includes('fake-key-for-onboarding-only'),false);
    const disk=await readFile(configPath,'utf8');
    assert.equal(disk.includes('fake-key-for-onboarding-only'),false,'Windows DPAPI must protect the key on disk');
    const {ModelSettings}=await import('../model-settings.mjs');
    const reopened=new ModelSettings(configPath);
    assert.equal(reopened.apiKey,'fake-key-for-onboarding-only','Windows must decrypt the saved key for the same user');
    assert.equal(reopened.public().hasKey,true);
  }
  assert.equal(providerCalls,0,'opening and saving the guide must never contact the provider');
  console.log(JSON.stringify({ok:true,onboarding:true,dpapi:process.platform==='win32',browser:Boolean(process.env.EMILIA_PLAYWRIGHT_MODULE),providerCalls}));
} finally {
  await browser?.close();
  if(child&&!child.killed){child.kill();await new Promise(r=>child.once('exit',r));}
  if(fake)await new Promise(r=>fake.close(r));
  // fixture is an absolute mkdtemp child of the OS temp directory, never the app root.
  assert.ok(resolve(fixture).startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(fixture,{recursive:true,force:true});
}
