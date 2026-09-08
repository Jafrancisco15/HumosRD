import test from 'node:test';
import assert from 'node:assert/strict';
import {limitedFetch,requestLimitState} from '../dist/request-limit.js';
test('browser fetch gate never exceeds two concurrent requests',async()=>{
  const original=globalThis.fetch;let active=0,max=0;
  try{
    globalThis.fetch=async value=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,20));active--;return {ok:true,value};};
    await Promise.all(Array.from({length:7},(_,i)=>limitedFetch(String(i))));
    assert.equal(max,2);assert.deepEqual(requestLimitState(),{active:0,queued:0,max:2});
  }finally{globalThis.fetch=original;}
});
