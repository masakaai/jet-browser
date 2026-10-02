import test from 'node:test';
import assert from 'node:assert/strict';
import {keyEvents} from '../src/key-events.mjs';

test('expands keyboard chords with modifiers released in reverse order',()=>{
 assert.deepEqual(keyEvents('Control+Shift+Tab'),[
  {type:'key',key:'Control',down:true},
  {type:'key',key:'Shift',down:true},
  {type:'key',key:'Tab',down:true},
  {type:'key',key:'Tab',down:false},
  {type:'key',key:'Shift',down:false},
  {type:'key',key:'Control',down:false},
 ]);
 assert.deepEqual(keyEvents('ControlOrMeta+A'),[
  {type:'key',key:'Control',down:true},
  {type:'key',key:'A',down:true},
  {type:'key',key:'A',down:false},
  {type:'key',key:'Control',down:false},
 ]);
});

test('keeps single keys and rejects ambiguous chords',()=>{
 assert.deepEqual(keyEvents('Enter'),[
  {type:'key',key:'Enter',down:true},
  {type:'key',key:'Enter',down:false},
 ]);
 for(const value of ['Control++A','Hyper+A','Control+Control+A'])assert.throws(()=>keyEvents(value),/Unsupported key chord/);
});
