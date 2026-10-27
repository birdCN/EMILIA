import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const frames=[],child=new EventEmitter();child.exitCode=null;child.stdout=new EventEmitter();child.stderr=new EventEmitter();
child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.stdin={write:s=>frames.push(JSON.parse(s))};child.kill=()=>{child.killed=true;};
const Client=vm.runInNewContext(source.slice(source.indexOf('class CodexAppServerClient'),source.indexOf('\nasync function withCodex'))+'\nCodexAppServerClient',
 {spawn:()=>child,DEMO_ROOT:'fixture',process:{env:{}},setTimeout,clearTimeout,CODEX_TIMEOUT_MS:20});
const c=new Client('fixture');
try{
 const pending=c.request('turn/start',{threadId:'one'});c.cancelTurn('one');
 child.stdout.emit('data',JSON.stringify({id:frames[0].id,result:{turn:{id:'turn-one'}}})+'\n');await pending;
 assert.equal(frames[1].method,'turn/interrupt');assert.equal(frames[1].params.threadId,'one');assert.equal(frames[1].params.turnId,'turn-one');
 child.stdout.emit('data',JSON.stringify({id:frames[1].id,result:{}})+'\n');
 assert.equal(c.isAlive(),true);assert.equal(frames.filter(f=>f.method==='turn/interrupt').length,1);
 console.log('PASS: a cancelled pending Codex turn is interrupted once when its scoped turn ID arrives');
}finally{c.close();}
