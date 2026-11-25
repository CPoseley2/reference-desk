/* Keep the displayed frame until the requested image has loaded and decoded. */
function createStoryboardImagePresenter({load,commit,onError=()=>{},onBusy=()=>{}}){
 const cache=new Map();let serial=0,displayed=null,desired=new Set();
 function get(url){
  if(!cache.has(url)){
   const record={};record.promise=Promise.resolve().then(()=>load(url));cache.set(url,record);
   record.promise.catch(()=>{if(cache.get(url)===record)cache.delete(url);});
  }
  return cache.get(url).promise;
 }
 function trim(){for(const url of cache.keys())if(url!==displayed&&!desired.has(url))cache.delete(url);}
 return {
  async present(shot,nearby=[]){
   const request=++serial;desired=new Set([shot.url,...nearby.map(s=>s.url)]);trim();onBusy(true);
   const pending=get(shot.url);
   for(const s of nearby)get(s.url).catch(()=>{});
   try{
    const image=await pending;
    if(request!==serial)return false;
    commit(image,shot);displayed=shot.url;onBusy(false);trim();return true;
   }catch(error){if(request===serial){onBusy(false);onError(error,shot);}return false;}
  },
  cancel(){serial++;onBusy(false);},
  cacheSize(){return cache.size;}
 };
}
function loadDecodedStoryboardImage(url){
 const image=new Image();image.decoding='async';
 return new Promise((resolve,reject)=>{
  image.onerror=()=>reject(new Error('Image could not load'));
  image.onload=async()=>{
   try{if(image.decode)await image.decode();if(!image.naturalWidth)throw new Error('Empty image');resolve(image);}
   catch(error){reject(error);}
  };
  image.src=url;
 });
}
if(typeof module!=='undefined'&&module.exports)module.exports={createStoryboardImagePresenter};
