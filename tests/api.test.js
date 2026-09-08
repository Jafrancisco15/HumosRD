import test from 'node:test';
import assert from 'node:assert/strict';
import firesHandler from '../api/fires.js';
import imageryHandler from '../api/imagery.js';
function response(){return {code:200,headers:{},status(c){this.code=c;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}};}
test('APIs reject invalid method/date',async()=>{let r=response();await firesHandler({method:'POST',query:{}},r);assert.equal(r.code,405);r=response();await firesHandler({method:'GET',query:{date:'2026-02-31'}},r);assert.equal(r.code,400);r=response();await imageryHandler({method:'POST',query:{}},r);assert.equal(r.code,405);});
test('FIRMS historical dates degrade gracefully without requiring a key',async()=>{
  const old=process.env.FIRMS_MAP_KEY;
  try{
    delete process.env.FIRMS_MAP_KEY;
    const date=new Date(Date.now()-40*86400000).toISOString().slice(0,10),r=response();
    await firesHandler({method:'GET',query:{date}},r);
    assert.equal(r.code,200);assert.equal(r.body.historicalUnavailable,true);assert.equal(r.body.fires.length,0);assert.ok(r.body.sources.every(s=>s.status==='outside_nrt_window'));
  }finally{if(old===undefined)delete process.env.FIRMS_MAP_KEY;else process.env.FIRMS_MAP_KEY=old;}
});
test('FIRMS API distinguishes missing key, partial provider failure and empty coverage',async()=>{
  const old=process.env.FIRMS_MAP_KEY,originalFetch=globalThis.fetch;
  try{
    delete process.env.FIRMS_MAP_KEY;const req={method:'GET',query:{date:new Date().toISOString().slice(0,10)}};
    let r=response();await firesHandler(req,r);assert.equal(r.code,503);assert.equal(r.body.code,'MISSING_KEY');
    process.env.FIRMS_MAP_KEY='test-only';globalThis.fetch=async url=>{if(url.includes('NOAA20'))throw new Error('simulated');return {ok:true,text:async()=>'latitude,longitude,frp,confidence,acq_date,acq_time\n'};};
    r=response();await firesHandler(req,r);assert.equal(r.code,200);assert.equal(r.body.partial,true);assert.equal(r.body.fires.length,0);assert.equal(r.body.sources.filter(s=>s.status==='unavailable').length,1);
    globalThis.fetch=async()=>({ok:false});r=response();await firesHandler(req,r);assert.equal(r.code,502);
  }finally{if(old===undefined)delete process.env.FIRMS_MAP_KEY;else process.env.FIRMS_MAP_KEY=old;globalThis.fetch=originalFetch;}
});
test('FIRMS API returns one complete Dominican local day across two UTC dates',async()=>{
  const old=process.env.FIRMS_MAP_KEY,originalFetch=globalThis.fetch;
  try{
    process.env.FIRMS_MAP_KEY='test-only';const date=new Date(Date.now()-4*3600000).toISOString().slice(0,10),next=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
    globalThis.fetch=async url=>{const utcDate=url.endsWith(next)?next:date;return {ok:true,text:async()=>`latitude,longitude,frp,confidence,acq_date,acq_time\n18.5,-69.9,10,n,${utcDate},0330\n18.5,-69.9,10,n,${utcDate},0430`};};
    const r=response();await firesHandler({method:'GET',query:{date}},r);assert.equal(r.code,200);assert.equal(r.body.partial,false);assert.equal(r.body.fires.length,8);assert.ok(r.body.fires.every(f=>new Date(f.at-4*3600000).toISOString().slice(0,10)===date));
  }finally{if(old===undefined)delete process.env.FIRMS_MAP_KEY;else process.env.FIRMS_MAP_KEY=old;globalThis.fetch=originalFetch;}
});
