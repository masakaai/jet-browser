import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('profile import rejects a document that changed origin before execution',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8');
 const previous=globalThis.location;globalThis.location={origin:'https://attacker.example'};
 try{
  const result=await new Promise(resolve=>new Function(source)({restore:{}},'https://saved.example',resolve));
  assert.match(result.__masaka_error,/origin changed/);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});

test('profile import restores bodyless responses and invalidates opaque entries for refetch',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8'),written=[];
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage=globalThis.sessionStorage={clear(){},setItem(){}};
 globalThis.indexedDB={databases:async()=>[]};
 globalThis.caches={keys:async()=>[],delete:async()=>true,open:async()=>({keys:async()=>[],delete:async()=>true,put:async(request,response)=>written.push({request,response})})};
 try{
  const result=await new Promise(resolve=>new Function(source)({local_storage:[],session_storage:[],indexed_db:[],cache_storage:[{name:'offline',entries:[{request:{url:'https://example.com/empty'},response:{status:204,statusText:'No Content',headers:[],body:''}},{request:{url:'https://cdn.example/opaque'},response:{status:0,statusText:'',headers:[],body:''}}]}]},resolve));
  assert.deepEqual(result,{ok:true});assert.equal(written.length,1);assert.equal(written[0].response.status,204);assert.equal(await written[0].response.text(),'');
 }finally{
  globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;
 }
});

test('authoritative empty IndexedDB snapshot deletes a database from an older native archive',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8'),deleted=[];
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage=globalThis.sessionStorage={clear(){},setItem(){}};globalThis.caches={keys:async()=>[]};
 globalThis.indexedDB={databases:async()=>[{name:'deleted-login-db'}],deleteDatabase:name=>{deleted.push(name);const request={};queueMicrotask(()=>request.onsuccess?.());return request;}};
 try{assert.deepEqual(await new Promise(resolve=>new Function(source)({restore:{indexed_db:true,cache_storage:false},indexed_db:[]},resolve)),{ok:true});assert.deepEqual(deleted,['deleted-login-db']);}
 finally{globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;}
});

test('blocked authoritative IndexedDB deletion fails instead of marking restore complete',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8');
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage=globalThis.sessionStorage={clear(){},setItem(){}};globalThis.caches={keys:async()=>[]};
 globalThis.indexedDB={databases:async()=>[{name:'open-login-db'}],deleteDatabase:()=>{const request={};queueMicrotask(()=>request.onblocked?.());return request;}};
 try{const result=await new Promise(resolve=>new Function(source)({restore:{indexed_db:true,cache_storage:false},indexed_db:[]},resolve));assert.match(result.__masaka_error,/delete blocked/);}
 finally{globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;}
});

test('application objects using the internal tag name round-trip without coercion',async()=>{
 const exported=await readFile(new URL('../rust/profile-export.js',import.meta.url),'utf8'),imported=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8');
 const encode=new Function(exported.slice(0,exported.indexOf('const openDatabase='))+'return encode;')(()=>{});
 const decode=new Function(imported.slice(0,imported.indexOf('const createDatabase='))+'return decode;')({},()=>{});
 for(const value of [{__masaka:'date',value:'application-value'},{nested:{__masaka:'application',value:3}}])assert.deepEqual(await decode(await encode(value)),value);
});

test('session-only profile import preserves newer native local and cache storage',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8'),local=new Map([['token','native']]),deleted=[];
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage={clear:()=>local.clear(),setItem:(name,value)=>local.set(name,value)};
 globalThis.sessionStorage={clear(){},setItem(){}};globalThis.indexedDB={databases:async()=>[]};
 globalThis.caches={keys:async()=>['native-cache'],delete:async name=>deleted.push(name),open:async()=>({put:async()=>{}})};
 try{
  const state={cookies:[],local_storage:[],session_storage:[{name:'draft',value:'portable'}],indexed_db:[],cache_storage:[],restore:{cookies:false,local_storage:false,session_storage:true,indexed_db:false,cache_storage:false}};
  assert.deepEqual(await new Promise(resolve=>new Function(source)(state,resolve)),{ok:true});assert.equal(local.get('token'),'native');assert.deepEqual(deleted,[]);
 }finally{
  globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;
 }
});

