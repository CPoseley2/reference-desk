/* Scope recovery, drafts, filters, and job tracking to this page's library. */
(()=>{
 const context=Object.freeze({...window.DESK_CONTEXT});window.DESKContext=context;
 const prefix='reference-desk-library:'+context.id+':';
 function scoped(storage){
  const keys=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix));
  return {getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,value),
   removeItem:key=>storage.removeItem(prefix+key),key:index=>keys()[index]?.slice(prefix.length)??null,
   get length(){return keys().length;}};
 }
 // Keep each old recovery entry intact while copying it to the migrated first library.
 try{
  const marker='reference-desk-migrated:'+context.id;
  if(context.migrate_legacy_storage&&!window.localStorage.getItem(marker)){
   for(const storage of [window.localStorage,window.sessionStorage]){
    const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith('desk-'));
    for(const key of keys)if(storage.getItem(prefix+key)===null)storage.setItem(prefix+key,storage.getItem(key));
   }
   window.localStorage.setItem(marker,'1');
  }
 }catch(error){console.warn('Library recovery cache could not be migrated.',error.name);}
 // Resolve storage lazily so unavailable browser storage still uses existing recovery UI.
 const adapter=name=>({getItem:key=>scoped(window[name]).getItem(key),setItem:(key,value)=>scoped(window[name]).setItem(key,value),
  removeItem:key=>scoped(window[name]).removeItem(key),key:index=>scoped(window[name]).key(index),get length(){return scoped(window[name]).length;}});
 window.DESKStorage=adapter('localStorage');window.DESKSessionStorage=adapter('sessionStorage');
 window.addEventListener('storage',event=>{
  if(event.key!==null&&!event.key.startsWith(prefix))return;
  window.dispatchEvent(new StorageEvent('desk-storage',{key:event.key===null?null:event.key.slice(prefix.length),
   oldValue:event.oldValue,newValue:event.newValue,url:event.url,storageArea:event.storageArea}));
 });
})();
