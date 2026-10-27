const TTL=24*3600000;
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(id);
export class TemporaryChats {
 constructor(store,{clock=Date.now,cleanupIntervalMs=60000,onExpired=null}={}){
  this.store=store;this.clock=clock;this.prune();
  this.timer=setInterval(()=>{try{const ids=this.prune();if(ids.length)onExpired?.(ids);}catch{/* A storage transaction may defer cleanup until the next tick. */}},cleanupIntervalMs);this.timer.unref?.();
 }
 close(){clearInterval(this.timer);}
 load(id,now=this.clock()){
  if(!this.store||!valid(id))return null;
  const row=this.store.getCheckpoint('casual:'+id);
  if(!row)return null;
  if(row.kind!=='casual'||row.version!==1||!Number.isFinite(row.expiresAt)||row.expiresAt<=now){this.discard(id);return null;}
  return row;
 }
 brief(id,now=this.clock()){
  const row=this.load(id,now);return row?{turnCount:row.turns.length,savedAt:row.savedAt,expiresAt:new Date(row.expiresAt).toISOString()}:null;
 }
 save(id,{turns=[],history=[],dialogue=null,memoryId=''},now=this.clock()){
  if(!this.store)return;if(!valid(id))throw new Error('临时聊天会话无效。');
  this.store.checkpoint('casual:'+id,{version:1,kind:'casual',sessionId:id,savedAt:new Date(now).toISOString(),expiresAt:now+TTL,
    memoryId,turns:turns.slice(-120),history:history.slice(-40),dialogue});
 }
 discard(id){if(this.store&&valid(id))this.store.deleteCheckpoint('casual:'+id);}
 prune(now=this.clock()){
  const expired=[];if(!this.store)return expired;
  for(const row of this.store.listCheckpoints())if(row.id.startsWith('casual:')&&(!Number.isFinite(row.data?.expiresAt)||row.data.expiresAt<=now)){this.store.deleteCheckpoint(row.id);expired.push(row.id.slice(7));}
  return expired;
 }
}
