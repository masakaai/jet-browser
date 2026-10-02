import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/wpe-worker.mjs', import.meta.url), 'utf8');

test('direct navigation resets preview before starting the new document', () => {
  const navigate = source.slice(source.indexOf('control.navigate='), source.indexOf('control.switchTab='));
  const reset = navigate.indexOf("resetTabPreview('navigate')");
  const open = navigate.indexOf('beginNavigationWithWait(');
  assert.ok(reset >= 0, 'navigation must announce a preview generation reset');
  assert.ok(open > reset, 'preview reset must be sent before the new document starts');
});

test('WPE tab lifecycle stays on one renderable physical page',()=>{
 const close=source.slice(source.indexOf('control.closeTab='),source.indexOf('await engineTask(()=>syncTabsEngine'));
 assert.doesNotMatch(close,/engine\.closeWindow\(/);
 assert.match(close,/control\.tabs=control\.tabs\.filter/);
 assert.match(source,/control\.virtualTabs\?syncVirtualTabs\(options\):syncTabsEngine\(options\)/);
});

test('direct sessions do not route HTTPS through the optional account proxy',()=>{
 const startup=source.slice(source.indexOf("if(!driverURL)throw Error('No WPE driver slot is available')"),source.indexOf('profileState=await loadProfile(row)'));
 assert.match(startup,/if\(row\.proxy_id\).*proxy=await startProxy/);
 assert.doesNotMatch(startup,/startProxy\(null\)|startProxy\(upstream\)/);
 assert.match(source,/createEngine\(proxy\?\.url\|\|null,driverURL,'none'\)/);
});
