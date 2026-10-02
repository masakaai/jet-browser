import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSemanticBatch,prepareSemanticPreview,semanticEnvelope,semanticInjectionSource,waitForSemanticPageReady} from '../src/semantic-preview.mjs';

test('semantic injection installs the bounded WPE bridge before capture starts',()=>{
 const source=semanticInjectionSource();
 assert.ok(source.indexOf('__masakaSemanticV1')<source.indexOf('phantomStreamCapture'));
 assert.match(source,/reused:true/);
 assert.ok(source.indexOf('reused:true')<source.indexOf('window.__masakaSemanticV1=state'));
 assert.match(source,/window.__phantomStreamInjected=false/);
 assert.match(source,/PHANTOM_STREAM_CAPTURE_OPTIONS = \{"styleMode":"cssom"\}/);
 assert.match(source,/RELAY_PER_MESSAGE_LIMIT_BYTES = 2000000/);
 assert.match(source,/SNAPSHOT_BUDGET_BYTES = 1900000/);
 assert.doesNotMatch(source,/RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576/);
 assert.match(source,/MASAKA_VISIBLE_COMPUTED_STYLE/);
 assert.match(source,/MASAKA_STYLESHEET_LOAD_RECONCILE/);
 assert.match(source,/stylesheet-loaded/);
 assert.match(source,/observeMasakaStylesheetLoads\(styleMutation\.addedNodes\[sa\]\)/);
 assert.match(source,/stylesheet-tree-changed/);
 assert.match(source,/document\.head\.contains\(styleMutation\.target\)/);
 assert.match(source,/MASAKA_POST_SNAPSHOT_STYLE_REPLAY/);
 assert.match(source,/post-snapshot-style-replay/);
 assert.ok(source.indexOf('safeSend(STREAM.SNAPSHOT, snapshot)')<source.indexOf('post-snapshot-style-replay'));
 assert.match(source,/collectVisibleSubtreeComputedStyles/);
 assert.match(source,/refreshMasakaComputedStylePolicy/);
 assert.match(source,/elementCount <= 1400/);
 assert.match(source,/masakaVisibleComputedCount >= 512/);
 assert.match(source,/preserveOverlayChildGeometry/);
 assert.match(source,/preserveOverlayRootGeometry/);
 assert.match(source,/min-width:0;min-height:0/);
 assert.match(source,/fixed\/sticky direct child/);
 assert.match(source,/rootRect\.height <= 0/);
 assert.match(source,/root-only exception ahead of the descendant budget/);
 assert.ok(source.indexOf('rootRect.height <= 0')<source.indexOf('masakaOverlayComputedCount >= 128'));
 assert.match(source,/position:absolute;left:/);
 assert.match(source,/alert\|drawer\|sheet/);
 assert.match(source,/\[-_\\s\]/);
 assert.match(source,/rootStyle\.display === 'none'/);
 assert.match(source,/return \{installed:/);
 assert.doesNotThrow(()=>new Function(source));
 assert.ok(Buffer.byteLength(source)<512_000);
});

test('semantic batch accepts only protocol messages and preserves recovery counters',()=>{
 const batch=normalizeSemanticBatch({installed:true,generation:3,dropped:2,pending:4,messages:[
  {type:'ext:dom-snapshot',payload:{snapshotId:1}},
  {type:'dash:ps-control-click',payload:{}},
  null
 ]});
 assert.equal(batch.installed,true);assert.equal(batch.generation,3);assert.equal(batch.dropped,2);assert.equal(batch.pending,4);assert.equal(batch.rejected,0);
 assert.deepEqual(batch.messages.map(value=>value.type),['ext:dom-snapshot']);
});

test('semantic bridge and normalizer enforce UTF-8 byte limits',()=>{
 const source=semanticInjectionSource();
 assert.match(source,/encoder\?encoder\.encode\(serialized\)\.byteLength/);
 const oversized=normalizeSemanticBatch({installed:true,messages:[{type:'ext:dom-snapshot',payload:{text:'中'.repeat(700000)}}]});
 assert.equal(oversized.messages.length,0);assert.equal(oversized.rejected,1);
});

test('semantic envelopes are deterministic UTF-8 payloads',()=>{
 const message={type:'ext:dom-mutations',payload:{mutations:[{op:'text',text:'你好'}]}};
 const first=semanticEnvelope(message),second=semanticEnvelope(message);
 assert.equal(first.id,second.id);assert.deepEqual(JSON.parse(first.buffer.toString()),message);
});

test('semantic preflight requires and retains a canonical startup snapshot',async()=>{
 let controls=0,drains=0;
 const snapshot={type:'ext:dom-snapshot',payload:{snapshotId:2,html:'<main></main>'}};
 const engine={
  async drainSemantic(){drains++;return drains===1?{installed:true,generation:4,messages:[]}:{installed:true,generation:4,messages:[snapshot]};},
  async semanticControl(type,payload){controls++;assert.equal(type,'dash:dom-stream-start');assert.equal(payload.trigger,'startup-preflight');}
 };
 const ready=await prepareSemanticPreview(engine);
 assert.equal(controls,1);assert.equal(ready.generation,4);assert.deepEqual(ready.messages,[{...snapshot,bytes:Buffer.byteLength(JSON.stringify(snapshot))}]);
});

test('semantic preflight propagates a poisoned driver slot',async()=>{
 const failure=Object.assign(Error('transport timed out'),{driverRestartRequired:true});
 await assert.rejects(()=>prepareSemanticPreview({drainSemantic:async()=>{throw failure;}}),error=>error===failure);
});

test('semantic startup waits for a quiet complete stylesheet set',async()=>{
 let index=0;const states=[
  {url:'https://example.com',timeOrigin:1,readyState:'loading',styleSheets:1,stylesheetLinks:3,pendingStyles:2},
  {url:'https://example.com',timeOrigin:1,readyState:'complete',styleSheets:3,stylesheetLinks:3,pendingStyles:0},
  {url:'https://example.com',timeOrigin:1,readyState:'complete',styleSheets:6,stylesheetLinks:6,pendingStyles:0},
  {url:'https://example.com',timeOrigin:1,readyState:'complete',styleSheets:6,stylesheetLinks:6,pendingStyles:0},
  {url:'https://example.com',timeOrigin:1,readyState:'complete',styleSheets:6,stylesheetLinks:6,pendingStyles:0},
 ];
 const engine={documentState:async()=>states[Math.min(index++,states.length-1)]};
 const result=await waitForSemanticPageReady(engine,{timeoutMs:100,quietMs:2,pollMs:1});
 assert.equal(result.styleSheets,6);assert.ok(index>=4);
});