test('profile import upgrades an existing IndexedDB before writing a new store',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8'),records=[];
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage=globalThis.sessionStorage={clear(){},setItem(){}};globalThis.caches={keys:async()=>[]};
 const stores=new Map();let version=1;
 const names=()=>({contains:name=>stores.has(name),[Symbol.iterator]:function*(){yield* stores.keys();}});
 const makeStore=schema=>{const indexes=new Map(),store={keyPath:schema.keyPath??null,autoIncrement:!!schema.autoIncrement,indexNames:{contains:name=>indexes.has(name),[Symbol.iterator]:function*(){yield* indexes.keys();}},createIndex(name,keyPath,options){const value={name,keyPath,unique:!!options.unique,multiEntry:!!options.multiEntry};indexes.set(name,value);return value;},index:name=>indexes.get(name),clear(){records.length=0;},put(value,key){records.push({value,key});}};return store;};
 const database={get version(){return version;},get objectStoreNames(){return names();},createObjectStore(name,options){const store=makeStore(options);stores.set(name,store);return store;},transaction(name){const transaction={objectStore:()=>stores.get(name)};queueMicrotask(()=>transaction.oncomplete?.());return transaction;},close(){}};
 globalThis.indexedDB={databases:async()=>[{name:'app',version:1}],open(_name,nextVersion){const request={};queueMicrotask(()=>{request.result=database;if(nextVersion&&nextVersion>version){version=nextVersion;request.transaction={objectStore:name=>stores.get(name),abort(){}};request.onupgradeneeded?.();}request.onsuccess?.();});return request;}};
 try{
  const state={restore:{local_storage:false,session_storage:false,indexed_db:true,cache_storage:false},indexed_db:[{name:'app',version:2,stores:[{name:'sessions',keyPath:null,autoIncrement:false,indexes:[],records:[{key:'id',value:{token:'saved'}}]}]}]};
  assert.deepEqual(await new Promise(resolve=>new Function(source)(state,resolve)),{ok:true});assert.equal(version,2);assert.deepEqual(records,[{key:'id',value:{token:'saved'}}]);
 }finally{globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;}
});

test('authoritative IndexedDB schema removes stores and indexes absent from the snapshot',async()=>{
 const source=await readFile(new URL('../rust/profile-import.js',import.meta.url),'utf8'),deletedStores=[],deletedIndexes=[];
 const previous={caches:globalThis.caches,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,indexedDB:globalThis.indexedDB};
 globalThis.localStorage=globalThis.sessionStorage={clear(){},setItem(){}};globalThis.caches={keys:async()=>[]};
 const indexes=new Set(['legacy-index']),stores=new Set(['keep','legacy-store']),names=set=>({contains:name=>set.has(name),[Symbol.iterator]:function*(){yield* set;}});
 const store={keyPath:null,autoIncrement:false,get indexNames(){return names(indexes);},index:name=>({name,keyPath:'legacy',unique:false,multiEntry:false}),deleteIndex(name){deletedIndexes.push(name);indexes.delete(name);},createIndex(){},clear(){},put(){}};
 const transaction=()=>{const value={objectStore:()=>store};queueMicrotask(()=>value.oncomplete?.());return value;};
 const database={version:1,get objectStoreNames(){return names(stores);},transaction,close(){},deleteObjectStore(name){deletedStores.push(name);stores.delete(name);},createObjectStore(){throw Error('unexpected store creation');}};
 globalThis.indexedDB={databases:async()=>[{name:'app',version:1}],open(_name,version){const request={};queueMicrotask(()=>{request.result=database;if(version){database.version=version;request.transaction=transaction();request.onupgradeneeded?.();}request.onsuccess?.();});return request;}};
 try{const state={restore:{local_storage:false,session_storage:false,indexed_db:true,cache_storage:false},indexed_db:[{name:'app',version:2,stores:[{name:'keep',keyPath:null,autoIncrement:false,indexes:[],records:[]}]}]};assert.deepEqual(await new Promise(resolve=>new Function(source)(state,resolve)),{ok:true});assert.deepEqual(deletedStores,['legacy-store']);assert.deepEqual(deletedIndexes,['legacy-index']);}
 finally{globalThis.caches=previous.caches;globalThis.localStorage=previous.localStorage;globalThis.sessionStorage=previous.sessionStorage;globalThis.indexedDB=previous.indexedDB;}
});
