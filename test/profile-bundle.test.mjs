import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyProfile,packProfile,profilePath,profileWorkspace,removeProfile,unpackProfile} from '../src/profile-bundle.mjs';
const user='11111111-1111-4111-8111-111111111111',profile='22222222-2222-4222-8222-222222222222';
test('profile bundles are owner-bound encrypted archives with exact paths',async()=>{
 const old=process.env.VAULT_ENCRYPTION_KEY;process.env.VAULT_ENCRYPTION_KEY='01'.repeat(32);const root=await mkdtemp(path.join(tmpdir(),'masaka-profile-'));
 try{const directory=await emptyProfile(root,user,profile);await writeFile(path.join(directory,'state'),'secret-state');const bundle=await packProfile(root,user,profile,{revision:17});assert.equal(bundle.includes(Buffer.from('secret-state')),false);await removeProfile(root,user,profile);const restored=await unpackProfile(bundle,root,user,profile,{withMetadata:true});assert.equal(restored.directory,directory);assert.equal(restored.revision,17);assert.equal(await readFile(path.join(directory,'state'),'utf8'),'secret-state');await assert.rejects(unpackProfile(bundle,root,user,'33333333-3333-4333-8333-333333333333'));assert.throws(()=>profilePath(root,'../bad',profile));}
 finally{old===undefined?delete process.env.VAULT_ENCRYPTION_KEY:process.env.VAULT_ENCRYPTION_KEY=old;await rm(root,{recursive:true,force:true});}
});

test('native profile workspaces are isolated per browser session',()=>{
 const root='/var/lib/masaka/profiles',first='44444444-4444-4444-8444-444444444444',second='55555555-5555-4555-8555-555555555555';
 assert.equal(profileWorkspace(root,first),`${root}/sessions/${first}`);
 assert.notEqual(profileWorkspace(root,first),profileWorkspace(root,second));
 assert.throws(()=>profileWorkspace(root,'../shared'),/workspace/i);
});
