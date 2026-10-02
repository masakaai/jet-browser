import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readNativeDownloadJournal,waitForDownloadReady} from '../src/download-ready.mjs';
async function fixture(run){const root=await realpath(await mkdtemp(join(tmpdir(),'masaka-ready-')));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
test('missing/partial marker is not ready, complete marker permits bounded journal read',()=>fixture(async root=>{
 assert.equal((await readNativeDownloadJournal(root)).ready,false);
 await writeFile(join(root,'events.tsv'),'rea');assert.equal((await readNativeDownloadJournal(root)).ready,false);
 await writeFile(join(root,'events.tsv'),'ready\n');assert.deepEqual(await waitForDownloadReady(root),{ready:true,text:'ready\n'});
}));
test('native readiness timeout and cancellation are explicit failures, not success',()=>fixture(async root=>{
 await assert.rejects(waitForDownloadReady(root,{timeoutMs:20,pollMs:5}),/not ready/);
 const control=new AbortController();control.abort(Error('stop requested'));
 await assert.rejects(waitForDownloadReady(root,{signal:control.signal}),/stop requested/);
}));
test('symlink, oversized, malformed and non-UTF8 journals fail closed',()=>fixture(async root=>{
 const journal=join(root,'events.tsv');
 await writeFile(join(root,'other'),'ready\n');await symlink(join(root,'other'),journal);await assert.rejects(readNativeDownloadJournal(root));await rm(journal);
 for(const value of ['wrong\n','ready\ninvalid\n',Buffer.alloc(1048577),Buffer.from([255])]){
  await writeFile(journal,value);await assert.rejects(readNativeDownloadJournal(root));
 }
}));
