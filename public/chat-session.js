const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(id);
// sessionStorage restores a tab across reloads; the Web Lock prevents a duplicated
// tab from claiming the same conversation while its original tab is still open.
export async function acquireChatSession({storage=globalThis.sessionStorage,locks=globalThis.navigator?.locks,
 createId=()=>globalThis.crypto?.randomUUID?.()||`page_${Date.now()}_${Math.random().toString(36).slice(2)}`}={}){
 let id;try{id=storage?.getItem('emilia.chat.session');}catch{}
 if(!valid(id))id=createId();
 const save=()=>{try{storage?.setItem('emilia.chat.session',id);}catch{}};
 if(!locks?.request){save();return id;}
 return new Promise(resolve=>{
  const claim=()=>{
   void locks.request('emilia-chat:'+id,{ifAvailable:true},async lock=>{
    if(!lock){id=createId();claim();return;}
    save();resolve(id);
    // Ownership follows the document lifetime, including a BFCache restore.
    // The browser releases the lock when this document is actually destroyed.
    await new Promise(()=>{});
   }).catch(()=>{save();resolve(id);});
  };claim();
 });
}
