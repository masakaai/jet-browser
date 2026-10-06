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

test('WPE tab lifecycle uses real WebDriver window handles',()=>{
 const close=source.slice(source.indexOf('control.closeTab='),source.indexOf('await engineTask(()=>syncTabsEngine'));
 const change=source.slice(source.indexOf('control.switchTab='),source.indexOf('await engineTask(()=>syncTabsEngine'));
 assert.match(change,/engine\.switchWindow\(handle\)/);
 assert.match(change,/engine\.newWindow\('tab'\)/);
 assert.match(close,/engine\.closeWindow\(\)/);
 assert.doesNotMatch(source,/virtualTabs|virtualTabSequence|syncVirtualTabs/);
 assert.match(source,/command\.kind==='tabs'/);
 assert.match(source,/command\.kind==='tab_switch'/);
 assert.match(source,/command\.kind==='tab_new'/);
 assert.match(source,/command\.kind==='tab_close'/);
 assert.match(source,/active_tab:control\.activeTab/);
});

test('direct sessions do not route HTTPS through the optional account proxy',()=>{
 const startup=source.slice(source.indexOf("if(!driverURL)throw Error('No WPE driver slot is available')"),source.indexOf('profileState=await loadProfile(row)'));
 assert.match(startup,/if\(row\.proxy_id\).*proxy=await startProxy/);
 assert.doesNotMatch(startup,/startProxy\(null\)|startProxy\(upstream\)/);
 assert.match(source,/createEngine\(proxy\?\.url\|\|null,driverURL,'none'\)/);
});
