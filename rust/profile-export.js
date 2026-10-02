const done=arguments[arguments.length-1];
const bytesToBase64=bytes=>{let value='';for(let offset=0;offset<bytes.length;offset+=32768)value+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(value)};
const encode=async(value,seen=new WeakSet())=>{
 if(value===null||['string','boolean'].includes(typeof value))return value;
 if(typeof value==='number')return Number.isFinite(value)?value:{__masaka:'number',value:String(value)};
 if(typeof value==='bigint')return {__masaka:'bigint',value:String(value)};
 if(typeof value==='undefined')return {__masaka:'undefined'};
 if(typeof value!=='object')throw new Error('Unsupported stored value');
 if(value instanceof Date)return {__masaka:'date',value:value.toISOString()};
 if(value instanceof ArrayBuffer)return {__masaka:'arraybuffer',value:bytesToBase64(new Uint8Array(value))};
 if(ArrayBuffer.isView(value))return {__masaka:'typedarray',name:value.constructor.name,value:bytesToBase64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
 if(value instanceof Blob)return {__masaka:'blob',type:value.type,value:bytesToBase64(new Uint8Array(await value.arrayBuffer()))};
 if(typeof CryptoKey!=='undefined'&&value instanceof CryptoKey){if(!value.extractable)throw new Error('A non-extractable CryptoKey cannot be exported');return {__masaka:'cryptokey',type:value.type,algorithm:value.algorithm,usages:value.usages,format:value.type==='secret'?'raw':'jwk',value:await crypto.subtle.exportKey(value.type==='secret'?'raw':'jwk',value).then(item=>item instanceof ArrayBuffer?bytesToBase64(new Uint8Array(item)):item)};}
 if(seen.has(value))throw new Error('Cyclic stored values cannot be exported');seen.add(value);
 if(Array.isArray(value)){const result=[];for(const item of value)result.push(await encode(item,seen));seen.delete(value);return result;}
 if(value instanceof Map){const entries=[];for(const [key,item] of value)entries.push([await encode(key,seen),await encode(item,seen)]);seen.delete(value);return {__masaka:'map',entries};}
 if(value instanceof Set){const values=[];for(const item of value)values.push(await encode(item,seen));seen.delete(value);return {__masaka:'set',values};}
 const result={};for(const key of Object.keys(value))result[key]=await encode(value[key],seen);seen.delete(value);return {__masaka:'object',value:result};
};
const openDatabase=name=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
const cursorEntries=store=>new Promise((resolve,reject)=>{const values=[],request=store.openCursor();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(values);return}try{values.push({key:cursor.key,value:cursor.value});if(values.length>10000)throw new Error('IndexedDB store exceeds 10000 records');cursor.continue()}catch(error){reject(error)}};});
const encodeEntries=async records=>{const result=[];for(const record of records)result.push({key:await encode(record.key),value:await encode(record.value)});return result;};
(async()=>{
 const local_storage=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).map(name=>({name,value:localStorage.getItem(name)}));
 const session_storage=Array.from({length:sessionStorage.length},(_,index)=>sessionStorage.key(index)).map(name=>({name,value:sessionStorage.getItem(name)}));
 const indexed_db=[];
 if(typeof indexedDB.databases==='function')for(const metadata of (await indexedDB.databases()).filter(item=>item.name).slice(0,64)){
  const database=await openDatabase(metadata.name),stores=[];
  for(const name of Array.from(database.objectStoreNames)){const transaction=database.transaction(name,'readonly'),store=transaction.objectStore(name),indexes=Array.from(store.indexNames).map(indexName=>{const index=store.index(indexName);return {name:index.name,keyPath:index.keyPath,unique:index.unique,multiEntry:index.multiEntry}}),records=await cursorEntries(store);stores.push({name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes,records:await encodeEntries(records)});}
  indexed_db.push({name:database.name,version:database.version,stores});database.close();
 }
 const cache_storage=[];
 if(typeof caches!=='undefined')for(const name of (await caches.keys()).slice(0,64)){const cache=await caches.open(name),entries=[];for(const request of (await cache.keys()).slice(0,1000)){const response=await cache.match(request);if(!response||response.status===0)continue;entries.push({request:{url:request.url,method:request.method,headers:Array.from(request.headers.entries())},response:{status:response.status,statusText:response.statusText,headers:Array.from(response.headers.entries()),body:bytesToBase64(new Uint8Array(await response.arrayBuffer()))}});}cache_storage.push({name,entries});}
 done({local_storage,session_storage,indexed_db,cache_storage});
})().catch(error=>done({__masaka_error:String(error?.message||error).slice(0,2000)}));
