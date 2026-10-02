import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDownloadJournal } from '../src/download-journal.mjs';
const id='80c670f2-7829-4b3f-94f3-b07c2dfadc39';
const name=Buffer.from('同名.txt').toString('base64');
const start=`ready\nstarted\t${id}\t0\t0\nname\t${id}\t${name}\ndestination\t${id}\t0\t0\n`;
test('native success requires destination and successful terminal; incomplete lines are not committed',()=>{
  assert.deepEqual(parseDownloadJournal(start).completed,[]);
  assert.deepEqual(parseDownloadJournal(start+`finished\t${id}\t28\t0`).completed,[]);
  const result=parseDownloadJournal(start+`finished\t${id}\t28\t0\n`);
  assert.deepEqual(result.completed,[{id,name:'同名.txt',bytes:28}]);
});
test('failure stays failed even if a subsequent terminal claims success',()=>{
  const result=parseDownloadJournal(start+`failed\t${id}\t28\t1\nfinished\t${id}\t28\t0\n`);
  assert.equal(result.completed.length,0);assert.deepEqual(result.failed,[id]);
});
test('bad order, duplicate terminals, malformed bytes and unsafe identifiers fail closed',()=>{
  for(const text of [
    `ready\nfinished\t${id}\t28\t0\n`,
    start+`finished\t${id}\t28\t0\nfinished\t${id}\t28\t0\n`,
    start+`finished\t${id}\t-1\t0\n`,
    start+`finished\t${id}\t9007199254740992\t0\n`,
    start+`finished\t${id}\t28\t2\n`,
    start+`finished\t../escape\t28\t0\n`,
    start+`unexpected\t${id}\n`,
    start+`started\t${id}\t0\t0\n`,
    `ready\nstarted\t${id}\t0\t0\nfinished\t${id}\t28\t0\n`,
  ]) assert.throws(()=>parseDownloadJournal(text));
});
test('display names preserve bytes but may not contain path separators, controls or invalid UTF8',()=>{
  for(const value of [Buffer.from('../secret'),Buffer.from('a\\b'),Buffer.from('a\0b'),Buffer.from([255]),Buffer.alloc(1025,97)]) {
    assert.throws(()=>parseDownloadJournal(`ready\nstarted\t${id}\t0\t0\nname\t${id}\t${value.toString('base64')}\n`));
  }
  assert.throws(()=>parseDownloadJournal(`ready\nstarted\t${id}\t0\t0\nname\t${id}\t%%%%\n`));
});
test('bounds apply before allocation or import; oversize success is rejected',()=>{
  assert.throws(()=>parseDownloadJournal('x'.repeat(1024*1024+1)));
  assert.throws(()=>parseDownloadJournal(start+`finished\t${id}\t4194305\t0\n`));
  assert.throws(()=>parseDownloadJournal(start+`finished\t${id}\t28\t0\n`,{maxBytes:20}));
  assert.throws(()=>parseDownloadJournal(start,{maxDownloads:0}));
});
