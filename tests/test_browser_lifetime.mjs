import assert from 'node:assert/strict';
import {BrowserLifetime} from '../browser-lifetime.mjs';

function clock(){let now=0,id=0;const timers=new Map();return {setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),tick(ms){now+=ms;for(;;){const next=[...timers].find(([,t])=>t.at<=now);if(!next)break;timers.delete(next[0]);next[1].fn();}},pending:()=>timers.size};}
function fixture(options={}){const time=clock(),events=[];const lifetime=new BrowserLifetime({...time,...options,onIdle:reason=>events.push(reason)});lifetime.start();return {time,events,lifetime};}
{
 const {lifetime,time,events}=fixture();time.tick(1000000);assert.deepEqual(events,[],'API-only startup must remain running');
 const closeOne=lifetime.connect(),closeTwo=lifetime.connect();assert.equal(lifetime.snapshot().clients,2);
 closeOne();closeOne();time.tick(5001);assert.deepEqual(events,[],'another live tab keeps the app running');
 closeTwo();time.tick(4999);assert.deepEqual(events,[]);const refresh=lifetime.connect();time.tick(10);assert.deepEqual(events,[],'refresh cancels last-tab grace');
 refresh();time.tick(5000);assert.deepEqual(events,['last-browser-closed']);assert.equal(lifetime.connect(),null,'no new clients after shutdown begins');
}
{
 const {lifetime,time,events}=fixture({startupGraceMs:60000});time.tick(59999);assert.deepEqual(events,[]);time.tick(1);assert.deepEqual(events,['browser-startup-timeout']);
}
{
 const {lifetime,time,events}=fixture({startupGraceMs:60000,maxClients:2});const a=lifetime.connect(),b=lifetime.connect();assert.equal(lifetime.connect(),null);time.tick(100000);assert.deepEqual(events,[],'live background document does not expire');a();b();lifetime.dispose();time.tick(100000);assert.deepEqual(events,[]);assert.equal(time.pending(),0);
}
console.log(JSON.stringify({ok:true,browserLifetime:true,multipleTabs:true,reconnect:true,startup:true,clientCap:true,noHeartbeatExpiry:true}));
