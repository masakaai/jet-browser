import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,link,rm,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readCompletedDownload} from '../src/download-file.mjs';
const id='80c670f2-7829-4b3f-94f3-b07c2dfadc39';
const journal=bytes=>`ready\nstarted\t${id}\t0\t0\nname\t${id}\tZmlsZS50eHQ=\ndestination\t${id}\t0\t0\nfinished\t${id}\t${bytes}\t0\n`;
async function fixture(run){const root=await realpath(await mkdtemp(join(tmpdir(),'masaka-download-test-')));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
test('completed file read requires exact journal bytes and produces a content hash',()=>fixture(async root=>{
  await writeFile(join(root,id),'中文');
  const value=await readCompletedDownload(root,id,journal(6));
  assert.equal(value.bytes,6);assert.equal(value.content.toString(),'中文');assert.equal(value.name,'file.txt');
  assert.match(value.sha256,/^[0-9a-f]{64}$/);
  await assert.rejects(readCompletedDownload(root,id,journal(5)));
  await assert.rejects(readCompletedDownload(root,id,'ready\n'));
  await assert.rejects(readCompletedDownload(root,'../escape',journal(6)));
}));
test('symlink and hardlink files and symlink directories cannot be imported',()=>fixture(async root=>{
  await writeFile(join(root,'source'),'x');
  await symlink(join(root,'source'),join(root,id));
  await assert.rejects(readCompletedDownload(root,id,journal(1)));
  await rm(join(root,id));await link(join(root,'source'),join(root,id));
  await assert.rejects(readCompletedDownload(root,id,journal(1)));
  await mkdir(join(root,'real'));await writeFile(join(root,'real',id),'x');
  await symlink(join(root,'real'),join(root,'alias'));
  await assert.rejects(readCompletedDownload(join(root,'alias'),id,journal(1)));
}));
test('failed terminal and directory object are never returned as downloaded content',()=>fixture(async root=>{
  await mkdir(join(root,id));
  await assert.rejects(readCompletedDownload(root,id,journal(1)));
  await assert.rejects(readCompletedDownload(root,id,journal(1).replace(/1\t0\n$/,'1\t1\n')));
}));
