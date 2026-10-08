import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('repository exposes matching local and plugin skills through the MASAKA marketplace',async()=>{
  const [marketplaceText,portableText,codexText,localSkill,pluginSkill,readme]=await Promise.all([
    read('.agents/plugins/marketplace.json'),
    read('plugins/jet-browser/plugin.json'),
    read('plugins/jet-browser/.codex-plugin/plugin.json'),
    read('.agents/skills/jet-browser/SKILL.md'),
    read('plugins/jet-browser/skills/jet-browser/SKILL.md'),
    read('README.md'),
  ]);
  const marketplace=JSON.parse(marketplaceText);
  const portable=JSON.parse(portableText);
  const codex=JSON.parse(codexText);
  assert.equal(marketplace.name,'masaka');
  assert.deepEqual(marketplace.plugins.map(({name,source})=>({name,source})),[
    {name:'jet-browser',source:{source:'local',path:'./plugins/jet-browser'}},
  ]);
  assert.equal(portable.name,'jet-browser');
  assert.equal(codex.name,'jet-browser');
  assert.equal(portable.version,codex.version);
  assert.equal(localSkill,pluginSkill);
  assert.match(readme,/codex plugin marketplace add masakaai\/jet-browser --ref main/);
  assert.match(readme,/codex plugin add jet-browser@masaka/);
  assert.match(readme,/\.agents\/skills\/jet-browser\/SKILL\.md/);
  assert.match(readme,/Install or upgrade Jet Browser to the latest main/);
  assert.match(readme,/Do not attach to my daily Chrome profile/);
  const benchmark=readme.indexOf('## Reproducible runtime benchmark');
  const agentPrompt=readme.indexOf('## Let your coding agent verify it');
  const quickStart=readme.indexOf('## Quick start');
  assert.ok(benchmark<agentPrompt);
  assert.ok(agentPrompt<quickStart);
  assert.ok(readme.indexOf('### 1. Install the Codex plugin')<readme.indexOf('### 2. Run the verified standalone flow'));
});
