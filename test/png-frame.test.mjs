import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
import {isUniformPng} from '../src/png-frame.mjs';

const chunk=(type,data)=>{
 const value=Buffer.alloc(12+data.length);value.writeUInt32BE(data.length);value.write(type,4);data.copy(value,8);return value;
};
const png=pixels=>{
 const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
 const rows=Buffer.from([0,...pixels.slice(0,6),0,...pixels.slice(6)]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
};

test('uniform compositor PNGs are distinguished from small real frames',()=>{
 assert.equal(isUniformPng(png(Array(12).fill(0))),true);
 assert.equal(isUniformPng(png([0,0,0,0,0,0,0,0,0,255,255,255])),false);
 assert.equal(isUniformPng(Buffer.from('not a png')),false);
});
